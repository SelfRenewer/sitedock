import { useEffect, useState } from 'react'
import type { RemoteView } from '../../shared/types'
import { t } from '../../shared/i18n'

interface Props {
  remote: RemoteView
  qr: string | null
  onSave: (patch: { enabled?: boolean; port?: number }) => Promise<boolean>
  onRegenerate: () => Promise<boolean>
  onCopy: (text: string) => void
  onOpen: (url: string) => void
  onClose: () => void
}

export function RemoteModal({
  remote,
  qr,
  onSave,
  onRegenerate,
  onCopy,
  onOpen,
  onClose
}: Props): JSX.Element {
  const [port, setPort] = useState(String(remote.port))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const apply = async (patch: { enabled?: boolean; port?: number }): Promise<void> => {
    setBusy(true)
    await onSave(patch)
    setBusy(false)
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="modal__title">{t('Доступ с ПК')}</h3>

        <p className="modal__hint">
          {t('Пульт открывает список сайтов в браузере другого компьютера в вашей сети. Оттуда их можно запускать, останавливать и открывать.')}
        </p>

        <div className="modal__toggles">
          <label className="toggle">
            <input
              type="checkbox"
              checked={remote.enabled}
              disabled={busy}
              onChange={(e) => void apply({ enabled: e.target.checked })}
            />
            <span>
              <strong>{t('Включить пульт')}</strong>
              <span className="toggle__hint">
                {t('Слушать 0.0.0.0. Вход по паролю или по ссылке с ключом')}
              </span>
            </span>
          </label>
        </div>

        <label className="field">
          <span>{t('Порт пульта')}</span>
          <div className="field__row">
            <input
              type="number"
              min={1}
              max={65535}
              value={port}
              disabled={busy}
              onChange={(e) => setPort(e.target.value)}
            />
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy || Number(port) === remote.port}
              onClick={() => void apply({ port: Number(port) })}
            >
              {t('Применить')}
            </button>
          </div>
        </label>

        {remote.error ? <p className="modal__hint modal__hint--error">{remote.error}</p> : null}

        {remote.running && remote.url ? (
          <>
            <p className="modal__hint">
              {t('На ПК откройте адрес и введите пароль:')}
              <br />
              <button type="button" className="link" onClick={() => onOpen(remote.plainUrl!)}>
                {remote.plainUrl}
              </button>
            </p>

            <div className="password">
              <span className="password__value">{remote.token}</span>
              <button type="button" className="btn btn--ghost" onClick={() => onCopy(remote.token)}>
                {t('Копировать')}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy}
                onClick={() => void (async () => {
                  setBusy(true)
                  await onRegenerate()
                  setBusy(false)
                })()}
              >
                {t('Новый')}
              </button>
            </div>

            <p className="modal__hint">
              {t('Либо сразу по ссылке с ключом — без ввода пароля:')}
              <br />
              <button type="button" className="link" onClick={() => onOpen(remote.url!)}>
                {remote.url}
              </button>
            </p>
            {qr ? <img className="qr" src={qr} alt={t('QR-код пульта')} /> : null}
            <div className="modal__actions">
              <button type="button" className="btn" onClick={() => onCopy(remote.url!)}>
                {t('Скопировать ссылку')}
              </button>
            </div>
          </>
        ) : remote.enabled && !remote.ip ? (
          <p className="modal__hint">{t('Нет адреса в локальной сети — проверьте подключение Wi-Fi.')}</p>
        ) : null}

        <p className="modal__hint modal__hint--warn">
          {t('Пульт умеет запускать сайты, а сайт в режиме команды — это запуск программы. Включайте только в сети, которой доверяете.')}
        </p>

        <div className="modal__actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('Закрыть')}
          </button>
        </div>
      </div>
    </div>
  )
}
