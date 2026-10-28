import { t } from '../../shared/i18n'
interface Props {
  url: string
  dataUrl: string | null
  onClose: () => void
}

export function QrModal({ url, dataUrl, onClose }: Props): JSX.Element {
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal modal--qr" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="modal__title">{t('Открыть с телефона')}</h3>
        {dataUrl ? <img className="qr" src={dataUrl} alt={t('QR-код для {url}', { url })} /> : <div className="qr qr--empty" />}
        <p className="modal__hint">{url}</p>
        <div className="modal__actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('Закрыть')}
          </button>
        </div>
      </div>
    </div>
  )
}
