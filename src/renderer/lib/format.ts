/** Обрезка пути посередине: /Users/me/…/projects/landing */
export function middleTruncate(value: string, max = 32): string {
  if (value.length <= max) return value
  const head = Math.ceil((max - 1) * 0.42)
  const tail = max - 1 - head
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour12: false })
}

/** hue из пути — чтобы у сайта всегда был один и тот же цвет заглушки. */
export function hashHue(value: string): number {
  let hash = 5381
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0
  return Math.abs(hash) % 360
}

/** Убирает служебную обёртку ошибок из ipcRenderer.invoke. */
export function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^(Uncaught )?Error:\s*/, '')
    .trim()
}
