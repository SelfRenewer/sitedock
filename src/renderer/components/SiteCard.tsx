import { useEffect, useRef, useState } from 'react'
import type { Folder, SiteView } from '../../shared/types'
import { DRAG_SITE, friendlyPath } from '../lib/sites'
import { Favicon } from './Favicon'
import { SiteMenu } from './SiteMenu'
import { t } from '../../shared/i18n'

interface Props {
  site: SiteView
  icon: string | null | undefined
  busy: boolean
  /** Строка списка вместо карточки — для больших папок. */
  compact: boolean
  /** Подпись «папка · раздел» — в «Все сайты», «Запущенные» и в поиске, где сайты из разных папок. */
  place: string | null
  folders: Folder[]
  onOpen: () => void
  onStop: () => void
  onRename: (name: string) => void
  onCopyUrl: (url: string) => void
  onOpenUrl: (url: string) => void
  onQr: (url: string) => void
  onFinder: () => void
  onEditor: () => void
  onSettings: (focusPort: boolean) => void
  onTunnel: (on: boolean) => void
  onArchive: (value: boolean) => void
  onPickIcon: () => void
  onResetIcon: () => void
  onRelocate: () => void
  onRemove: () => void
  onMove: (folder: string) => void
}

/** A function, not a constant: the language is chosen after the modules load. */
const statusLabel = (status: SiteView['status']): string =>
  ({ stopped: t('Остановлен'), starting: t('Запускается'), running: t('Работает'), error: t('Ошибка') })[status]

export function SiteCard(props: Props): JSX.Element {
  const { site, icon, busy, compact, place } = props
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(site.name)
  const [menuOpen, setMenuOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = (): void => {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== site.name) props.onRename(next)
    else setDraft(site.name)
  }

  const running = site.status === 'running'
  const url = site.url ?? `http://localhost:${site.port}`

  const name = editing ? (
    <input
      ref={inputRef}
      className="card__name-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') {
          setDraft(site.name)
          setEditing(false)
        }
      }}
    />
  ) : (
    <h2
      className="card__name"
      onDoubleClick={() => {
        setDraft(site.name)
        setEditing(true)
      }}
      title={t('Двойной клик — переименовать')}
    >
      {site.name}
    </h2>
  )

  const badges = (
    <>
      {site.tunnelStatus === 'on' && site.tunnelError ? (
        <span className="badge badge--warn">{site.tunnelError.slice(0, 80)}</span>
      ) : null}
      {site.tunnelStatus === 'error' && site.tunnelError ? (
        <span className="badge badge--danger">{site.tunnelError.slice(0, 80)}</span>
      ) : null}
      {!site.exists ? <span className="badge badge--danger">{t('Папка не найдена')}</span> : null}
      {site.exists && !site.hasIndex ? <span className="badge badge--warn">{t('Нет index.html')}</span> : null}
      {site.error ? <span className="badge badge--danger">{site.error}</span> : null}
    </>
  )

  const controls = (
    <div className="card__controls">
      {site.exists ? (
        <>
          <button
            type="button"
            className={`btn btn--open${running ? ' btn--open-running' : ''}`}
            disabled={busy || site.status === 'starting'}
            title={running ? t('Открыть {url}', { url }) : t('Запустить и открыть в браузере')}
            onClick={props.onOpen}
          >
            {site.status === 'starting' ? t('Запуск…') : t('Открыть')}
          </button>
          {running ? (
            <button type="button" className="icon-btn icon-btn--stop" title={t('Остановить')} onClick={props.onStop}>
              ■
            </button>
          ) : null}
        </>
      ) : (
        <button type="button" className="btn" onClick={props.onRelocate}>
          {t('Указать путь')}
        </button>
      )}

      <div className="card__menu-anchor">
        <button
          type="button"
          className="icon-btn icon-btn--more"
          onClick={() => setMenuOpen((v) => !v)}
          title={t('Ещё')}
        >
          ⋯
        </button>
        {menuOpen ? (
          <SiteMenu
            missing={!site.exists}
            onClose={() => setMenuOpen(false)}
            onFinder={props.onFinder}
            onEditor={props.onEditor}
            onPort={() => props.onSettings(true)}
            onSettings={() => props.onSettings(false)}
            onRelocate={props.onRelocate}
            archived={site.archived}
            tunnelOn={site.tunnelStatus === 'on'}
            onArchive={props.onArchive}
            onPickIcon={props.onPickIcon}
            onResetIcon={props.onResetIcon}
            hasCustomIcon={Boolean(site.iconPath)}
            onCopyUrl={() => props.onCopyUrl(site.tunnelUrl ?? site.lanUrl ?? url)}
            onStopTunnel={() => props.onTunnel(false)}
            onRemove={props.onRemove}
            folders={props.folders}
            currentFolder={site.group}
            onMove={props.onMove}
          />
        ) : null}
      </div>
    </div>
  )

  const drag = {
    draggable: !editing,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(DRAG_SITE, site.id)
      e.dataTransfer.effectAllowed = 'move'
    }
  }

  const where = friendlyPath(site.path)

  if (compact) {
    return (
      <article className={`row${site.exists ? '' : ' card--missing'}${running ? ' row--running' : ''}`} {...drag}>
        <Favicon icon={icon} name={site.name} path={site.path} small />
        <div className="row__main">
          {name}
          <span className="row__sub" title={site.path}>
            {place ? `${place} · ` : ''}
            {where}
          </span>
        </div>
        <div className="row__badges">{badges}</div>
        <span className={`dot dot--${site.status}`} title={statusLabel(site.status)} />
        <span className="row__port" title={t('Порт')}>
          :{site.port}
        </span>
        {controls}
      </article>
    )
  }

  return (
    <article className={`card${site.exists ? '' : ' card--missing'}${running ? ' card--running' : ''}`} {...drag}>
      <Favicon icon={icon} name={site.name} path={site.path} />

      <div className="card__body">
        <div className="card__row">
          {name}
          <span className={`dot dot--${site.status}`} title={statusLabel(site.status)} />
        </div>

        {place ? <p className="card__place">{place}</p> : null}
        <p className="card__path" title={site.path}>
          {where} <span className="card__port">:{site.port}</span>
        </p>

        {running ? (
          <div className="card__actions">
            <button
              type="button"
              className={`chip${site.tunnelStatus === 'on' ? ' chip--active' : ''}`}
              disabled={busy || site.tunnelStatus === 'starting'}
              title={
                site.tunnelStatus === 'on' ? (site.tunnelUrl ?? '') : t('Публичная ссылка через cloudflared (для показа)')
              }
              onClick={() =>
                site.tunnelStatus === 'on' && site.tunnelUrl ? props.onOpenUrl(site.tunnelUrl) : props.onTunnel(true)
              }
            >
              {site.tunnelStatus === 'starting' ? t('Туннель…') : site.tunnelStatus === 'on' ? t('Туннель ↗') : t('Туннель')}
            </button>
            {site.lanUrl ? (
              <>
                <button type="button" className="chip" title={site.lanUrl} onClick={() => props.onOpenUrl(site.lanUrl!)}>
                  {t('Сеть')}
                </button>
                <button
                  type="button"
                  className="chip chip--icon"
                  title={t('QR-код для телефона')}
                  onClick={() => props.onQr(site.lanUrl!)}
                >
                  ▦
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="card__badges">{badges}</div>
      </div>

      {controls}
    </article>
  )
}
