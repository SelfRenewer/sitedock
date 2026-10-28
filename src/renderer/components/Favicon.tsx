import { hashHue } from '../lib/format'

interface Props {
  icon: string | null | undefined
  name: string
  path: string
  /** Маленькая иконка для строки списка. */
  small?: boolean
}

/** Найденный favicon, иначе — круг с первой буквой и цветом из хэша пути. */
export function Favicon({ icon, name, path, small }: Props): JSX.Element {
  const size = small ? ' favicon--small' : ''
  if (icon) return <img className={`favicon${size}`} src={icon} alt="" draggable={false} />

  const hue = hashHue(path)
  const letter = (name.trim()[0] ?? '?').toUpperCase()
  return (
    <div
      className={`favicon favicon--fallback${size}`}
      style={{
        background: `hsl(${hue} 58% 46%)`,
        boxShadow: `inset 0 -8px 16px hsl(${hue} 58% 38% / 0.55)`
      }}
      aria-hidden="true"
    >
      {letter}
    </div>
  )
}
