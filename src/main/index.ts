import path from 'node:path'
import { BrowserWindow, app, nativeTheme, shell } from 'electron'
import { registerIpc } from './ipc'
import { applyRemoteOnLaunch, remote } from './remote'
import { manager } from './server/ServerManager'
import { allSites, getLanguage } from './store'
import { resolveLang, setLang } from '../shared/i18n'
import { createTray, destroyTray } from './tray'
import { pushState, toast } from './views'
import { t } from '../shared/i18n'

let mainWindow: BrowserWindow | null = null
let isQuitting = false

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 780,
    minHeight: 440,
    show: false,
    title: 'SiteDock',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f7',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // Любые window.open / target=_blank уходят в системный браузер.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Уведённый на внешний URL renderer унаследовал бы мост preload со всеми
  // IPC-каналами, поэтому наружу окно не пускаем вообще — только в браузер.
  const appOrigin = process.env['ELECTRON_RENDERER_URL'] ?? 'file://'
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(appOrigin)) return
    event.preventDefault()
    if (/^https?:/.test(url)) void shell.openExternal(url)
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    mainWindow = null
  })

  return win
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

async function autoStartSites(): Promise<void> {
  const targets = allSites().filter((s) => s.autoStart)
  if (!targets.length) return
  const failures = await manager.startAllWaitingForPorts(targets)
  pushState()
  for (const { id, error } of failures) {
    const name = allSites().find((s) => s.id === id)?.name ?? id
    toast({ kind: 'error', text: t('Автозапуск «{name}»: {message}', { name, message: error.message }) })
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())

  void app.whenReady().then(async () => {
    setLang(resolveLang(getLanguage(), app.getLocale()))
    registerIpc()
    manager.setOnChange(pushState)
    mainWindow = createWindow()
    createTray({ refresh: pushState, showWindow })
    // Автозапуск может ждать освобождения портов — окно и пульт его не ждут.
    void autoStartSites()
    // Пульт поднимается только если его включили в настройках. Ожидание порта
    // не держит остальной запуск: окно и трей уже работают.
    void applyRemoteOnLaunch(pushState)
      .catch((err: Error) => {
        toast({ kind: 'error', text: t('Пульт не запустился: {message}', { message: err.message }) })
      })
      .finally(pushState)
    pushState()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
      else showWindow()
    })
  })
}

// Окно закрыли — приложение живёт в menu bar.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (isQuitting) return
  isQuitting = true
  event.preventDefault()
  // Гасим серверы и ждём закрытия хендлов, только потом выходим.
  void remote
    .stop()
    .catch(() => undefined)
    .then(() => manager.stopAll())
    .catch(() => undefined)
    .finally(() => {
      destroyTray()
      app.quit()
    })
})
