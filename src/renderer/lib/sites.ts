import type { SiteView } from '../../shared/types'

/** Что открыто в боковой панели. Папка — её название. */
export const VIEW_ALL = '__all'
export const VIEW_RUNNING = '__running'
export const VIEW_NONE = '__none'
export const VIEW_ARCHIVE = '__archive'

// a section key that no real section can have; shown as t('Прочее')
export const NO_SECTION = '\u0000other'

/** Без регистра и разницы между «е» и «ё». */
export function norm(value: string): string {
  return value.toLowerCase().replace(/ё/g, 'е').trim() // i18n-ignore: search treats ё as е
}

/** Все слова запроса должны найтись в названии, папке, разделе или пути. */
export function matches(site: SiteView, query: string): boolean {
  const words = norm(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = norm(`${site.name} ${site.group} ${site.section} ${site.path} :${site.port}`)
  return words.every((w) => hay.includes(w))
}

/**
 * Путь, который читается: относительно ближайшей папки Sites (~/Sites, ~/Projects/Sites…),
 * иначе домашняя папка — «~»,
 * у глубоких — только две последние папки.
 */
export function friendlyPath(full: string): string {
  const sites = /\/Sites\/(.+)$/.exec(full)
  const parts = sites ? sites[1].split('/') : full.replace(/^\/Users\/[^/]+/, '~').split('/')
  // Глубокий путь читается по двум последним папкам: «… › 07-bakery › share».
  return parts.length > 3 ? `… › ${parts.slice(-2).join(' › ')}` : parts.join(' › ')
}

/** 1 сайт, 2 сайта, 5 сайтов. */
export { sitesWord } from '../../shared/i18n'

/** Разделы папки по алфавиту, «Прочее» и сайты без раздела — в конце. */
export function bySection(sites: SiteView[]): [string, SiteView[]][] {
  const map = new Map<string, SiteView[]>()
  for (const site of sites) {
    const key = site.section.trim() || NO_SECTION
    const list = map.get(key)
    if (list) list.push(site)
    else map.set(key, [site])
  }
  return [...map.entries()].sort((a, b) => {
    if (a[0] === NO_SECTION) return 1
    if (b[0] === NO_SECTION) return -1
    return a[0].localeCompare(b[0], 'ru')
  })
}

/** Порядок внутри папки: запущенные сверху, дальше по названию. */
export function byName(a: SiteView, b: SiteView): number {
  const run = Number(b.status === 'running') - Number(a.status === 'running')
  return run || a.name.localeCompare(b.name, 'ru')
}

/** Перетаскивание карточки на папку. */
export const DRAG_SITE = 'application/x-sitedock-site'
export const DRAG_FOLDER = 'application/x-sitedock-folder'
