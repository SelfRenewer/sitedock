import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  BulkResult,
  Folder,
  LogEntry,
  RemoteConfig,
  RemoteView,
  Site,
  SiteView,
  StartResult,
  ToastPayload
} from '../shared/types'
import type { Lang, LangSetting } from '../shared/i18n'

type Unsubscribe = () => void

function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_event: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.off(channel, listener)
}

const api = {
  getLanguage: (): Promise<{ setting: LangSetting; lang: Lang }> => ipcRenderer.invoke('app:language'),
  setLanguage: (value: LangSetting): Promise<{ setting: LangSetting; lang: Lang }> =>
    ipcRenderer.invoke('app:setLanguage', value),
  getRemote: (): Promise<RemoteView> => ipcRenderer.invoke('remote:get'),
  updateRemote: (patch: Partial<RemoteConfig>): Promise<RemoteView> =>
    ipcRenderer.invoke('remote:update', patch),
  regenerateRemote: (): Promise<RemoteView> => ipcRenderer.invoke('remote:regenerate'),
  startTunnel: (id: string): Promise<string> => ipcRenderer.invoke('site:tunnelStart', id),
  stopTunnel: (id: string): Promise<void> => ipcRenderer.invoke('site:tunnelStop', id),
  pickIcon: (id: string): Promise<string | null> => ipcRenderer.invoke('sites:pickIcon', id),
  resetIcon: (id: string): Promise<void> => ipcRenderer.invoke('sites:resetIcon', id),
  folders: (): Promise<Folder[]> => ipcRenderer.invoke('folders:list'),
  createFolder: (name: string, icon?: string): Promise<Folder[]> => ipcRenderer.invoke('folders:create', name, icon),
  renameFolder: (from: string, to: string): Promise<Folder[]> => ipcRenderer.invoke('folders:rename', from, to),
  updateFolder: (name: string, patch: Partial<Pick<Folder, 'icon' | 'manual'>>): Promise<Folder[]> =>
    ipcRenderer.invoke('folders:update', name, patch),
  deleteFolder: (name: string): Promise<Folder[]> => ipcRenderer.invoke('folders:delete', name),
  reorderFolders: (names: string[]): Promise<Folder[]> => ipcRenderer.invoke('folders:reorder', names),
  moveSites: (ids: string[], group: string, section?: string): Promise<Folder[]> =>
    ipcRenderer.invoke('sites:move', ids, group, section),
  listSites: (): Promise<SiteView[]> => ipcRenderer.invoke('sites:list'),
  addSites: (group?: string): Promise<{ added: number; skipped: string[] }> => ipcRenderer.invoke('sites:add', group),
  addPaths: (paths: string[], group?: string): Promise<{ added: number; skipped: string[] }> =>
    ipcRenderer.invoke('sites:addPaths', paths, group),
  updateSite: (id: string, patch: Partial<Site>): Promise<Site> =>
    ipcRenderer.invoke('sites:update', id, patch),
  removeSite: (id: string): Promise<void> => ipcRenderer.invoke('sites:remove', id),
  relocateSite: (id: string): Promise<Site | null> => ipcRenderer.invoke('sites:relocate', id),

  startSite: (id: string): Promise<StartResult> => ipcRenderer.invoke('site:start', id),
  stopSite: (id: string): Promise<void> => ipcRenderer.invoke('site:stop', id),
  startAll: (): Promise<BulkResult[]> => ipcRenderer.invoke('sites:startAll'),
  stopAll: (): Promise<void> => ipcRenderer.invoke('sites:stopAll'),
  startMany: (ids: string[]): Promise<BulkResult[]> => ipcRenderer.invoke('sites:startMany', ids),
  stopMany: (ids: string[]): Promise<void> => ipcRenderer.invoke('sites:stopMany', ids),

  siteIcon: (id: string): Promise<string | null> => ipcRenderer.invoke('sites:icon', id),
  suggestPort: (id?: string): Promise<number | null> => ipcRenderer.invoke('ports:suggest', id),
  qrCode: (text: string): Promise<string> => ipcRenderer.invoke('qr:make', text),

  listLogs: (): Promise<LogEntry[]> => ipcRenderer.invoke('logs:list'),
  clearLogs: (): Promise<void> => ipcRenderer.invoke('logs:clear'),

  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  showInFinder: (target: string): Promise<void> => ipcRenderer.invoke('shell:showInFolder', target),
  openInEditor: (target: string): Promise<void> => ipcRenderer.invoke('shell:openInEditor', target),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),

  /** File.path в Electron больше нет — путь достаётся только так. */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),

  onSites: (cb: (sites: SiteView[]) => void): Unsubscribe => subscribe('sites:changed', cb),
  onLog: (cb: (entry: LogEntry) => void): Unsubscribe => subscribe('logs:entry', cb),
  onToast: (cb: (payload: ToastPayload) => void): Unsubscribe => subscribe('app:toast', cb)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
