import { useEffect, useRef, useState } from 'react'
import { t } from '../../shared/i18n'

const PRESETS = [
  '💼', '🛠', '🌱', '🧪', '🎬', '💙', '⚡', '🤖',
  '🏥', '💅', '🚗', '🏠', '📈', '🎨', '📁', '⭐',
  '🔥', '💎', '🧭', '🎯'
]

interface Props {
  title: string
  x: number
  y: number
  onPick: (icon: string) => void
  onClose: () => void
}

/** Значок папки: готовые эмодзи, свой или без значка. */
export function IconPicker({ title, x, y, onPick, onClose }: Props): JSX.Element {
  const [custom, setCustom] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="icon-picker"
      style={{ left: Math.min(x, window.innerWidth - 236), top: Math.min(y, window.innerHeight - 260) }}
    >
      <div className="icon-picker__title">{title}</div>
      <div className="icon-picker__grid">
        {PRESETS.map((icon) => (
          <button key={icon} type="button" onClick={() => onPick(icon)}>
            {icon}
          </button>
        ))}
      </div>
      <form
        className="icon-picker__row"
        onSubmit={(e) => {
          e.preventDefault()
          if (custom.trim()) onPick(custom.trim())
        }}
      >
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder={t('свой эмодзи')}
          maxLength={8}
          autoFocus
        />
        <button type="submit" className="chip">
          {t('ОК')}
        </button>
      </form>
      <button type="button" className="icon-picker__clear" onClick={() => onPick('')}>
        {t('Без значка')}
      </button>
    </div>
  )
}
