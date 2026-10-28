import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import type { Site, SiteView, ToastPayload } from '../shared/types'
import { lanAddress, meshAddress } from './net'
import { manager } from './server/ServerManager'
import { allSites } from './store'
import { updateTray } from './tray'

function toView(site: Site): SiteView {
  const stat = fs.existsSync(site.path) ? fs.statSync(site.path) : null
  const exists = Boolean(stat?.isDirectory())
  const { status, error } = manager.state(site.id)
  const tunnel = manager.tunnel(site.id)
  const running = status === 'running'
  const ip = site.lan ? lanAddress() : null
  const mesh = site.lan ? meshAddress() : null

  return {
    ...site,
    status,
    error,
    exists,
    // Для режима команды index.html не нужен — страницы отдаёт само приложение.
    hasIndex:
      site.kind === 'command' || (exists && fs.existsSync(path.join(site.path, 'index.html'))),
    url: running ? `http://localhost:${site.port}` : null,
    lanUrl: running && site.lan && ip ? `http://${ip}:${site.port}/?k=${site.token}` : null,
    ...tunnel,
    meshUrl: running && mesh ? `http://${mesh}:${site.port}/?k=${site.token}` : null,
    // Ключ в адресе обязателен: туннель смотрит в интернет.
    // С открытым туннелем ссылка чистая — её можно просто отправить.
    tunnelUrl: tunnel.tunnelUrl
      ? site.tunnelOpen
        ? `${tunnel.tunnelUrl}/`
        : `${tunnel.tunnelUrl}/?k=${site.token}`
      : null
  }
}

export function buildViews(): SiteView[] {
  return allSites().map(toView)
}

/** Единственная точка синхронизации: окно + трей всегда получают одно и то же. */
export function pushState(): void {
  const views = buildViews()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('sites:changed', views)
  }
  updateTray()
}

export function toast(payload: ToastPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('app:toast', payload)
  }
}
