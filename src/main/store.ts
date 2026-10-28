import { randomBytes, randomUUID } from 'node:crypto'
import path from 'node:path'
import Store from 'electron-store'
import type { LangSetting } from '../shared/i18n'
import type { Folder, RemoteConfig, Site } from '../shared/types'
import { t } from '../shared/i18n'

interface Schema {
  sites: Site[]
  remote: RemoteConfig
  /** Значки папок (старый формат, держим в синхроне с folders — на случай отката на прошлую версию). */
  sphereIcons: Record<string, string>
  /** Папки в порядке показа. Пусто — собираются из sphereIcons и групп сайтов. */
  folders: Folder[]
  /** Язык интерфейса: system — как в macOS. */
  language: LangSetting
}

const store = new Store<Schema>({
  name: 'sites',
  defaults: {
    sites: [],
    // Выключен по умолчанию: пульт умеет запускать процессы, наружу он
    // открывается только по явному решению пользователя.
    remote: { enabled: false, port: 7788, token: '' },
    sphereIcons: {},
    folders: [],
    language: 'system'
  }
})

const NO_FOLDER = ''


export function newToken(): string {
  return randomBytes(9).toString('base64url')
}

// Без 0/O/1/l/I — пароль пульта набирают руками на другом компьютере.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

/** Пароль вида «kfmq-7xtz-p3wd»: ~59 бит, но его реально продиктовать. */
export function newPassphrase(): string {
  const bytes = randomBytes(12)
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length])
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)]
    .map((group) => group.join(''))
    .join('-')
}

export function allSites(): Site[] {
  const sites = store.get('sites')
  // Дозаписываем ключ сайтам, созданным до его появления.
  let changed = false
  for (const site of sites) {
    if (!site.token) {
      site.token = newToken()
      changed = true
    }
    // Поля появились позже — дозаписываем сайтам, созданным до них.
    if (!site.kind) {
      site.kind = 'static'
      site.command = ''
      site.targetPort = 0
      changed = true
    }
    if (site.tunnelCommand === undefined) {
      site.tunnelCommand = ''
      changed = true
    }
    if (site.group === undefined) {
      site.group = ''
      site.archived = false
      changed = true
    }
    if (site.iconPath === undefined) {
      site.iconPath = ''
      changed = true
    }
    if (site.tunnelOpen === undefined) {
      site.tunnelOpen = false
      changed = true
    }
    if (site.section === undefined) {
      site.section = ''
      changed = true
    }
  }
  if (changed) store.set('sites', sites)
  return sites
}

export function getSite(id: string): Site | undefined {
  return allSites().find((s) => s.id === id)
}

export function findByPath(dir: string): Site | undefined {
  const target = path.resolve(dir)
  return allSites().find((s) => path.resolve(s.path) === target)
}

export function takenPorts(exceptId?: string): Set<number> {
  return new Set(allSites().filter((s) => s.id !== exceptId).map((s) => s.port))
}

export function createSite(dir: string, port: number): Site {
  const site: Site = {
    id: randomUUID(),
    name: path.basename(dir) || dir,
    path: path.resolve(dir),
    port,
    spa: false,
    liveReload: true,
    lan: false,
    token: newToken(),
    kind: 'static',
    command: '',
    targetPort: 0,
    tunnelCommand: '',
    group: '',
    section: '',
    archived: false,
    iconPath: '',
    tunnelOpen: false,
    autoStart: false,
    createdAt: Date.now()
  }
  store.set('sites', [...allSites(), site])
  return site
}

export function updateSite(id: string, patch: Partial<Omit<Site, 'id' | 'createdAt'>>): Site {
  const sites = allSites()
  const index = sites.findIndex((s) => s.id === id)
  if (index === -1) throw new Error(t('Сайт не найден'))
  const next: Site = { ...sites[index], ...patch }
  if (patch.path) next.path = path.resolve(patch.path)
  sites[index] = next
  store.set('sites', sites)
  return next
}

export function deleteSite(id: string): void {
  store.set('sites', allSites().filter((s) => s.id !== id))
}

export function getRemote(): RemoteConfig {
  const remote = store.get('remote')
  // Пустой или старого формата (без дефисов) — выдаём набираемый пароль.
  if (!remote.token || !remote.token.includes('-')) {
    remote.token = newPassphrase()
    store.set('remote', remote)
  }
  return remote
}

export function regenerateRemoteToken(): RemoteConfig {
  const next = { ...getRemote(), token: newPassphrase() }
  store.set('remote', next)
  return next
}

export function setRemote(patch: Partial<RemoteConfig>): RemoteConfig {
  const next = { ...getRemote(), ...patch }
  store.set('remote', next)
  return next
}

// ---------- папки ----------

function saveFolders(folders: Folder[]): Folder[] {
  store.set('folders', folders)
  const icons: Record<string, string> = {}
  for (const f of folders) if (f.icon) icons[f.name] = f.icon
  store.set('sphereIcons', icons)
  return folders
}

/** Папки в порядке показа. Группа, заданная сайту, но ещё не ставшая папкой, дописывается в конец. */
export function listFolders(): Folder[] {
  const saved = store.get('folders') ?? []
  const icons = store.get('sphereIcons') ?? {}
  const folders: Folder[] = saved.length
    ? [...saved]
    : Object.keys(icons)
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({ name, icon: icons[name] ?? '', manual: false }))
  const known = new Set(folders.map((f) => f.name))
  const used = [...new Set(allSites().map((s) => s.group.trim()).filter(Boolean))]
  let changed = !saved.length
  for (const name of used.sort((a, b) => a.localeCompare(b))) {
    if (known.has(name)) continue
    folders.push({ name, icon: icons[name] ?? '', manual: false })
    changed = true
  }
  return changed ? saveFolders(folders) : folders
}

function folderName(raw: string): string {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (!name) throw new Error(t('Название папки не может быть пустым'))
  if (name.length > 40) throw new Error(t('Название папки — не длиннее 40 символов'))
  return name
}

function assertFree(folders: Folder[], name: string, except?: string): void {
  const clash = folders.find((f) => f.name !== except && f.name.toLowerCase() === name.toLowerCase())
  if (clash) throw new Error(t('Папка «{name}» уже есть', { name: clash.name }))
}

export function createFolder(raw: string, icon = ''): Folder[] {
  const name = folderName(raw)
  const folders = listFolders()
  assertFree(folders, name)
  return saveFolders([...folders, { name, icon: icon.trim().slice(0, 8), manual: false }])
}

export function renameFolder(from: string, raw: string): Folder[] {
  const name = folderName(raw)
  const folders = listFolders()
  if (!folders.some((f) => f.name === from)) throw new Error(t('Папка не найдена'))
  assertFree(folders, name, from)
  const sites = allSites().map((s) => (s.group === from ? { ...s, group: name } : s))
  store.set('sites', sites)
  return saveFolders(folders.map((f) => (f.name === from ? { ...f, name } : f)))
}

export function updateFolder(name: string, patch: Partial<Pick<Folder, 'icon' | 'manual'>>): Folder[] {
  const folders = listFolders()
  if (!folders.some((f) => f.name === name)) throw new Error(t('Папка не найдена'))
  const clean: Partial<Folder> = {}
  if (typeof patch.icon === 'string') clean.icon = patch.icon.trim().slice(0, 8)
  if (typeof patch.manual === 'boolean') clean.manual = patch.manual
  return saveFolders(folders.map((f) => (f.name === name ? { ...f, ...clean } : f)))
}

/** Сайты удалённой папки остаются в списке — уходят в «Без папки». */
export function deleteFolder(name: string): Folder[] {
  const folders = listFolders()
  store.set('sites', allSites().map((s) => (s.group === name ? { ...s, group: NO_FOLDER, section: '' } : s)))
  return saveFolders(folders.filter((f) => f.name !== name))
}

export function reorderFolders(names: string[]): Folder[] {
  const folders = listFolders()
  const byName = new Map(folders.map((f) => [f.name, f]))
  const ordered = names.map((n) => byName.get(n)).filter((f): f is Folder => Boolean(f))
  const rest = folders.filter((f) => !names.includes(f.name))
  return saveFolders([...ordered, ...rest])
}

/** Перенести сайты в папку (пусто — «Без папки»). Раздел сбрасывается, если папка сменилась, или задаётся явно. */
export function moveSites(ids: string[], group: string, section?: string): void {
  const target = group.trim()
  if (target && !listFolders().some((f) => f.name === target)) throw new Error(t('Папка не найдена'))
  const wanted = new Set(ids)
  store.set(
    'sites',
    allSites().map((s) => {
      if (!wanted.has(s.id)) return s
      const nextSection = section !== undefined ? section.trim() : s.group === target ? s.section : ''
      return { ...s, group: target, section: nextSection }
    })
  )
}

/** То, что запускает «Запустить все»: без архива и без папок «только вручную». */
export function bulkSites(): Site[] {
  const manual = new Set(listFolders().filter((f) => f.manual).map((f) => f.name))
  return allSites().filter((s) => !s.archived && !manual.has(s.group))
}

// ---------- язык ----------

export function getLanguage(): LangSetting {
  const value = store.get('language')
  return value === 'ru' || value === 'en' ? value : 'system'
}

export function setLanguage(value: LangSetting): LangSetting {
  const next: LangSetting = value === 'ru' || value === 'en' ? value : 'system'
  store.set('language', next)
  return next
}
