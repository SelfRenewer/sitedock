import { Menu, Tray, nativeImage, app } from 'electron'
import { manager } from './server/ServerManager'
import { allSites } from './store'
import { t } from '../shared/i18n'

let tray: Tray | null = null
let refresh: () => void = () => undefined
let showWindow: () => void = () => undefined

/**
 * Рисуем иконку прямо в памяти (BGRA), чтобы не тащить файл-ассет в бандл.
 * Кольцо — если ничего не запущено, залитый круг — если что-то работает.
 */
function trayIcon(filled: boolean): Electron.NativeImage {
  const size = 36
  const scale = 2
  const buf = Buffer.alloc(size * size * 4)
  const center = (size - 1) / 2
  const outer = 11
  const inner = 7.5

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x - center, y - center)
      let alpha = 0
      if (dist <= outer) {
        if (filled || dist >= inner) {
          alpha = Math.round(255 * Math.min(1, outer - dist + 0.5))
        }
      }
      if (!filled && dist < inner) {
        alpha = Math.round(255 * Math.min(1, Math.max(0, dist - inner + 1.5)))
      }
      const offset = (y * size + x) * 4
      buf[offset] = 0
      buf[offset + 1] = 0
      buf[offset + 2] = 0
      buf[offset + 3] = alpha
    }
  }

  const image = nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: scale })
  image.setTemplateImage(true)
  return image
}

export function createTray(actions: { refresh: () => void; showWindow: () => void }): void {
  refresh = actions.refresh
  showWindow = actions.showWindow
  tray = new Tray(trayIcon(false))
  tray.setIgnoreDoubleClickEvents(true)
  updateTray()
}

export function updateTray(): void {
  if (!tray) return

  const sites = allSites()
  const running = manager.runningCount()

  tray.setImage(trayIcon(running > 0))
  tray.setTitle(running > 0 ? ` ${running}` : '')
  tray.setToolTip(running > 0 ? t('SiteDock — запущено: {running}', { running }) : 'SiteDock')

  const siteItems: Electron.MenuItemConstructorOptions[] = sites.map((site) => {
    const isRunning = manager.isRunning(site.id)
    return {
      label: `${isRunning ? '●' : '○'}  ${site.name}  :${site.port}`,
      click: async () => {
        try {
          if (isRunning) await manager.stop(site.id)
          else await manager.start(site.id)
        } catch {
          // подробности покажет окно после refresh
        }
        refresh()
      }
    }
  })

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t('Открыть SiteDock'), click: () => showWindow() },
      { type: 'separator' },
      ...(siteItems.length ? siteItems : [{ label: t('Сайтов пока нет'), enabled: false }]),
      { type: 'separator' },
      {
        label: t('Остановить все'),
        enabled: running > 0,
        click: async () => {
          await manager.stopAll()
          refresh()
        }
      },
      { type: 'separator' },
      { label: t('Выйти'), click: () => app.quit() }
    ])
  )
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
