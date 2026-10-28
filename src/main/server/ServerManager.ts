import type { Site, SiteStatus } from '../../shared/types'
import { getSite } from '../store'
import { BackendPortBusyError, PortBusyError, SiteServer } from './SiteServer'
import { t } from '../../shared/i18n'

const PORT_WAIT_ATTEMPTS = 30
const PORT_WAIT_MS = 1000

const isPortBusy = (err: unknown): boolean =>
  err instanceof PortBusyError || err instanceof BackendPortBusyError

class ServerManager {
  private servers = new Map<string, SiteServer>()
  private onChange: () => void = () => undefined
  /** Сайты, которые автозапуск ждёт, пока освободится порт. */
  private portWait = new Set<string>()

  setOnChange(cb: () => void): void {
    this.onChange = cb
  }

  private notify = (): void => {
    this.onChange()
  }

  private ensure(site: Site): SiteServer {
    let server = this.servers.get(site.id)
    if (!server) {
      server = new SiteServer(site, this.notify)
      this.servers.set(site.id, server)
    } else {
      server.applyConfig(site)
    }
    return server
  }

  tunnel(id: string): {
    tunnelStatus: 'off' | 'starting' | 'on' | 'error'
    tunnelUrl: string | null
    tunnelError: string | null
  } {
    const server = this.servers.get(id)
    return {
      tunnelStatus: server?.tunnelStatus ?? 'off',
      tunnelUrl: server?.tunnelUrl ?? null,
      tunnelError: server?.tunnelError ?? null
    }
  }

  /** Подсунуть работающему серверу свежий конфиг сайта без перезапуска. */
  applyConfig(id: string, site: Site): void {
    this.servers.get(id)?.applyConfig(site)
  }

  async startTunnel(id: string): Promise<string> {
    const server = this.servers.get(id)
    if (!server) throw new Error(t('Сначала запустите сам сайт'))
    return server.startTunnel()
  }

  async stopTunnel(id: string): Promise<void> {
    await this.servers.get(id)?.stopTunnel()
  }

  state(id: string): { status: SiteStatus; error: string | null } {
    const server = this.servers.get(id)
    return { status: server?.status ?? 'stopped', error: server?.error ?? null }
  }

  isRunning(id: string): boolean {
    return this.servers.get(id)?.status === 'running'
  }

  runningIds(): string[] {
    return [...this.servers.entries()].filter(([, s]) => s.status === 'running').map(([id]) => id)
  }

  runningCount(): number {
    return this.runningIds().length
  }

  async start(id: string): Promise<void> {
    // Ручной запуск важнее ожидания автозапуска.
    this.portWait.delete(id)
    await this.startOne(id)
  }

  private async startOne(id: string): Promise<void> {
    const site = getSite(id)
    if (!site) throw new Error(t('Сайт не найден'))
    await this.ensure(site).start()
  }

  async stop(id: string): Promise<void> {
    // Остановили руками — автозапуск больше не пытается его поднять.
    this.portWait.delete(id)
    await this.servers.get(id)?.stop(true)
  }

  /** Перезапуск после смены настроек — только если сайт сейчас работает. */
  async restartIfRunning(id: string): Promise<void> {
    if (!this.isRunning(id)) {
      const site = getSite(id)
      if (site) this.servers.get(id)?.applyConfig(site)
      return
    }
    await this.stop(id)
    await this.start(id)
  }

  async startAll(sites: Site[]): Promise<{ id: string; error: Error }[]> {
    const failures: { id: string; error: Error }[] = []
    for (const site of sites) {
      if (this.isRunning(site.id)) continue
      try {
        await this.start(site.id)
      } catch (err) {
        failures.push({ id: site.id, error: err as Error })
      }
    }
    return failures
  }

  /**
   * Автозапуск при старте приложения. После быстрого перезапуска старый
   * процесс ещё может держать порты, поэтому «порт занят» повторяем, пока
   * порт не освободится. Сайт, который за это время запустили или остановили
   * руками, оставляем в покое.
   */
  async startAllWaitingForPorts(sites: Site[]): Promise<{ id: string; error: Error }[]> {
    const failures = new Map<string, Error>()
    for (const { id, error } of await this.startAll(sites)) failures.set(id, error)

    const pending = new Set([...failures].filter(([, err]) => isPortBusy(err)).map(([id]) => id))
    for (const id of pending) this.portWait.add(id)

    try {
      for (let attempt = 1; attempt < PORT_WAIT_ATTEMPTS && pending.size; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, PORT_WAIT_MS))
        for (const id of [...pending]) {
          if (!this.portWait.has(id) || !getSite(id)) {
            pending.delete(id)
            failures.delete(id)
            continue
          }
          try {
            await this.startOne(id)
            pending.delete(id)
            failures.delete(id)
          } catch (err) {
            failures.set(id, err as Error)
            if (!isPortBusy(err)) pending.delete(id)
          }
        }
      }
    } finally {
      for (const id of pending) this.portWait.delete(id)
    }

    return [...failures].map(([id, error]) => ({ id, error }))
  }

  async stopAll(): Promise<void> {
    this.portWait.clear()
    await Promise.all([...this.servers.values()].map((s) => s.stop()))
  }

  forget(id: string): void {
    this.servers.delete(id)
  }
}

export const manager = new ServerManager()
export { PortBusyError }
