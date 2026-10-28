import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import serveHandler from 'serve-handler'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Site, SiteStatus } from '../../shared/types'
import { findFreePort, isPortFree } from '../ports'
import { pushLog } from '../logs'
import { injectIntoHtml, LIVE_RELOAD_PATH, LIVE_RELOAD_SNIPPET } from './inject'
import { BackendProcess } from './backend'
import { TunnelProcess, waitReachable } from './tunnel'
import { proxyRequest, proxyUpgrade } from './proxy'
import {
  TOKEN_COOKIE,
  TOKEN_PARAM,
  isAllowedHost,
  isLoopback,
  liveReloadAllowed,
  readCookie,
  tokenMatches
} from './access'
import { t } from '../../shared/i18n'

export class PortBusyError extends Error {
  constructor(public readonly port: number) {
    super(t('Порт {port} занят другим процессом.', { port }))
    this.name = 'PortBusyError'
  }
}

/** Порт самого приложения (режим команды) ещё занят — например, старым процессом. */
export class BackendPortBusyError extends Error {
  constructor(public readonly port: number) {
    super(t('Порт {port} уже занят — возможно, приложение запущено мимо SiteDock.', { port }))
    this.name = 'BackendPortBusyError'
  }
}

export interface SiteRuntime {
  status: SiteStatus
  error: string | null
}

export class SiteServer {
  private server: http.Server | null = null
  private wss: WebSocketServer | null = null
  private watcher: FSWatcher | null = null
  private sockets = new Set<WebSocket>()
  private reloadTimer: NodeJS.Timeout | null = null
  private backend: BackendProcess | null = null
  private backendPort = 0
  private tunnel: TunnelProcess | null = null
  private tunnelHost: string | null = null
  tunnelStatus: 'off' | 'starting' | 'on' | 'error' = 'off'
  tunnelError: string | null = null
  tunnelUrl: string | null = null

  status: SiteStatus = 'stopped'
  error: string | null = null

  constructor(
    private site: Site,
    private readonly onChange: () => void
  ) {}

  get host(): string {
    return this.site.lan ? '0.0.0.0' : '127.0.0.1'
  }

  /** Обновить конфиг без рестарта (для остановленного сайта). */
  applyConfig(site: Site): void {
    this.site = site
  }

  private setStatus(status: SiteStatus, error: string | null = null): void {
    this.status = status
    this.error = error
    this.onChange()
  }

  async start(): Promise<void> {
    if (this.status === 'running' || this.status === 'starting') return

    const root = path.resolve(this.site.path)
    const stat = await fs.promises.stat(root).catch(() => null)
    if (!stat?.isDirectory()) {
      this.setStatus('error', t('Папка не найдена'))
      throw Object.assign(new Error(t('Папка не найдена: {root}', { root })), { code: 'no-folder' })
    }

    this.setStatus('starting')

    if (!(await isPortFree(this.site.port, this.host))) {
      this.setStatus('error', t('Порт {port} занят', { port: this.site.port }))
      throw new PortBusyError(this.site.port)
    }

    if (this.site.kind === 'command') {
      try {
        await this.startBackend(root)
      } catch (err) {
        this.setStatus('error', (err as Error).message)
        throw err
      }
    }

    const server = http.createServer((req, res) => this.handle(req, res, root))

    if (this.site.kind === 'command') {
      // Websocket-соединения приложения проходят насквозь.
      server.on('upgrade', (req, socket, head) => {
        const viaTunnel = this.isTunnelHost(req.headers.host)
        if (!viaTunnel && !isAllowedHost(req.headers.host)) return socket.destroy()
        const needsKey = viaTunnel ? !this.site.tunnelOpen : !isLoopback(req.socket.remoteAddress)
        if (needsKey) {
          const key = readCookie(req.headers.cookie, TOKEN_COOKIE)
          if (!tokenMatches(key, this.site.token)) return socket.destroy()
        }
        proxyUpgrade(req, socket, head, this.backendPort)
      })
    }
    server.on('error', (err: NodeJS.ErrnoException) => {
      const message = err.code === 'EADDRINUSE' ? t('Порт {port} занят', { port: this.site.port }) : err.message
      this.setStatus('error', message)
      void this.stop()
    })

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error): void => reject(err)
        server.once('error', onError)
        server.listen(this.site.port, this.host, () => {
          server.off('error', onError)
          resolve()
        })
      })
    } catch (err) {
      const error = err as NodeJS.ErrnoException
      this.setStatus('error', error.code === 'EADDRINUSE' ? t('Порт {port} занят', { port: this.site.port }) : error.message)
      if (error.code === 'EADDRINUSE') throw new PortBusyError(this.site.port)
      throw error
    }

    this.server = server

    // Live reload имеет смысл только для статики: у приложения свой сервер.
    if (this.site.liveReload && this.site.kind === 'static') {
      this.startLiveReload(server, root)
    }

    this.setStatus('running')
  }

  private startLiveReload(server: http.Server, root: string): void {
    this.wss = new WebSocketServer({
      server,
      path: LIVE_RELOAD_PATH,
      // WebSocket не подчиняется same-origin policy: без этой проверки любой
      // открытый в браузере сайт мог бы подключиться к сокету live-reload,
      // перебрать localhost-порты и узнать, где работает SiteDock.
      // Origin шлют только браузеры, поэтому его отсутствие пропускаем.
      // The same gate as the pages: through the tunnel the key is needed too (it comes from 127.0.0.1).
      verifyClient: ({ origin, req }, done) =>
        done(
          liveReloadAllowed({
            host: req.headers.host,
            remoteAddress: req.socket.remoteAddress,
            cookie: req.headers.cookie,
            origin,
            token: this.site.token,
            port: this.site.port,
            tunnelHost: this.tunnelHost,
            tunnelOpen: this.site.tunnelOpen
          })
        )
    })
    this.wss.on('connection', (socket) => {
      this.sockets.add(socket)
      socket.on('close', () => this.sockets.delete(socket))
      socket.on('error', () => this.sockets.delete(socket))
    })

    this.watcher = chokidar.watch(root, {
      ignoreInitial: true,
      ignored: (target: string) =>
        target.includes(`${path.sep}node_modules`) ||
        target.includes(`${path.sep}.git`) ||
        path.basename(target).startsWith('.'),
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 }
    })
    this.watcher.on('all', () => this.scheduleReload())
    this.watcher.on('error', (err) => {
      this.setStatus('error', t('Наблюдение за папкой упало: {p0}', { p0: (err as Error).message }))
    })
  }

  private scheduleReload(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer)
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null
      for (const socket of this.sockets) {
        if (socket.readyState === 1) socket.send('reload')
      }
    }, 60)
  }

  /**
   * Запросы не с этой машины (то есть режим «Доступ по локальной сети»)
   * пускаем только с ключом. Ключ приходит из QR-ссылки один раз, дальше
   * живёт в cookie, чтобы не тащиться в каждом URL.
   * Возвращает false, если ответ уже отправлен и обработку надо прекратить.
   */
  private authorize(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const fromQuery = url.searchParams.get(TOKEN_PARAM)
    const key = fromQuery ?? readCookie(req.headers.cookie, TOKEN_COOKIE)

    if (!tokenMatches(key, this.site.token)) {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        `<!doctype html><meta charset="utf-8"><title>${t('Нужен ключ доступа')}</title>` +
          '<body style="font:15px -apple-system,system-ui,sans-serif;padding:40px;max-width:32em">' +
          `<h1 style="font-size:17px">${t('Нужен ключ доступа')}</h1>` +
          `<p>${t('Этот сайт открыт только по ссылке из SiteDock. Отсканируйте QR-код на карточке сайта или откройте ссылку целиком, вместе с ключом.')}</p>`
      )
      return false
    }

    if (fromQuery) {
      // Прячем ключ из адресной строки: дальше его несёт cookie.
      url.searchParams.delete(TOKEN_PARAM)
      res.writeHead(302, {
        'Set-Cookie': `${TOKEN_COOKIE}=${encodeURIComponent(this.site.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
        Location: `${url.pathname}${url.search}`
      })
      res.end()
      return false
    }

    return true
  }

  private async startBackend(root: string): Promise<void> {
    const command = this.site.command.trim()
    if (!command) throw new Error(t('Не задана команда запуска'))

    // Порт приложения держим приватным: наружу его никто не видит, поэтому
    // при незаданном значении просто берём свободный и отдаём в PORT.
    if (this.site.targetPort > 0) {
      this.backendPort = this.site.targetPort
    } else {
      const free = await findFreePort(39000, new Set([this.site.port]))
      if (!free) throw new Error(t('Не нашлось свободного порта для приложения'))
      this.backendPort = free
    }

    if (!(await isPortFree(this.backendPort, '127.0.0.1'))) {
      throw new BackendPortBusyError(this.backendPort)
    }

    const backend = new BackendProcess(command, root, this.backendPort, (reason) => {
      if (this.backend !== backend) return
      this.setStatus('error', reason)
      void this.stop()
    })
    this.backend = backend
    await backend.start()
  }

  private isTunnelHost(host: string | undefined): boolean {
    if (!host || !this.tunnelHost) return false
    return host.split(':')[0].toLowerCase() === this.tunnelHost
  }

  private setTunnel(
    status: 'off' | 'starting' | 'on' | 'error',
    url: string | null,
    error: string | null
  ): void {
    this.tunnelStatus = status
    this.tunnelUrl = url
    this.tunnelError = error
    this.tunnelHost = url ? new URL(url).hostname.toLowerCase() : null
    this.onChange()
  }

  async startTunnel(): Promise<string> {
    if (this.tunnelStatus === 'on' || this.tunnelStatus === 'starting') {
      return this.tunnelUrl ?? ''
    }
    const command = this.site.tunnelCommand.replace(/\{port\}/g, String(this.site.port)).trim()
    if (!command) throw new Error(t('Не задана команда туннеля'))
    if (this.status !== 'running') throw new Error(t('Сначала запустите сам сайт'))

    this.setTunnel('starting', null, null)
    const tunnel = new TunnelProcess(command, path.resolve(this.site.path), (reason) => {
      if (this.tunnel !== tunnel) return
      this.tunnel = null
      this.setTunnel('error', null, reason)
    })
    this.tunnel = tunnel

    try {
      const url = await tunnel.start()
      // Адрес готов — сразу отдаём его и разрешаем этот Host.
      this.setTunnel('on', url, null)

      // Cloudflare начинает обслуживать имя не мгновенно. Проверяем это в
      // фоне: держать кнопку заблокированной две минуты недопустимо.
      void waitReachable(url).then((state) => {
        if (this.tunnel !== tunnel || this.tunnelStatus !== 'on') return
        if (state === 'dns') {
          this.setTunnel(
            'on',
            url,
            t('Имя туннеля ещё не разошлось по DNS. Подождите минуту и обновите вкладку — если не поможет, поднимите туннель заново.')
          )
        } else if (state === 'unreachable') {
          this.setTunnel(
            'on',
            url,
            t('Адрес пока отдаёт 1033 — Cloudflare ещё не начал его обслуживать')
          )
        }
      })

      return url
    } catch (err) {
      this.tunnel = null
      this.setTunnel('error', null, (err as Error).message)
      throw err
    }
  }

  async stopTunnel(): Promise<void> {
    const tunnel = this.tunnel
    this.tunnel = null
    if (tunnel) await tunnel.stop()
    this.setTunnel('off', null, null)
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse, root: string): void {
    const started = Date.now()
    const method = req.method ?? 'GET'
    const requestPath = safePathname(req.url)

    res.on('finish', () => {
      pushLog({
        ts: Date.now(),
        siteId: this.site.id,
        siteName: this.site.name,
        method,
        path: requestPath,
        status: res.statusCode,
        ms: Date.now() - started
      })
    })

    // Туннель приходит с локального адреса, но по своему доменному имени —
    // значит запрос из интернета, и ключ обязателен, несмотря на loopback.
    const viaTunnel = this.isTunnelHost(req.headers.host)

    if (!viaTunnel && !isAllowedHost(req.headers.host)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(t('Обращение по неизвестному имени хоста отклонено.'))
      return
    }

    // Туннель смотрит в интернет, поэтому ключ обязателен — если только сайт
    // не защищён своим входом и владелец явно не снял с туннеля наш замок.
    const needsKey = viaTunnel ? !this.site.tunnelOpen : !isLoopback(req.socket.remoteAddress)
    if (needsKey && !this.authorize(req, res)) return

    if (this.site.kind === 'command') {
      proxyRequest(req, res, this.backendPort)
      return
    }

    // serve-handler отдаёт dotfiles по умолчанию и лишь прячет их из листинга,
    // так что .env и .git/config уезжали бы целиком любому, кто знает путь.
    if (hasHiddenSegment(requestPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not found')
      return
    }

    if (this.site.liveReload) injectIntoHtml(res, LIVE_RELOAD_SNIPPET)

    if (method === 'GET' || method === 'HEAD') {
      const resolved = path.resolve(root, `.${requestPath}`)
      const inside = resolved === root || resolved.startsWith(root + path.sep)
      const stat = inside ? statSafe(resolved) : null

      if (stat?.isDirectory()) {
        // serve-handler при cleanUrls:false не отдаёт index.html для
        // директорий, а при cleanUrls:true редиректит /about.html → /about.
        // Нам нужно и то и другое, поэтому индекс директории резолвим сами.
        if (fs.existsSync(path.join(resolved, 'index.html'))) {
          if (!requestPath.endsWith('/')) {
            // Без слэша поехали бы относительные пути внутри самой страницы.
            const query = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''
            res.writeHead(301, { Location: `${encodeURI(requestPath)}/${query}` })
            res.end()
            return
          }
          req.url = `${encodeURI(requestPath)}index.html`
        }
        // Индекса нет — пусть serve-handler отрисует листинг.
      } else if (!stat && this.site.spa && fs.existsSync(path.join(root, 'index.html'))) {
        // SPA: любой несуществующий путь отдаём как index.html. Через rewrites
        // serve-handler так нельзя — они матчат безусловно и ломают ассеты.
        req.url = '/index.html'
      }
    }

    void serveHandler(req, res, {
      public: root,
      cleanUrls: false,
      etag: false,
      // Без index.html serve-handler сам отрисует листинг директории.
      directoryListing: true,
      // a symlink could point anywhere on the disk (~/.ssh): not followed
      symlinks: false,
      headers: [{ source: '**', headers: [{ key: 'Cache-Control', value: 'no-store' }] }]
    }).catch((err: Error) => {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(t('Ошибка отдачи файла: {message}', { message: err.message }))
    })
  }

  /**
   * clearError — остановка руками: старая ошибка больше не актуальна.
   * Внутренние остановки после сбоя ошибку сохраняют, чтобы её было видно.
   */
  async stop(clearError = false): Promise<void> {
    if (this.tunnel) {
      const tunnel = this.tunnel
      this.tunnel = null
      await tunnel.stop()
      this.setTunnel('off', null, null)
    }

    if (this.backend) {
      const backend = this.backend
      this.backend = null
      await backend.stop()
    }

    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer)
      this.reloadTimer = null
    }

    if (this.watcher) {
      await this.watcher.close().catch(() => undefined)
      this.watcher = null
    }

    for (const socket of this.sockets) socket.terminate()
    this.sockets.clear()

    if (this.wss) {
      await new Promise<void>((resolve) => this.wss!.close(() => resolve()))
      this.wss = null
    }

    if (this.server) {
      const server = this.server
      this.server = null
      // closeAllConnections — иначе keep-alive соединения держат close() бесконечно.
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }

    if (clearError || this.status !== 'error') this.setStatus('stopped')
  }
}

function safePathname(url: string | undefined): string {
  if (!url) return '/'
  try {
    return decodeURIComponent(new URL(url, 'http://localhost').pathname)
  } catch {
    return url.split('?')[0]
  }
}

function statSafe(target: string): fs.Stats | null {
  try {
    return fs.statSync(target)
  } catch {
    return null
  }
}

/**
 * Скрытым считается любой сегмент пути, начинающийся с точки, кроме
 * .well-known — он часть веб-стандартов и нужен обычным статическим сайтам.
 */
function hasHiddenSegment(pathname: string): boolean {
  return pathname
    .split('/')
    .some((segment) => segment.startsWith('.') && segment !== '.' && segment !== '.well-known')
}
