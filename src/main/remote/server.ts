import http from 'node:http'
import type { RemoteConfig } from '../../shared/types'
import { lanAddress } from '../net'
import { isPortFree } from '../ports'
import {
  TOKEN_COOKIE,
  TOKEN_PARAM,
  isAllowedHost,
  isLoopback,
  readCookie,
  remotePostAllowed,
  tokenMatches
} from '../server/access'
import { loginPage, remotePage } from './page'
import { t } from '../../shared/i18n'

const COOKIE = `${TOKEN_COOKIE}_remote`
const MAX_FAILS = 5
const LOCK_MS = 60_000

export interface RemoteHooks {
  state: () => unknown
  startSite: (id: string) => Promise<void>
  stopSite: (id: string) => Promise<void>
  enableLan: (id: string) => Promise<void>
  startTunnel: (id: string) => Promise<void>
  stopTunnel: (id: string) => Promise<void>
  startAll: () => Promise<void>
  stopAll: () => Promise<void>
}

/**
 * Пульт: тот же список сайтов, но по локальной сети.
 *
 * Он умеет запускать процессы, поэтому защищён так же, как сайты в LAN-режиме:
 * проверка Host от DNS rebinding и ключ доступа для всего, что не с этой машины.
 */
export class RemoteServer {
  private server: http.Server | null = null
  private config: RemoteConfig | null = null
  /** Пароль вводят руками, поэтому подбор надо притормаживать. */
  private fails = new Map<string, { count: number; until: number }>()
  error: string | null = null

  constructor(private readonly hooks: RemoteHooks) {}

  get running(): boolean {
    return this.server !== null
  }

  async start(config: RemoteConfig): Promise<void> {
    await this.stop()
    this.error = null

    if (!(await isPortFree(config.port, '0.0.0.0'))) {
      this.error = t('Порт {port} занят', { port: config.port })
      // Тот же код, что и у listen: вызывающий отличает «занято» от прочих сбоев.
      throw Object.assign(new Error(this.error), { code: 'EADDRINUSE' })
    }

    const server = http.createServer((req, res) => {
      void this.handle(req, res).catch((err: Error) => {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      })
    })

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error): void => reject(err)
        server.once('error', onError)
        server.listen(config.port, '0.0.0.0', () => {
          server.off('error', onError)
          resolve()
        })
      })
    } catch (err) {
      this.error = (err as Error).message
      throw err
    }

    server.on('error', (err) => {
      this.error = err.message
    })

    this.server = server
    this.config = config
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.config = null
    if (!server) return
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  url(): string | null {
    const plain = this.plainUrl()
    if (!plain || !this.config) return null
    return `${plain}/?${TOKEN_PARAM}=${this.config.token}`
  }

  plainUrl(): string | null {
    const ip = lanAddress()
    if (!this.config || !ip) return null
    return `http://${ip}:${this.config.port}`
  }

  private lockedFor(ip: string): number {
    const entry = this.fails.get(ip)
    if (!entry) return 0
    return entry.until > Date.now() ? Math.ceil((entry.until - Date.now()) / 1000) : 0
  }

  private noteFailure(ip: string): void {
    const entry = this.fails.get(ip) ?? { count: 0, until: 0 }
    entry.count += 1
    if (entry.count >= MAX_FAILS) {
      entry.until = Date.now() + LOCK_MS
      entry.count = 0
    }
    this.fails.set(ip, entry)
  }

  private setCookie(res: http.ServerResponse, token: string, location: string): void {
    res.writeHead(302, {
      // Strict: cookie не уедет с чужой страницы, поэтому POST-ручки пульта
      // недоступны для CSRF.
      'Set-Cookie': `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
      Location: location
    })
    res.end()
  }

  /** Разбор тела формы входа. Оно заведомо крошечное. */
  private async readBody(req: http.IncomingMessage): Promise<string> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > 4096) break
      chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  private async login(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const config = this.config
    if (!config) return
    const ip = req.socket.remoteAddress ?? ''

    const locked = this.lockedFor(ip)
    if (locked) {
      res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(loginPage(t('Слишком много попыток. Попробуйте через {locked} с.', { locked })))
      return
    }

    const body = await this.readBody(req)
    const password = new URLSearchParams(body).get('password')?.trim() ?? ''

    if (!tokenMatches(password, config.token)) {
      this.noteFailure(ip)
      res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(loginPage(t('Неверный пароль.')))
      return
    }

    this.fails.delete(ip)
    this.setCookie(res, config.token, '/')
  }

  /**
   * Пускаем тремя путями: с самой машины — без вопросов, по ссылке с ключом
   * и по паролю через форму входа.
   */
  private authorize(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    const config = this.config
    if (!config) return false
    if (isLoopback(req.socket.remoteAddress)) return true

    const url = new URL(req.url ?? '/', 'http://localhost')
    const fromQuery = url.searchParams.get(TOKEN_PARAM)

    if (fromQuery) {
      if (tokenMatches(fromQuery, config.token)) {
        url.searchParams.delete(TOKEN_PARAM)
        this.setCookie(res, config.token, `${url.pathname}${url.search}`)
        return false
      }
      this.noteFailure(req.socket.remoteAddress ?? '')
    }

    if (tokenMatches(readCookie(req.headers.cookie, COOKIE), config.token)) return true

    const wantsHtml = (req.headers.accept ?? '').includes('text/html')
    if (wantsHtml && req.method === 'GET') {
      const locked = this.lockedFor(req.socket.remoteAddress ?? '')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(loginPage(locked ? t('Слишком много попыток. Попробуйте через {locked} с.', { locked }) : null))
    } else {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: t('Нужен вход в пульт') }))
    }
    return false
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!isAllowedHost(req.headers.host)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(t('Обращение по неизвестному имени хоста отклонено.'))
      return
    }

    if (req.method === 'POST' && (req.url ?? '').split('?')[0] === '/login') {
      await this.login(req, res)
      return
    }

    if (!this.authorize(req, res)) return

    const url = new URL(req.url ?? '/', 'http://localhost')
    const parts = url.pathname.split('/').filter(Boolean)
    const json = (body: unknown, status = 200): void => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(body))
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(remotePage())
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      json(this.hooks.state())
      return
    }

    if (req.method === 'POST' && parts[0] === 'api') {
      // a POST from another page open on this Mac would pass the loopback check: only the remote page itself
      if (!remotePostAllowed(req.headers)) return json({ error: t('Запрос отклонён: только со страницы пульта.') }, 403)
      // /api/site/<id>/<action>
      if (parts[1] === 'site' && parts[2] && parts[3]) {
        const id = decodeURIComponent(parts[2])
        const action = parts[3]
        if (action === 'start') await this.hooks.startSite(id)
        else if (action === 'stop') await this.hooks.stopSite(id)
        else if (action === 'lan-on') await this.hooks.enableLan(id)
        else if (action === 'tunnel-on') await this.hooks.startTunnel(id)
        else if (action === 'tunnel-off') await this.hooks.stopTunnel(id)
        else return json({ error: t('Неизвестное действие') }, 404)
        json(this.hooks.state())
        return
      }
      // /api/all/<action>
      if (parts[1] === 'all' && parts[2]) {
        if (parts[2] === 'start') await this.hooks.startAll()
        else if (parts[2] === 'stop') await this.hooks.stopAll()
        else return json({ error: t('Неизвестное действие') }, 404)
        json(this.hooks.state())
        return
      }
    }

    json({ error: t('Не найдено') }, 404)
  }
}
