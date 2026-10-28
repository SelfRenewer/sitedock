import { useEffect, useRef, useState } from 'react'
import { t } from '../../shared/i18n'

interface Props {
  onClose: () => void
  onFinder: () => void
  onEditor: () => void
  onPort: () => void
  onSettings: () => void
  onRelocate: () => void
  onArchive: (value: boolean) => void
  onPickIcon: () => void
  onResetIcon: () => void
  hasCustomIcon: boolean
  onCopyUrl: () => void
  onStopTunnel: () => void
  archived: boolean
  tunnelOn: boolean
  onRemove: () => void
  missing: boolean
  /** Папки для «Переместить в…»; текущая помечена галочкой. */
  folders: { name: string; icon: string }[]
  currentFolder: string
  onMove: (folder: string) => void
}

export function SiteMenu({
  onClose,
  onFinder,
  onEditor,
  onPort,
  onSettings,
  onRelocate,
  onArchive,
  onPickIcon,
  onResetIcon,
  hasCustomIcon,
  onCopyUrl,
  onStopTunnel,
  archived,
  tunnelOn,
  onRemove,
  missing,
  folders,
  currentFolder,
  onMove
}: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [moving, setMoving] = useState(false)

  useEffect(() => {
    const onDocument = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    // capture, иначе клик по самой кнопке «…» сразу же переоткроет меню
    document.addEventListener('mousedown', onDocument, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocument, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const item = (label: string, run: () => void, extra?: string): JSX.Element => (
    <button
      type="button"
      className={`menu__item${extra ? ` ${extra}` : ''}`}
      onClick={() => {
        onClose()
        run()
      }}
    >
      {label}
    </button>
  )

  if (moving) {
    return (
      <div className="menu" ref={ref} role="menu">
        <button type="button" className="menu__item menu__item--back" onClick={() => setMoving(false)}>
          {t('‹ Переместить в папку')}
        </button>
        <div className="menu__sep" />
        {[...folders, { name: '', icon: '◌' }].map((f) => (
          <button
            key={f.name || '—'}
            type="button"
            className="menu__item menu__item--check"
            disabled={f.name === currentFolder}
            onClick={() => {
              onClose()
              onMove(f.name)
            }}
          >
            <span>{f.name === currentFolder ? '✓' : f.icon || '📁'}</span>
            {f.name || t('Без папки')}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="menu" ref={ref} role="menu">
      {item(t('Скопировать адрес'), onCopyUrl)}
      {tunnelOn ? item(t('Убрать туннель'), onStopTunnel) : null}
      <div className="menu__sep" />
      {item(t('Выбрать иконку…'), onPickIcon)}
      {hasCustomIcon ? item(t('Вернуть иконку сайта'), onResetIcon) : null}
      <div className="menu__sep" />
      {item(t('Открыть папку в Finder'), onFinder)}
      {item(t('Открыть в VS Code'), onEditor)}
      <div className="menu__sep" />
      <button type="button" className="menu__item" onClick={() => setMoving(true)}>
        {t('Переместить в папку ›')}
      </button>
      {item(t('Изменить порт…'), onPort)}
      {item(t('Настройки сайта…'), onSettings)}
      {item(missing ? t('Указать новый путь…') : t('Изменить папку…'), onRelocate)}
      {item(archived ? t('Вернуть из архива') : t('В архив'), () => onArchive(!archived))}
      <div className="menu__sep" />
      {item(t('Удалить из списка'), onRemove, 'menu__item--danger')}
    </div>
  )
}
