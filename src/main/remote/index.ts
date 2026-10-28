import type { RemoteView } from '../../shared/types'
import { lanAddress } from '../net'
import { manager } from '../server/ServerManager'
import { allSites, bulkSites, getRemote, regenerateRemoteToken, setRemote, updateSite } from '../store'
import { buildViews, pushState } from '../views'
import { RemoteServer } from './server'

export const remote = new RemoteServer({
  // Архивные работы в пульте не показываем — он для актуального.
  state: () => ({ ip: lanAddress(), sites: buildViews().filter((s) => !s.archived) }),

  startSite: async (id) => {
    await manager.start(id)
    pushState()
  },

  stopSite: async (id) => {
    await manager.stop(id)
    pushState()
  },

  /** «Открыть в сеть» с пульта: без этого сайт слушает только сам мак. */
  enableLan: async (id) => {
    updateSite(id, { lan: true })
    await manager.restartIfRunning(id)
    pushState()
  },

  startTunnel: async (id) => {
    const site = allSites().find((s) => s.id === id)
    if (site && !site.tunnelCommand.trim()) {
      const next = updateSite(id, {
        tunnelCommand: 'cloudflared tunnel --url http://127.0.0.1:{port}'
      })
      manager.applyConfig(id, next)
    }
    await manager.startTunnel(id)
    pushState()
  },

  stopTunnel: async (id) => {
    await manager.stopTunnel(id)
    pushState()
  },

  startAll: async () => {
    await manager.startAll(bulkSites()) // без архива и папок «только вручную»
    pushState()
  },

  stopAll: async () => {
    await manager.stopAll()
    pushState()
  }
})

export function remoteView(): RemoteView {
  const config = getRemote()
  return {
    ...config,
    running: remote.running,
    ip: lanAddress(),
    url: remote.running ? remote.url() : null,
    plainUrl: remote.running ? remote.plainUrl() : null,
    error: remote.error
  }
}

/** Привести работающий пульт в соответствие с настройками. */
export async function applyRemote(): Promise<RemoteView> {
  const config = getRemote()
  if (config.enabled) await remote.start(config)
  else await remote.stop()
  return remoteView()
}

const LAUNCH_RETRY_MS = 1000
const LAUNCH_ATTEMPTS = 30

/**
 * Старт пульта при запуске приложения. После быстрого перезапуска старый
 * процесс ещё может держать порт — ждём, пока отпустит, вместо одной попытки.
 */
export async function applyRemoteOnLaunch(onRetry?: () => void): Promise<RemoteView> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await applyRemote()
    } catch (err) {
      // Пульт выключили, пока ждали, — ждать больше нечего.
      if (!getRemote().enabled) return remoteView()
      const busy = (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
      if (!busy || attempt >= LAUNCH_ATTEMPTS) throw err
      onRetry?.()
      await new Promise((resolve) => setTimeout(resolve, LAUNCH_RETRY_MS))
    }
  }
}

export async function updateRemote(patch: Parameters<typeof setRemote>[0]): Promise<RemoteView> {
  setRemote(patch)
  return applyRemote()
}

/** Новый пароль: старые вкладки на ПК разлогинятся при следующем запросе. */
export async function regenerateRemote(): Promise<RemoteView> {
  regenerateRemoteToken()
  return applyRemote()
}
