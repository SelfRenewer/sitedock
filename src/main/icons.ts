import fs from 'node:fs/promises'
import path from 'node:path'

const CANDIDATES = ['favicon.ico', 'favicon.png', 'favicon.svg', 'apple-touch-icon.png']
const MIME: Record<string, string> = {
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}
const MAX_BYTES = 512 * 1024

interface CacheEntry {
  key: string
  value: string | null
}
const cache = new Map<string, CacheEntry>()

async function readAsDataUrl(file: string): Promise<string | null> {
  const stat = await fs.stat(file).catch(() => null)
  if (!stat || !stat.isFile() || stat.size === 0 || stat.size > MAX_BYTES) return null
  const mime = MIME[path.extname(file).toLowerCase()]
  if (!mime) return null
  const buf = await fs.readFile(file)
  return `data:${mime};base64,${buf.toString('base64')}`
}

/** href из первого подходящего <link rel="... icon ..."> в index.html. */
async function iconFromIndexHtml(root: string): Promise<string | null> {
  const html = await fs.readFile(path.join(root, 'index.html'), 'utf8').catch(() => null)
  if (!html) return null
  const links = html.match(/<link\b[^>]*>/gi) ?? []
  for (const tag of links) {
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase()
    if (!rel || !/\bicon\b/.test(rel)) continue
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (!href) continue
    // Иконку часто вставляют прямо в разметку — это уже готовый data URL.
    if (/^data:image\//i.test(href)) {
      if (href.length <= MAX_BYTES) return href
      continue
    }
    if (/^https?:/i.test(href)) continue
    const clean = href.split(/[?#]/)[0]
    const resolved = path.resolve(root, clean.replace(/^\//, ''))
    if (resolved !== root && !resolved.startsWith(root + path.sep)) continue
    const url = await readAsDataUrl(resolved)
    if (url) return url
  }
  return null
}

/**
 * favicon.ico → favicon.png → favicon.svg → apple-touch-icon.png → <link rel="icon">.
 * null означает «рисуй заглушку» — её генерирует renderer.
 */
/** Выбранный вручную файл. Кэш по пути и времени правки, как и для найденных. */
export async function readIconFile(file: string): Promise<string | null> {
  return readAsDataUrl(file)
}

export async function findIcon(root: string): Promise<string | null> {
  const dirStat = await fs.stat(root).catch(() => null)
  if (!dirStat?.isDirectory()) return null

  const key = String(dirStat.mtimeMs)
  const hit = cache.get(root)
  if (hit && hit.key === key) return hit.value

  let value: string | null = null
  for (const name of CANDIDATES) {
    value = await readAsDataUrl(path.join(root, name))
    if (value) break
  }
  if (!value) value = await iconFromIndexHtml(root)

  cache.set(root, { key, value })
  return value
}
