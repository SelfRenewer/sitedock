import http from 'node:http'
import net from 'node:net'
import type { Duplex } from 'node:stream'
import { withoutKeyCookie } from './access'
import { t } from '../../shared/i18n'

/**
 * Проброс обычного запроса на приложение сайта.
 *
 * Наружу по-прежнему смотрит только наш сервер, поэтому проверка Host, ключ
 * доступа для сети и панель логов работают для бэкендов ровно так же,
 * как для статики.
 */
export function proxyRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  targetPort: number
): void {
  const headers = { ...req.headers }
  headers.cookie = withoutKeyCookie(req.headers.cookie)
  if (!headers.cookie) delete headers.cookie
  // hop-by-hop заголовки не пересылаются между соединениями
  delete headers['connection']
  delete headers['keep-alive']
  delete headers['proxy-authenticate']
  delete headers['proxy-authorization']
  delete headers['transfer-encoding']
  delete headers['upgrade']

  const remote = req.socket.remoteAddress ?? ''
  const forwarded = req.headers['x-forwarded-for']
  headers['x-forwarded-for'] = forwarded ? `${forwarded}, ${remote}` : remote
  headers['x-forwarded-proto'] = 'http'
  if (req.headers.host) headers['x-forwarded-host'] = req.headers.host

  const upstream = http.request(
    { host: '127.0.0.1', port: targetPort, method: req.method, path: req.url, headers },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
      upstreamRes.pipe(res)
    }
  )

  upstream.on('error', (err: NodeJS.ErrnoException) => {
    if (res.headersSent) {
      res.destroy()
      return
    }
    const unreachable = err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET'
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(
      unreachable
        ? t('Приложение сайта не отвечает на порту {targetPort}.', { targetPort })
        : t('Ошибка обращения к приложению сайта: {message}', { message: err.message })
    )
  })

  req.on('aborted', () => upstream.destroy())
  req.pipe(upstream)
}

/** Проброс websocket-соединений (upgrade) на то же приложение. */
export function proxyUpgrade(
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
  targetPort: number
): void {
  const upstream = net.connect({ host: '127.0.0.1', port: targetPort }, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`]
    for (const [key, raw] of Object.entries(req.headers)) {
      const value = key === 'cookie' ? withoutKeyCookie(raw as string | undefined) : raw
      if (Array.isArray(value)) for (const v of value) lines.push(`${key}: ${v}`)
      else if (value !== undefined) lines.push(`${key}: ${value}`)
    }
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
    if (head?.length) upstream.write(head)
    upstream.pipe(socket)
    socket.pipe(upstream)
  })

  const close = (): void => {
    upstream.destroy()
    socket.destroy()
  }
  upstream.on('error', close)
  socket.on('error', close)
}
