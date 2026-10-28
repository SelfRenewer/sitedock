import net from 'node:net'
import { posix } from 'node:path'
import { timingSafeEqual } from 'node:crypto'

export const TOKEN_COOKIE = 'sitedock_key'
export const TOKEN_PARAM = 'k'

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export function isLoopback(remoteAddress: string | undefined): boolean {
  return Boolean(remoteAddress && LOOPBACK.has(remoteAddress))
}

/**
 * Защита от DNS rebinding. Привязка к 127.0.0.1 сама по себе не спасает:
 * вредоносный сайт может перепривязать свой домен на loopback, и тогда браузер
 * пойдёт на наш порт с чужим Host — а ответ будет читаться как свой, потому что
 * для браузера это origin атакующего. Поэтому пускаем только localhost и
 * IP-литералы: у атаки обязательно доменное имя.
 */
export function isAllowedHost(host: string | undefined): boolean {
  if (!host) return false
  let hostname = host
  if (hostname.startsWith('[')) {
    const end = hostname.indexOf(']')
    if (end === -1) return false
    hostname = hostname.slice(1, end)
  } else {
    const colon = hostname.lastIndexOf(':')
    if (colon !== -1) hostname = hostname.slice(0, colon)
  }
  return hostname === 'localhost' || net.isIP(hostname) !== 0
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    if (part.slice(0, index).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(index + 1).trim())
    } catch {
      return null
    }
  }
  return null
}

/** Сравнение за постоянное время — чтобы ключ нельзя было подобрать по таймингам. */
export function tokenMatches(provided: string | null | undefined, expected: string): boolean {
  if (!provided || !expected) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * A change on the remote page (POST /api/…) must come from that page itself: it sends `X-SiteDock: 1`, which a page
 * on another site cannot add without a CORS preflight (never answered). Loopback alone is not enough — any web page
 * open on this Mac reaches 127.0.0.1 too. An Origin, when sent, must be this host.
 */
export function remotePostAllowed(headers: Record<string, string | string[] | undefined>): boolean {
  if (headers['x-sitedock'] !== '1') return false
  const origin = headers.origin
  if (typeof origin === 'string' && origin) {
    try {
      return new URL(origin).host === headers.host
    } catch {
      return false
    }
  }
  const site = headers['sec-fetch-site']
  return !site || site === 'same-origin' || site === 'none'
}

/**
 * Live reload's WebSocket passes the same gate as the site's pages: a known Host (or the open tunnel's), and the key
 * for anything not from this Mac — through the tunnel too, though cloudflared connects from 127.0.0.1.
 */
export function liveReloadAllowed(opts: {
  host: string | undefined
  remoteAddress: string | undefined
  cookie: string | undefined
  origin: string | undefined
  token: string
  port: number
  tunnelHost: string | null
  tunnelOpen: boolean
}): boolean {
  const name = (opts.host ?? '').split(':')[0].toLowerCase()
  const viaTunnel = Boolean(opts.tunnelHost && name === opts.tunnelHost)
  if (!viaTunnel && !isAllowedHost(opts.host)) return false
  const needsKey = viaTunnel ? !opts.tunnelOpen : !isLoopback(opts.remoteAddress)
  if (needsKey && !tokenMatches(readCookie(opts.cookie, TOKEN_COOKIE), opts.token)) return false
  if (!opts.origin) return true // only browsers send Origin
  try {
    const origin = new URL(opts.origin)
    return viaTunnel ? origin.hostname === opts.tunnelHost : origin.port === String(opts.port)
  } catch {
    return false
  }
}

/** Our key cookie stays with us: a command site's own app never sees it. */
export function withoutKeyCookie(header: string | undefined): string | undefined {
  if (!header) return header
  const rest = header
    .split(';')
    .filter((part) => part.split('=')[0].trim() !== TOKEN_COOKIE)
    .join(';')
    .trim()
  return rest || undefined
}

/**
 * The decoded path of a static request, read the way serve-handler reads it (the raw target up to «?»), or null for a
 * target that the two parsers could read differently: not starting with exactly one «/» («//.env» is a host to WHATWG
 * URL, a path to url.parse), a backslash (WHATWG turns it into «/»), bad %-escapes, a NUL.
 */
export function requestTarget(url: string | undefined): string | null {
  const raw = url ?? '/'
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null
  const pathname = raw.split('?')[0].split('#')[0]
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.startsWith('//')) return null
  return decoded
}

/**
 * A segment starting with a dot (.env, .git) is hidden — except .well-known, part of the web's standards. Checked on
 * the path as sent and as normalised («/a/../.env»), so dot segments cannot hide it.
 */
export function hasHiddenSegment(pathname: string): boolean {
  const hidden = (p: string): boolean =>
    p.split('/').some((segment) => segment.startsWith('.') && segment !== '.' && segment !== '..' && segment !== '.well-known')
  return hidden(pathname) || hidden(posix.normalize(pathname))
}
