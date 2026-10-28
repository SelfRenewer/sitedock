import fs from 'node:fs/promises'
import { BrowserWindow, app, clipboard, dialog, ipcMain, shell } from 'electron'
import { toDataURL } from 'qrcode'
import {
  DEFAULT_PORT,
  type BulkResult,
  type Folder,
  type RemoteConfig,
  type Site,
  type SiteView,
  type StartResult
} from '../shared/types'
import { openInEditor } from './external'
import { findIcon, readIconFile } from './icons'
import { clearLogs, listLogs } from './logs'
import { findFreePort, isPortFree } from './ports'
import { regenerateRemote, remoteView, updateRemote } from './remote'
import { PortBusyError, manager } from './server/ServerManager'
import {
  allSites,
  bulkSites,
  createFolder,
  createSite,
  deleteFolder,
  deleteSite,
  findByPath,
  getLanguage,
  getSite,
  listFolders,
  moveSites,
  renameFolder,
  reorderFolders,
  setLanguage,
  takenPorts,
  updateFolder,
  updateSite
} from './store'
import { buildViews, pushState } from './views'
import { getLang, resolveLang, setLang, t } from '../shared/i18n'

/** Настройки, для которых работающий сервер надо поднять заново. */
const RESTART_KEYS: (keyof Site)[] = [
  'port',
  'path',
  'spa',
  'liveReload',
  'lan',
  'kind',
  'command',
  'targetPort',
  'tunnelOpen'
]

async function isDirectory(target: string): Promise<boolean> {
  const stat = await fs.stat(target).catch(() => null)
  return Boolean(stat?.isDirectory())
}

/** Добавленные сайты сразу попадают в открытую папку (пусто — «Без папки»). */
async function addDirectories(dirs: string[], group = ''): Promise<{ added: number; skipped: string[] }> {
  const skipped: string[] = []
  let added = 0
  const folder = listFolders().some((f) => f.name === group) ? group : ''

  for (const dir of dirs) {
    if (!(await isDirectory(dir))) {
      skipped.push(t('{dir} — это не папка', { dir }))
      continue
    }
    if (findByPath(dir)) {
      skipped.push(t('{dir} — уже в списке', { dir }))
      continue
    }
    const port = await findFreePort(DEFAULT_PORT, takenPorts())
    if (port === null) {
      skipped.push(t('{dir} — не нашлось свободного порта', { dir }))
      continue
    }
    const site = createSite(dir, port)
    if (folder) updateSite(site.id, { group: folder })
    added++
  }

  if (added) pushState()
  return { added, skipped }
}

function toStartResult(err: unknown, port: number, suggested: number | null): StartResult {
  if (err instanceof PortBusyError) {
    return {
      ok: false,
      code: 'port-busy',
      message: t('Порт {port} уже занят другим процессом.', { port }),
      port,
      suggested
    }
  }
  const message = (err as Error)?.message ?? String(err)
  // a code, not the words: the message is in the interface language
  const noFolder = (err as { code?: string } | null)?.code === 'no-folder'
  return { ok: false, code: noFolder ? 'no-folder' : 'error', message }
}

export function registerIpc(): void {
  ipcMain.handle('app:language', () => ({ setting: getLanguage(), lang: getLang() }))

  ipcMain.handle('app:setLanguage', (_e, value: string) => {
    const setting = setLanguage(value === 'ru' || value === 'en' ? value : 'system')
    setLang(resolveLang(setting, app.getLocale()))
    pushState() // the tray menu is rebuilt in the new language
    return { setting, lang: getLang() }
  })

  ipcMain.handle('remote:get', () => remoteView())

  ipcMain.handle('remote:update', async (_e, patch: Partial<RemoteConfig>) => {
    return updateRemote(patch)
  })

  ipcMain.handle('remote:regenerate', () => regenerateRemote())

  ipcMain.handle('site:tunnelStart', async (_e, id: string) => {
    const site = getSite(id)
    if (!site) throw new Error(t('Сайт не найден'))
    // Первый запуск — подставляем рабочую команду, если её ещё не задавали.
    if (!site.tunnelCommand.trim()) {
      const next = updateSite(id, {
        tunnelCommand: 'cloudflared tunnel --url http://127.0.0.1:{port}'
      })
      manager.applyConfig(id, next)
    }
    const url = await manager.startTunnel(id)
    pushState()
    return url
  })

  ipcMain.handle('site:tunnelStop', async (_e, id: string) => {
    await manager.stopTunnel(id)
    pushState()
  })

  ipcMain.handle('sites:list', (): SiteView[] => buildViews())

  ipcMain.handle('sites:add', async (_e, group?: string) => {
    const win = BrowserWindow.getAllWindows()[0]
    const result = win
      ? await dialog.showOpenDialog(win, {
          properties: ['openDirectory', 'multiSelections'],
          buttonLabel: t('Добавить')
        })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'multiSelections'] })
    if (result.canceled) return { added: 0, skipped: [] }
    return addDirectories(result.filePaths, String(group ?? ''))
  })

  ipcMain.handle('sites:addPaths', async (_e, paths: string[], group?: string) =>
    addDirectories(paths, String(group ?? ''))
  )

  ipcMain.handle('sites:move', (_e, ids: string[], group: string, section?: string) => {
    moveSites(ids.map(String), String(group ?? ''), section === undefined ? undefined : String(section))
    pushState()
    return listFolders()
  })

  ipcMain.handle('sites:startMany', async (_e, ids: string[]): Promise<BulkResult[]> => {
    const wanted = new Set(ids.map(String))
    const failures = await manager.startAll(allSites().filter((s) => wanted.has(s.id)))
    pushState()
    return failures.map(({ id, error }) => ({ id, name: getSite(id)?.name ?? id, message: error.message }))
  })

  ipcMain.handle('sites:stopMany', async (_e, ids: string[]) => {
    for (const id of ids.map(String)) await manager.stop(id)
    pushState()
  })

  ipcMain.handle('sites:update', async (_e, id: string, patch: Partial<Site>) => {
    const before = getSite(id)
    if (!before) throw new Error(t('Сайт не найден'))
    // Ключ доступа задаётся только в main — renderer его не переопределяет.
    delete patch.token

    if (typeof patch.port === 'number') {
      const port = Math.trunc(patch.port)
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        throw new Error(t('Порт должен быть числом от 1 до 65535'))
      }
      const clash = allSites().find((s) => s.id !== id && s.port === port)
      if (clash) throw new Error(t('Порт {port} уже закреплён за сайтом «{name}»', { port, name: clash.name }))
      if (port !== before.port && manager.isRunning(id)) {
        const host = (patch.lan ?? before.lan) ? '0.0.0.0' : '127.0.0.1'
        if (!(await isPortFree(port, host))) throw new Error(t('Порт {port} занят другим процессом', { port }))
      }
      patch.port = port
    }

    if (typeof patch.name === 'string') {
      const name = patch.name.trim()
      if (!name) throw new Error(t('Название не может быть пустым'))
      patch.name = name
    }

    const after = updateSite(id, patch)
    const needsRestart = RESTART_KEYS.some((key) => before[key] !== after[key])
    if (needsRestart) await manager.restartIfRunning(id)
    pushState()
    return after
  })

  ipcMain.handle('sites:remove', async (_e, id: string) => {
    await manager.stop(id)
    manager.forget(id)
    deleteSite(id) // папку на диске не трогаем
    pushState()
  })

  ipcMain.handle('sites:relocate', async (_e, id: string) => {
    const site = getSite(id)
    if (!site) throw new Error(t('Сайт не найден'))
    const win = BrowserWindow.getAllWindows()[0]
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory'],
      buttonLabel: t('Указать'),
      title: t('Новый путь для «{name}»', { name: site.name })
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const next = updateSite(id, { path: result.filePaths[0] })
    await manager.restartIfRunning(id)
    pushState()
    return next
  })

  ipcMain.handle('site:start', async (_e, id: string): Promise<StartResult> => {
    const site = getSite(id)
    if (!site) return { ok: false, code: 'error', message: t('Сайт не найден') }
    try {
      await manager.start(id)
      pushState()
      return { ok: true }
    } catch (err) {
      const suggested = await findFreePort(site.port + 1, takenPorts(id))
      pushState()
      return toStartResult(err, site.port, suggested)
    }
  })

  ipcMain.handle('site:stop', async (_e, id: string) => {
    await manager.stop(id)
    pushState()
  })

  ipcMain.handle('sites:startAll', async () => {
    // Без архива и без папок «только вручную» — иначе это сотня серверов разом.
    const failures = await manager.startAll(bulkSites())
    pushState()
    return failures.map(({ id, error }) => ({
      id,
      name: getSite(id)?.name ?? id,
      message: error.message
    }))
  })

  ipcMain.handle('sites:stopAll', async () => {
    await manager.stopAll()
    pushState()
  })

  ipcMain.handle('sites:icon', async (_e, id: string) => {
    const site = getSite(id)
    if (!site) return null
    if (site.iconPath) {
      const chosen = await readIconFile(site.iconPath)
      if (chosen) return chosen
      // Файл унесли — молча возвращаемся к автопоиску.
    }
    return findIcon(site.path)
  })

  ipcMain.handle('sites:pickIcon', async (_e, id: string) => {
    const site = getSite(id)
    if (!site) throw new Error(t('Сайт не найден'))
    const win = BrowserWindow.getAllWindows()[0]
    const options: Electron.OpenDialogOptions = {
      title: t('Иконка для «{name}»', { name: site.name }),
      buttonLabel: t('Выбрать'),
      defaultPath: site.path,
      properties: ['openFile'],
      filters: [{ name: t('Иконки'), extensions: ['svg', 'png', 'ico', 'jpg', 'jpeg', 'webp'] }]
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null

    const file = result.filePaths[0]
    if (!(await readIconFile(file))) {
      throw new Error(t('Не удалось прочитать файл: неподдерживаемый формат или больше 512 КБ'))
    }
    updateSite(id, { iconPath: file })
    pushState()
    return file
  })

  ipcMain.handle('folders:list', (): Folder[] => listFolders())

  ipcMain.handle('folders:create', (_e, name: string, icon?: string) => createFolder(String(name), String(icon ?? '')))

  ipcMain.handle('folders:rename', (_e, from: string, to: string) => {
    const folders = renameFolder(String(from), String(to))
    pushState()
    return folders
  })

  // Значок — короткая строка, обычно один эмодзи; длинный текст store обрежет.
  ipcMain.handle('folders:update', (_e, name: string, patch: Partial<Pick<Folder, 'icon' | 'manual'>>) =>
    updateFolder(String(name), patch ?? {})
  )

  ipcMain.handle('folders:delete', (_e, name: string) => {
    const folders = deleteFolder(String(name))
    pushState()
    return folders
  })

  ipcMain.handle('folders:reorder', (_e, names: string[]) => reorderFolders(names.map(String)))

  ipcMain.handle('sites:resetIcon', async (_e, id: string) => {
    updateSite(id, { iconPath: '' })
    pushState()
  })

  ipcMain.handle('ports:suggest', async (_e, id?: string) => findFreePort(DEFAULT_PORT, takenPorts(id)))

  ipcMain.handle('qr:make', async (_e, text: string) =>
    toDataURL(text, { margin: 1, width: 220, errorCorrectionLevel: 'M' })
  )

  ipcMain.handle('logs:list', () => listLogs())
  ipcMain.handle('logs:clear', () => {
    clearLogs()
  })

  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(t('Разрешены только http и https ссылки'))
    }
    await shell.openExternal(url)
  })

  ipcMain.handle('shell:showInFolder', async (_e, target: string) => {
    if (!(await isDirectory(target))) throw new Error(t('Папка не найдена'))
    const failure = await shell.openPath(target)
    if (failure) throw new Error(failure)
  })

  ipcMain.handle('shell:openInEditor', async (_e, target: string) => {
    if (!(await isDirectory(target))) throw new Error(t('Папка не найдена'))
    await openInEditor(target)
  })

  ipcMain.handle('clipboard:write', (_e, text: string) => {
    clipboard.writeText(text)
  })
}
