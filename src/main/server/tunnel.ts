import { spawn, type ChildProcess } from 'node:child_process'
import { shellPath } from './shell'
import { t } from '../../shared/i18n'

const START_TIMEOUT_MS = 60_000
const REACHABLE_TIMEOUT_MS = 180_000
// Имя быстрого туннеля расходится по DNS не мгновенно. Если спросить сразу,
// резолвер закэширует отрицательный ответ и будет повторять его минутами —
// поэтому первую попытку делаем с задержкой.
const FIRST_PROBE_DELAY_MS = 20_000
const TAIL_LINES = 40

// Адрес туннеля печатается в вывод; служебные ссылки самого cloudflared отсеиваем.
const URL_RE = /https:\/\/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[^\s|"']*)?/gi
const IGNORE_RE = /(developers|blog|www|dash)\.cloudflare\.com|api\.trycloudflare\.com|github\.com/i

export function extractUrl(text: string): string | null {
  const matches = text.match(URL_RE)
  if (!matches) return null
  for (const url of matches) {
    if (!IGNORE_RE.test(url)) return url.replace(/[.,)]+$/, '')
  }
  return null
}

/**
 * Туннель наружу: запускаем команду и вылавливаем публичный адрес из её вывода.
 *
 * Порт не ждём — туннель ничего локально не слушает, признак готовности
 * ровно один: напечатанная ссылка.
 */
export class TunnelProcess {
  private child: ChildProcess | null = null
  private output: string[] = []
  url: string | null = null

  constructor(
    private readonly command: string,
    private readonly cwd: string,
    private readonly onExit: (reason: string) => void
  ) {}

  get tail(): string {
    return this.output.join('\n').trim()
  }

  private remember(chunk: Buffer): void {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim()) this.output.push(line.trimEnd())
    }
    if (this.output.length > TAIL_LINES) this.output = this.output.slice(-TAIL_LINES)
  }

  async start(): Promise<string> {
    const shell = process.env['SHELL'] || '/bin/zsh'
    const child = spawn(shell, ['-lc', this.command], {
      cwd: this.cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: shellPath(), FORCE_COLOR: '0' }
    })
    this.child = child

    const found = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(t('Туннель не выдал адрес за 60 секунд. {tail}', { tail: this.tail }).trim()))
      }, START_TIMEOUT_MS)

      const look = (chunk: Buffer): void => {
        this.remember(chunk)
        if (this.url) return
        const url = extractUrl(this.tail)
        if (url) {
          this.url = url
          clearTimeout(timer)
          resolve(url)
        }
      }
      child.stdout?.on('data', look)
      child.stderr?.on('data', look)

      child.on('exit', (code, signal) => {
        clearTimeout(timer)
        if (this.child !== child) return
        this.child = null
        const how = signal ? t('сигнал {signal}', { signal }) : t('код {code}', { code })
        if (!this.url) reject(new Error(t('Туннель завершился ({how}). {tail}', { how, tail: this.tail }).trim()))
        else this.onExit(t('Туннель завершился ({how}). {tail}', { how, tail: this.tail }).trim())
      })

      child.on('error', (err) => {
        clearTimeout(timer)
        reject(new Error(t('Не удалось запустить туннель: {message}', { message: err.message })))
      })
    })

    try {
      return await found
    } catch (err) {
      await this.stop()
      throw err
    }
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = null
    this.url = null
    if (!child?.pid || child.exitCode !== null) return

    const kill = (signal: NodeJS.Signals): void => {
      try {
        process.kill(-child.pid!, signal)
      } catch {
        try {
          child.kill(signal)
        } catch {
          // уже умер
        }
      }
    }

    const finished = new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve()
      child.once('exit', () => resolve())
    })

    kill('SIGTERM')
    const inTime = await Promise.race([
      finished.then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 3000))
    ])
    if (!inTime) {
      kill('SIGKILL')
      await Promise.race([finished, new Promise((r) => setTimeout(r, 1500))])
    }
  }
}

/**
 * Быстрый туннель отвечает не сразу: cloudflared печатает адрес раньше, чем
 * Cloudflare начинает его обслуживать, и всё это время наружу летит 1033.
 * Поэтому дожидаемся первого ответа, который дал уже наш сервер.
 */
export type Reachability = 'ok' | 'dns' | 'unreachable'

/**
 * Проверка адреса туннеля.
 *
 * Различаем два разных несчастья: Cloudflare ещё не начал обслуживать имя
 * (5xx, 1033) и имя не резолвится на этой машине — так выглядит блокировка
 * *.trycloudflare.com у провайдера. Причины разные, и советы тоже.
 */
export async function waitReachable(url: string): Promise<Reachability> {
  await new Promise((r) => setTimeout(r, FIRST_PROBE_DELAY_MS))

  const deadline = Date.now() + REACHABLE_TIMEOUT_MS
  let lastDns = false

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'SiteDock' }
      })
      // 5xx — это ещё Cloudflare. Всё остальное значит, что запрос дошёл
      // до нас: 403 без ключа тоже подходит.
      if (res.status < 500) return 'ok'
      lastDns = false
    } catch (err) {
      const code = (err as { cause?: { code?: string } })?.cause?.code
      lastDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN'
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
  return lastDns ? 'dns' : 'unreachable'
}
