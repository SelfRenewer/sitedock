import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Folder, LogEntry, RemoteView, Site, SiteView } from '../shared/types'
import { LogPanel } from './components/LogPanel'
import { QrModal } from './components/QrModal'
import { RemoteModal } from './components/RemoteModal'
import { SettingsModal } from './components/SettingsModal'
import { Sidebar, type Counts } from './components/Sidebar'
import { SiteCard } from './components/SiteCard'
import { Toasts, type Toast } from './components/Toasts'
import { Toolbar, type ViewMode } from './components/Toolbar'
import { errorText } from './lib/format'
import {
  NO_SECTION,
  VIEW_ALL,
  VIEW_ARCHIVE,
  VIEW_NONE,
  VIEW_RUNNING,
  byName,
  bySection,
  matches,
  sitesWord
} from './lib/sites'
import { t } from '../shared/i18n'

const LOG_LIMIT = 200
/** Сколько сайтов папки видно на «Все сайты», пока её не развернули. */
const PREVIEW = { cards: 4, list: 6 }
/** Больше — спрашиваем перед массовым запуском. */
const CONFIRM_START = 10

function remembered<T extends string>(key: string, fallback: T, allowed?: readonly T[]): T {
  try {
    const value = localStorage.getItem(key) as T | null
    if (value && (!allowed || allowed.includes(value))) return value
  } catch {
    // приватное окно или запрещённое хранилище — просто не запомнится
  }
  return fallback
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // см. remembered
  }
}

export default function App(): JSX.Element {
  const [sites, setSites] = useState<SiteView[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [icons, setIcons] = useState<Record<string, string | null>>({})
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [logFilter, setLogFilter] = useState('all')
  const [settings, setSettings] = useState<{ id: string; focusPort: boolean } | null>(null)
  const [qr, setQr] = useState<{ url: string; dataUrl: string | null } | null>(null)
  const [remote, setRemote] = useState<RemoteView | null>(null)
  const [remoteQr, setRemoteQr] = useState<string | null>(null)
  const [view, setView] = useState<string>(() => remembered('sitedock.view', VIEW_ALL))
  const [mode, setMode] = useState<ViewMode>(() => remembered<ViewMode>('sitedock.mode', 'cards', ['cards', 'list']))
  const [query, setQuery] = useState('')
  const [section, setSection] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const searchRef = useRef<HTMLInputElement>(null)
  const toastSeq = useRef(0)
  const dragDepth = useRef(0)

  const notify = useCallback((text: string, kind: Toast['kind'] = 'error', action?: Toast['action']) => {
    const id = ++toastSeq.current
    setToasts((prev) => [...prev, { id, kind, text, action }])
    if (!action) setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000)
  }, [])

  /** Все вызовы IPC идут через это — ни одна ошибка не проглатывается. */
  const guard = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await fn()
      } catch (err) {
        notify(errorText(err))
        return undefined
      }
    },
    [notify]
  )

  const select = useCallback((next: string) => {
    setView(next)
    setSection(null)
    setQuery('')
    remember('sitedock.view', next)
  }, [])

  const chooseMode = useCallback((next: ViewMode) => {
    setMode(next)
    remember('sitedock.mode', next)
  }, [])

  useEffect(() => {
    void window.api.listSites().then(setSites)
    void window.api.listLogs().then(setLogs)

    const offSites = window.api.onSites(setSites)
    const offLog = window.api.onLog((entry) =>
      setLogs((prev) => {
        const next = [...prev, entry]
        return next.length > LOG_LIMIT ? next.slice(next.length - LOG_LIMIT) : next
      })
    )
    const offToast = window.api.onToast((payload) => notify(payload.text, payload.kind))

    return () => {
      offSites()
      offLog()
      offToast()
    }
  }, [notify])

  // Папки могут появиться и из настроек сайта (вписали новое название) — перечитываем вместе со списком.
  const groupsKey = useMemo(() => [...new Set(sites.map((s) => s.group))].sort().join('\n'), [sites])
  useEffect(() => {
    void window.api.folders().then(setFolders).catch(() => undefined)
  }, [groupsKey])

  // ⌘F — в поиск.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  /** Перечитать иконку сайта, минуя кэш: после ручного выбора или сброса. */
  const refreshIcon = useCallback(async (site: SiteView): Promise<void> => {
    const icon = await window.api.siteIcon(site.id).catch(() => null)
    setIcons((prev) => ({ ...prev, [`${site.id}:${site.path}`]: icon }))
  }, [])

  // Иконки грузим отдельно от состояния — их незачем гонять в каждом broadcast.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const site of sites) {
        const key = `${site.id}:${site.path}`
        if (key in icons) continue
        const icon = await window.api.siteIcon(site.id).catch(() => null)
        if (cancelled) return
        setIcons((prev) => ({ ...prev, [key]: icon }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sites, icons])

  const withBusy = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }, [])

  const startSite = useCallback(
    async (site: SiteView): Promise<boolean> => {
      const result = await guard(() => window.api.startSite(site.id))
      if (!result) return false
      if (result.ok) return true
      if (result.code === 'port-busy' && result.suggested) {
        const port = result.suggested
        notify(`${result.message}`, 'error', {
          label: t('Занять {port}', { port }),
          run: () => {
            void guard(async () => {
              await window.api.updateSite(site.id, { port })
              const retry = await window.api.startSite(site.id)
              if (!retry.ok) notify(retry.message)
            })
          }
        })
        return false
      }
      notify(result.message)
      return false
    },
    [guard, notify]
  )

  /** «Открыть»: остановленный сайт сначала запускается. */
  const openSite = useCallback(
    async (site: SiteView) => {
      const url = site.url ?? `http://localhost:${site.port}`
      if (site.status !== 'running' && !(await startSite(site))) return
      await guard(() => window.api.openExternal(url))
    },
    [guard, startSite]
  )

  const startMany = useCallback(
    async (list: SiteView[], label: string) => {
      const targets = list.filter((s) => s.exists && s.status !== 'running')
      if (!targets.length) return
      if (targets.length > CONFIRM_START && !window.confirm(t('Запустить {p0} из «{label}»?', { p0: sitesWord(targets.length), label }))) return
      await withBusy(async () => {
        const failures = await guard(() => window.api.startMany(targets.map((s) => s.id)))
        for (const failure of failures ?? []) notify(`«${failure.name}»: ${errorText(failure.message)}`)
      })
    },
    [guard, notify, withBusy]
  )

  const stopMany = useCallback(
    async (list: SiteView[]) => {
      const targets = list.filter((s) => s.status === 'running' || s.status === 'starting')
      if (targets.length) await withBusy(async () => void (await guard(() => window.api.stopMany(targets.map((s) => s.id)))))
    },
    [guard, withBusy]
  )

  const moveSites = useCallback(
    async (ids: string[], folder: string) => {
      const next = await guard(() => window.api.moveSites(ids, folder))
      if (!next) return
      setFolders(next)
      const name = sites.find((s) => s.id === ids[0])?.name ?? t('Сайт')
      notify(folder ? t('«{name}» → «{folder}»', { name, folder }) : t('«{name}» → без папки', { name }), 'info')
    },
    [guard, notify, sites]
  )

  const addDropped = useCallback(
    async (paths: string[], group: string) => {
      const result = await guard(() => window.api.addPaths(paths, group))
      if (!result) return
      for (const reason of result.skipped) notify(reason, 'info')
      if (result.added === 0 && result.skipped.length === 0) notify(t('Нечего добавлять'), 'info')
    },
    [guard, notify]
  )

  const openQr = useCallback(
    async (url: string) => {
      setQr({ url, dataUrl: null })
      const dataUrl = await guard(() => window.api.qrCode(url))
      setQr((prev) => (prev && prev.url === url ? { url, dataUrl: dataUrl ?? null } : prev))
    },
    [guard]
  )

  const saveSettings = useCallback(
    async (id: string, patch: Partial<Site>): Promise<boolean> => {
      try {
        await window.api.updateSite(id, patch)
        return true
      } catch (err) {
        notify(errorText(err))
        return false
      }
    },
    [notify]
  )

  // ---------- что показывать ----------

  const folderNames = useMemo(() => new Set(folders.map((f) => f.name)), [folders])
  const folderByName = useMemo(() => new Map(folders.map((f) => [f.name, f])), [folders])
  const active = useMemo(() => sites.filter((s) => !s.archived), [sites])
  const archived = useMemo(() => sites.filter((s) => s.archived), [sites])
  const inFolder = useCallback((s: SiteView, name: string) => s.group.trim() === name, [])

  const counts = useMemo(() => {
    const map: Record<string, Counts> = {}
    for (const s of active) {
      const key = s.group.trim()
      const c = (map[key] ??= { total: 0, running: 0 })
      c.total++
      if (s.status === 'running') c.running++
    }
    return map
  }, [active])
  const runningAll = sites.filter((s) => s.status === 'running').length
  const noFolder = active.filter((s) => !s.group.trim() || !folderNames.has(s.group.trim()))

  const isFolderView = folderNames.has(view)
  const current = isFolderView || [VIEW_ALL, VIEW_RUNNING, VIEW_NONE, VIEW_ARCHIVE].includes(view) ? view : VIEW_ALL
  const folder = isFolderView ? folderByName.get(view) : undefined

  const scope = useMemo(() => {
    if (current === VIEW_ALL) return active
    if (current === VIEW_RUNNING) return sites.filter((s) => s.status === 'running' || s.status === 'starting')
    if (current === VIEW_NONE) return noFolder
    if (current === VIEW_ARCHIVE) return archived
    return active.filter((s) => inFolder(s, current))
  }, [current, active, sites, noFolder, archived, inFolder])

  const found = useMemo(() => (query.trim() ? scope.filter((s) => matches(s, query)) : scope), [scope, query])

  /** «Демо · Авто» — где лежит сайт; внутри своей папки достаточно раздела. */
  const placeOf = useCallback(
    (s: SiteView): string | null => {
      const searching = Boolean(query.trim())
      // На «Все сайты» карточка и так стоит под заголовком своей папки; внутри папки её разделы — подзаголовки.
      const showFolder = !isFolderView && (searching || current !== VIEW_ALL)
      const showSection = searching || !isFolderView
      const parts = [showFolder ? s.group.trim() || t('Без папки') : '', showSection ? s.section.trim() : ''].filter(Boolean)
      return parts.length ? parts.join(' · ') : null
    },
    [isFolderView, query, current]
  )

  const sectionsByFolder = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const s of sites) {
      if (!s.section.trim()) continue
      const list = (map[s.group.trim()] ??= [])
      if (!list.includes(s.section.trim())) list.push(s.section.trim())
    }
    for (const list of Object.values(map)) list.sort((a, b) => a.localeCompare(b, 'ru'))
    return map
  }, [sites])

  const bulkTargets = useMemo(() => {
    const manual = new Set(folders.filter((f) => f.manual).map((f) => f.name))
    return active.filter((s) => !manual.has(s.group.trim()))
  }, [active, folders])
  const manualNames = folders.filter((f) => f.manual).map((f) => `«${f.name}»`)

  const settingsSite = settings ? sites.find((s) => s.id === settings.id) : undefined

  const renderSite = (site: SiteView): JSX.Element => (
    <SiteCard
      key={site.id}
      site={site}
      icon={icons[`${site.id}:${site.path}`]}
      busy={busy}
      compact={mode === 'list'}
      place={placeOf(site)}
      folders={folders}
      onOpen={() => void openSite(site)}
      onStop={() => void guard(() => window.api.stopSite(site.id))}
      onRename={(name) => void guard(() => window.api.updateSite(site.id, { name }))}
      onCopyUrl={(url) =>
        void guard(async () => {
          await window.api.copyText(url)
          notify(t('Адрес скопирован'), 'info')
        })
      }
      onOpenUrl={(url) => {
        if (site.status !== 'running') {
          notify(t('Сайт не запущен'), 'info')
          return
        }
        void guard(() => window.api.openExternal(url))
      }}
      onQr={(url) => void openQr(url)}
      onFinder={() => void guard(() => window.api.showInFinder(site.path))}
      onEditor={() => void guard(() => window.api.openInEditor(site.path))}
      onTunnel={(on) =>
        void withBusy(async () => {
          await guard(async () => {
            if (on) await window.api.startTunnel(site.id)
            else await window.api.stopTunnel(site.id)
          })
        })
      }
      onSettings={(focusPort) => setSettings({ id: site.id, focusPort })}
      onRelocate={() => void guard(() => window.api.relocateSite(site.id))}
      onRemove={() => {
        if (window.confirm(t('Убрать «{name}» из списка? Папка на диске останется.', { name: site.name }))) {
          void guard(() => window.api.removeSite(site.id))
        }
      }}
      onArchive={(value) => void guard(() => window.api.updateSite(site.id, { archived: value }))}
      onPickIcon={() =>
        void guard(async () => {
          const file = await window.api.pickIcon(site.id)
          if (file) await refreshIcon(site)
        })
      }
      onResetIcon={() =>
        void guard(async () => {
          await window.api.resetIcon(site.id)
          await refreshIcon(site)
        })
      }
      onMove={(target) => void moveSites([site.id], target)}
    />
  )

  const grid = (list: SiteView[], key?: string): JSX.Element => (
    <div className={mode === 'list' ? 'rows' : 'group__grid'} key={key}>
      {[...list].sort(byName).map(renderSite)}
    </div>
  )

  /** «Все сайты» без поиска: папки по порядку, большие — свёрнуты до нескольких карточек. */
  const overview = (): JSX.Element => {
    const blocks: { key: string; icon: string; title: string; list: SiteView[]; open: string | null }[] = [
      ...folders
        .map((f) => ({ key: f.name, icon: f.icon || '📁', title: f.name, list: found.filter((s) => inFolder(s, f.name)), open: f.name }))
        .filter((b) => b.list.length),
      ...(noFolder.length ? [{ key: VIEW_NONE, icon: '◌', title: t('Без папки'), list: noFolder, open: VIEW_NONE }] : [])
    ]
    const limit = PREVIEW[mode]
    return (
      <>
        {blocks.map((b) => {
          const sorted = [...b.list].sort(byName)
          const open = expanded.has(b.key)
          const shown = open ? sorted : sorted.slice(0, limit)
          const hidden = sorted.length - shown.length
          return (
            <section className="group" key={b.key}>
              <h2 className="group__head">
                <button type="button" className="group__link" onClick={() => b.open && select(b.open)} title={t('Открыть папку')}>
                  <span>{b.icon}</span>
                  {b.title}
                  <span className="group__count">{b.list.length}</span>
                  <span className="group__go">›</span>
                </button>
              </h2>
              <div className={mode === 'list' ? 'rows' : 'group__grid'}>{shown.map(renderSite)}</div>
              {hidden > 0 || open ? (
                <button
                  type="button"
                  className="group__more"
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev)
                      if (next.has(b.key)) next.delete(b.key)
                      else next.add(b.key)
                      return next
                    })
                  }
                >
                  {open ? t('Свернуть') : t('Показать ещё {hidden}', { hidden })}
                </button>
              ) : null}
            </section>
          )
        })}
      </>
    )
  }

  /** Папка с разделами: фильтр-«чипсы» сверху и подзаголовки разделов. */
  const folderBody = (): JSX.Element => {
    const sections = bySection(found)
    const hasSections = sections.length > 1 || (sections.length === 1 && sections[0][0] !== NO_SECTION)
    if (!hasSections) return grid(found)
    const visible = section ? sections.filter(([name]) => name === section) : sections
    return (
      <>
        <div className="chips" role="tablist" aria-label={t('Разделы')}>
          <button type="button" className={`pill${section ? '' : ' pill--on'}`} onClick={() => setSection(null)}>
            {t('Все')}{' '}<span>{found.length}</span>
          </button>
          {sections.map(([name, list]) => (
            <button
              type="button"
              key={name}
              className={`pill${section === name ? ' pill--on' : ''}`}
              onClick={() => setSection(section === name ? null : name)}
            >
              {name === NO_SECTION ? t('Прочее') : name} <span>{list.length}</span>
            </button>
          ))}
        </div>
        {visible.map(([name, list]) => (
          <section className="group" key={name}>
            {section ? null : (
              <h3 className="group__sub">
                {name === NO_SECTION ? t('Прочее') : name}
                <span className="group__count">{list.length}</span>
              </h3>
            )}
            {grid(list)}
          </section>
        ))}
      </>
    )
  }

  const body = (): JSX.Element => {
    if (sites.length === 0) {
      return (
        <div className="empty">
          <div className="empty__icon">◍</div>
          <p className="empty__title">{t('Пока ни одного сайта')}</p>
          <p className="empty__hint">{t('Перетащите папку с сайтом сюда или нажмите «＋ Сайт»')}</p>
        </div>
      )
    }
    if (!found.length) {
      return (
        <div className="empty">
          <div className="empty__icon">{query.trim() ? '⌕' : '◌'}</div>
          <p className="empty__title">
            {query.trim()
              ? t('Ничего не нашлось по «{p0}»', { p0: query.trim() })
              : current === VIEW_RUNNING
                ? t('Сейчас ничего не запущено')
                : t('В папке пока пусто')}
          </p>
          <p className="empty__hint">
            {query.trim()
              ? t('Поиск идёт по названию, папке, разделу и пути.')
              : current === VIEW_RUNNING
                ? t('«Открыть» на карточке запускает сайт.')
                : t('Перетащите сюда карточку из другой папки или нажмите «＋ Сайт».')}
          </p>
        </div>
      )
    }
    if (query.trim()) return grid(found)
    if (current === VIEW_ALL) return overview()
    if (isFolderView) return folderBody()
    return <section className={`group${current === VIEW_ARCHIVE ? ' group--archive' : ''}`}>{grid(found)}</section>
  }

  // ---------- шапка ----------

  const title =
    current === VIEW_ALL
      ? { icon: '◫', text: t('Все сайты') }
      : current === VIEW_RUNNING
        ? { icon: '●', text: t('Запущенные') }
        : current === VIEW_NONE
          ? { icon: '◌', text: t('Без папки') }
          : current === VIEW_ARCHIVE
            ? { icon: '🗄', text: t('Архив') }
            : { icon: folder?.icon || '📁', text: current }
  const runningHere = scope.filter((s) => s.status === 'running').length
  const subtitle = [
    query.trim() ? t('найдено {found} из {total}', { found: found.length, total: scope.length }) : sitesWord(scope.length),
    current !== VIEW_RUNNING && runningHere ? t('запущено {runningHere}', { runningHere }) : '',
    folder?.manual ? t('только вручную') : ''
  ]
    .filter(Boolean)
    .join(' · ')

  const addTo = isFolderView ? current : ''

  return (
    <div
      className={`app${dragging ? ' app--dragging' : ''}`}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        dragDepth.current += 1
        setDragging(true)
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDragLeave={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        dragDepth.current -= 1
        if (dragDepth.current <= 0) {
          dragDepth.current = 0
          setDragging(false)
        }
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        const paths = Array.from(e.dataTransfer.files).map((file) => window.api.pathForFile(file))
        if (paths.length) void addDropped(paths.filter(Boolean), addTo)
      }}
    >
      <div className="layout">
        <Sidebar
          folders={folders}
          counts={counts}
          all={{ total: active.length, running: runningAll }}
          none={noFolder.length}
          archived={archived.length}
          view={current}
          onSelect={select}
          onCreate={async (name) => {
            const next = await guard(() => window.api.createFolder(name))
            if (!next) return false
            setFolders(next)
            notify(t('Папка «{name}» создана — перетащите на неё карточки', { name }), 'info')
            return true
          }}
          onRename={async (from, to) => {
            const next = await guard(() => window.api.renameFolder(from, to))
            if (!next) return false
            setFolders(next)
            if (view === from) select(to)
            return true
          }}
          onUpdate={(name, patch) => void guard(async () => setFolders(await window.api.updateFolder(name, patch)))}
          onDelete={(name) => {
            const n = counts[name]?.total ?? 0
            const text = n
              ? t('Удалить папку «{name}»? {p0} останутся в списке и перейдут в «Без папки».', { name, p0: sitesWord(n) })
              : t('Удалить пустую папку «{name}»?', { name })
            if (!window.confirm(text)) return
            void guard(async () => {
              setFolders(await window.api.deleteFolder(name))
              if (view === name) select(VIEW_ALL)
            })
          }}
          onReorder={(names) => void guard(async () => setFolders(await window.api.reorderFolders(names)))}
          onStartFolder={(name) => void startMany(active.filter((s) => inFolder(s, name)), name)}
          onStopFolder={(name) => void stopMany(active.filter((s) => inFolder(s, name)))}
          onDropSite={(id, target) => {
            const site = sites.find((s) => s.id === id)
            if (site && site.group.trim() !== target) void moveSites([id], target)
          }}
          onStopAll={() => void withBusy(() => guard(() => window.api.stopAll()).then(() => undefined))}
        />

        <div className="content">
          <Toolbar
            ref={searchRef}
            icon={title.icon}
            title={title.text}
            subtitle={subtitle}
            query={query}
            onQuery={setQuery}
            mode={mode}
            onMode={chooseMode}
            busy={busy}
            logsOpen={logsOpen}
            folder={
              isFolderView
                ? {
                    canStart: scope.some((s) => s.exists && s.status !== 'running'),
                    canStop: runningHere > 0,
                    onStart: () => void startMany(scope, current),
                    onStop: () => void stopMany(scope)
                  }
                : null
            }
            startAll={
              current === VIEW_ALL
                ? {
                    disabled: !bulkTargets.some((s) => s.status !== 'running'),
                    hint: t('Запустит {sites}: без архива{manual}', {
                      sites: sitesWord(bulkTargets.length),
                      manual: manualNames.length ? t(' и папок «только вручную» ({names})', { names: manualNames.join(', ') }) : ''
                    }),
                    onRun: () =>
                      void withBusy(async () => {
                        const failures = await guard(() => window.api.startAll())
                        for (const failure of failures ?? []) notify(`«${failure.name}»: ${errorText(failure.message)}`)
                      })
                  }
                : null
            }
            onAdd={() =>
              void guard(async () => {
                const result = await window.api.addSites(addTo)
                for (const reason of result.skipped) notify(reason, 'info')
              })
            }
            addHint={addTo ? t('Добавить папку с сайтом в «{addTo}»', { addTo }) : t('Добавить папку с сайтом')}
            onToggleLogs={() => setLogsOpen((v) => !v)}
            onRemote={async () => {
              const remoteView = await guard(() => window.api.getRemote())
              if (remoteView) setRemote(remoteView)
            }}
          />

          <main className={`list${logsOpen ? ' list--with-logs' : ''}`}>{body()}</main>

          {logsOpen ? (
            <LogPanel
              logs={logs}
              sites={sites}
              filter={logFilter}
              onFilter={setLogFilter}
              onClear={() =>
                void guard(async () => {
                  await window.api.clearLogs()
                  setLogs([])
                })
              }
              onClose={() => setLogsOpen(false)}
            />
          ) : null}
        </div>
      </div>

      {settingsSite ? (
        <SettingsModal
          site={settingsSite}
          folders={folders.map((f) => f.name)}
          sections={sectionsByFolder}
          focusPort={settings!.focusPort}
          onClose={() => setSettings(null)}
          onSave={(patch) => saveSettings(settingsSite.id, patch)}
          onSuggestPort={() => window.api.suggestPort(settingsSite.id)}
        />
      ) : null}

      {qr ? <QrModal url={qr.url} dataUrl={qr.dataUrl} onClose={() => setQr(null)} /> : null}

      {remote ? (
        <RemoteModal
          remote={remote}
          qr={remoteQr}
          onSave={async (patch) => {
            const next = await guard(() => window.api.updateRemote(patch))
            if (!next) return false
            setRemote(next)
            setRemoteQr(next.url ? ((await guard(() => window.api.qrCode(next.url!))) ?? null) : null)
            return true
          }}
          onRegenerate={async () => {
            const next = await guard(() => window.api.regenerateRemote())
            if (!next) return false
            setRemote(next)
            setRemoteQr(next.url ? ((await guard(() => window.api.qrCode(next.url!))) ?? null) : null)
            return true
          }}
          onCopy={(text) => void guard(() => window.api.copyText(text))}
          onOpen={(url) => void guard(() => window.api.openExternal(url))}
          onClose={() => {
            setRemote(null)
            setRemoteQr(null)
          }}
        />
      ) : null}

      {dragging ? (
        <div className="dropzone">
          {addTo ? t('Отпустите папку, чтобы добавить сайт в «{addTo}»', { addTo }) : t('Отпустите папку, чтобы добавить сайт')}
        </div>
      ) : null}

      <Toasts toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </div>
  )
}
