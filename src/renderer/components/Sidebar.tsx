import { useEffect, useRef, useState } from 'react'
import type { Folder } from '../../shared/types'
import { DRAG_FOLDER, DRAG_SITE, VIEW_ALL, VIEW_ARCHIVE, VIEW_NONE, VIEW_RUNNING, sitesWord } from '../lib/sites'
import { IconPicker } from './IconPicker'
import { t } from '../../shared/i18n'

export interface Counts {
  total: number
  running: number
}

interface Props {
  folders: Folder[]
  counts: Record<string, Counts>
  all: Counts
  none: number
  archived: number
  view: string
  onSelect: (view: string) => void
  onCreate: (name: string) => Promise<boolean>
  onRename: (from: string, to: string) => Promise<boolean>
  onUpdate: (name: string, patch: Partial<Pick<Folder, 'icon' | 'manual'>>) => void
  onDelete: (name: string) => void
  onReorder: (names: string[]) => void
  onStartFolder: (name: string) => void
  onStopFolder: (name: string) => void
  /** Карточку бросили на папку (пусто — «Без папки»). */
  onDropSite: (siteId: string, folder: string) => void
  onStopAll: () => void
}

type Menu = { folder: string; x: number; y: number }

/** Боковая панель как в Finder: общие списки сверху, ниже папки (их можно создавать, двигать, бросать на них сайты). */
export function Sidebar(props: Props): JSX.Element {
  const { folders, counts, all, none, archived, view, onSelect } = props
  const [menu, setMenu] = useState<Menu | null>(null)
  const [picker, setPicker] = useState<Menu | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [dropOn, setDropOn] = useState<string | null>(null)
  const dragFolder = useRef<string | null>(null)

  const openMenu = (folder: string, x: number, y: number): void => setMenu({ folder, x, y })

  const dropHandlers = (target: string, isFolder: boolean) => ({
    onDragOver: (e: React.DragEvent) => {
      const types = e.dataTransfer.types
      if (types.includes(DRAG_SITE) || (isFolder && types.includes(DRAG_FOLDER))) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDropOn(target)
      }
    },
    onDragLeave: () => setDropOn((cur) => (cur === target ? null : cur)),
    onDrop: (e: React.DragEvent) => {
      setDropOn(null)
      const siteId = e.dataTransfer.getData(DRAG_SITE)
      if (siteId) {
        e.preventDefault()
        e.stopPropagation()
        props.onDropSite(siteId, target === VIEW_NONE ? '' : target)
        return
      }
      const moved = e.dataTransfer.getData(DRAG_FOLDER) || dragFolder.current
      if (isFolder && moved && moved !== target) {
        e.preventDefault()
        e.stopPropagation()
        const names = folders.map((f) => f.name).filter((n) => n !== moved)
        names.splice(names.indexOf(target), 0, moved)
        props.onReorder(names)
      }
    }
  })

  const item = (id: string, icon: string, label: string, count: number, running = 0): JSX.Element => (
    <button
      type="button"
      className={`side__item${view === id ? ' side__item--active' : ''}${dropOn === id ? ' side__item--drop' : ''}`}
      onClick={() => onSelect(id)}
      {...(id === VIEW_NONE ? dropHandlers(VIEW_NONE, false) : {})}
    >
      <span className="side__icon">{icon}</span>
      <span className="side__label">{label}</span>
      {running ? <span className="side__running" title={t('запущено: {running}', { running })} /> : null}
      <span className="side__count">{count}</span>
    </button>
  )

  return (
    <aside className="side" aria-label={t('Папки')}>
      <div className="side__drag" />
      <nav className="side__group">
        {item(VIEW_ALL, '◫', t('Все сайты'), all.total)}
        {item(VIEW_RUNNING, '●', t('Запущенные'), all.running)}
      </nav>

      <div className="side__head">
        <span>{t('Папки')}</span>
        <button type="button" className="side__add" title={t('Новая папка')} onClick={() => setCreating(true)}>
          +
        </button>
      </div>

      <nav className="side__group side__folders">
        {folders.map((folder) => {
          const c = counts[folder.name] ?? { total: 0, running: 0 }
          if (renaming === folder.name) {
            return (
              <NameInput
                key={folder.name}
                initial={folder.name}
                icon={folder.icon || '📁'}
                onDone={async (name) => {
                  if (name && name !== folder.name && !(await props.onRename(folder.name, name))) return false
                  setRenaming(null)
                  return true
                }}
                onCancel={() => setRenaming(null)}
              />
            )
          }
          return (
            <div
              key={folder.name}
              className={`side__row${dropOn === folder.name ? ' side__row--drop' : ''}`}
              draggable
              onDragStart={(e) => {
                dragFolder.current = folder.name
                e.dataTransfer.setData(DRAG_FOLDER, folder.name)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => (dragFolder.current = null)}
              {...dropHandlers(folder.name, true)}
              onContextMenu={(e) => {
                e.preventDefault()
                openMenu(folder.name, e.clientX, e.clientY)
              }}
            >
              <button
                type="button"
                className={`side__item${view === folder.name ? ' side__item--active' : ''}`}
                onClick={() => onSelect(folder.name)}
                onDoubleClick={() => setRenaming(folder.name)}
                title={t('{sites}{manual} · двойной клик — переименовать', {
                  sites: sitesWord(c.total),
                  manual: folder.manual ? t(' · «Запустить все» её пропускает') : ''
                })}
              >
                <span className="side__icon">{folder.icon || '📁'}</span>
                <span className="side__label">{folder.name}</span>
                {c.running ? <span className="side__running" title={t('запущено: {running}', { running: c.running })} /> : null}
                <span className="side__count">{c.total}</span>
              </button>
              <button
                type="button"
                className="side__more"
                title={t('Действия с папкой')}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  openMenu(folder.name, r.right - 4, r.bottom)
                }}
              >
                ⋯
              </button>
            </div>
          )
        })}

        {creating ? (
          <NameInput
            initial=""
            icon="📁"
            placeholder={t('Название папки')}
            onDone={async (name) => {
              if (name && !(await props.onCreate(name))) return false
              setCreating(false)
              return true
            }}
            onCancel={() => setCreating(false)}
          />
        ) : null}

        {none ? item(VIEW_NONE, '◌', t('Без папки'), none) : null}
      </nav>

      {!folders.length && !creating ? (
        <p className="side__hint">{t('Папок пока нет. «+» — создать, потом перетащите на неё карточки.')}</p>
      ) : null}

      <div className="side__spacer" />

      <nav className="side__group">
        {archived ? item(VIEW_ARCHIVE, '🗄', t('Архив'), archived) : null}
      </nav>
      {all.running ? (
        <button type="button" className="side__stop" onClick={props.onStopAll}>
          {t('Остановить все ({running})', { running: all.running })}
        </button>
      ) : null}

      {menu ? (
        <FolderMenu
          menu={menu}
          folder={folders.find((f) => f.name === menu.folder)}
          counts={counts[menu.folder] ?? { total: 0, running: 0 }}
          onClose={() => setMenu(null)}
          onOpen={() => onSelect(menu.folder)}
          onRename={() => setRenaming(menu.folder)}
          onIcon={() => setPicker(menu)}
          onManual={(manual) => props.onUpdate(menu.folder, { manual })}
          onStart={() => props.onStartFolder(menu.folder)}
          onStop={() => props.onStopFolder(menu.folder)}
          onDelete={() => props.onDelete(menu.folder)}
        />
      ) : null}

      {picker ? (
        <IconPicker
          title={t('Значок «{folder}»', { folder: picker.folder })}
          x={picker.x}
          y={picker.y}
          onPick={(icon) => {
            props.onUpdate(picker.folder, { icon })
            setPicker(null)
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </aside>
  )
}

function NameInput(props: {
  initial: string
  icon: string
  placeholder?: string
  onDone: (name: string) => Promise<boolean>
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState(props.initial)
  const ref = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const done = async (): Promise<void> => {
    if (busy.current) return
    busy.current = true
    const ok = await props.onDone(value.trim())
    busy.current = false
    if (!ok) ref.current?.focus()
  }
  return (
    <div className="side__item side__item--edit">
      <span className="side__icon">{props.icon}</span>
      <input
        ref={ref}
        value={value}
        maxLength={40}
        placeholder={props.placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void done()
          if (e.key === 'Escape') props.onCancel()
        }}
        onBlur={() => (value.trim() ? void done() : props.onCancel())}
      />
    </div>
  )
}

function FolderMenu(props: {
  menu: Menu
  folder: Folder | undefined
  counts: Counts
  onClose: () => void
  onOpen: () => void
  onRename: () => void
  onIcon: () => void
  onManual: (manual: boolean) => void
  onStart: () => void
  onStop: () => void
  onDelete: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) props.onClose()
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    document.addEventListener('mousedown', close, true)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close, true)
      document.removeEventListener('keydown', esc)
    }
  }, [props])
  const run = (fn: () => void) => () => {
    props.onClose()
    fn()
  }
  const { total, running } = props.counts
  return (
    <div
      ref={ref}
      className="menu menu--floating"
      role="menu"
      style={{ left: Math.min(props.menu.x, window.innerWidth - 250), top: Math.min(props.menu.y, window.innerHeight - 300) }}
    >
      <button type="button" className="menu__item" onClick={run(props.onOpen)}>
        {t('Открыть папку')}
      </button>
      <button type="button" className="menu__item" disabled={running >= total} onClick={run(props.onStart)}>
        {t('Запустить все в папке')}
      </button>
      <button type="button" className="menu__item" disabled={!running} onClick={run(props.onStop)}>
        {t('Остановить все в папке')}
      </button>
      <div className="menu__sep" />
      <button type="button" className="menu__item" onClick={run(props.onRename)}>
        {t('Переименовать')}
      </button>
      <button type="button" className="menu__item" onClick={run(props.onIcon)}>
        {t('Сменить значок…')}
      </button>
      <button
        type="button"
        className="menu__item menu__item--check"
        onClick={run(() => props.onManual(!props.folder?.manual))}
        title={t('Для больших коллекций: общая кнопка «Запустить все» пропускает эту папку')}
      >
        <span>{props.folder?.manual ? '✓' : ''}</span>{t('Только вручную')}
      </button>
      <div className="menu__sep" />
      <button type="button" className="menu__item menu__item--danger" onClick={run(props.onDelete)}>
        {t('Удалить папку…')}
      </button>
    </div>
  )
}
