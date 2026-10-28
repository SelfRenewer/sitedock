import { spawn, type ChildProcess } from 'node:child_process'
import { shellPath } from './shell'
import net from 'node:net'
import { t } from '../../shared/i18n'

const START_TIMEOUT_MS = 30_000
const POLL_MS = 150
const TAIL_LINES = 40

/** Ждём, пока приложение реально начнёт слушать порт. */
export async function waitForPort(port: number, timeoutMs = START_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ port, host: '127.0.0.1' })
      const done = (value: boolean): void => {
        socket.destroy()
        resolve(value)
      }
      socket.once('connect', () => done(true))
      socket.once('error', () => done(false))
      socket.setTimeout(1000, () => done(false))
    })
    if (open) return true
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  return false
}

/**
 * Дочернее приложение сайта: запуск, наблюдение, гашение.
 *
 * Команда выполняется через логин-шелл пользователя — GUI-процесс не наследует
 * PATH из терминала, и без этого не найдутся ни node из fnm/nvm, ни npm.
 */
export class BackendProcess {
  private child: ChildProcess | null = null
  private output: string[] = []
  private exited = false

  constructor(
    private readonly command: string,
    private readonly cwd: string,
    private readonly port: number,
    private readonly onUnexpectedExit: (reason: string) => void
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

  async start(): Promise<void> {
    const shell = process.env['SHELL'] || '/bin/zsh'
    const child = spawn(shell, ['-lc', this.command], {
      cwd: this.cwd,
      // Своя группа процессов, чтобы погасить всё дерево, а не только шелл.
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // HOST: frameworks that read it listen on this Mac only — reachable from outside only through our gate
      env: { ...process.env, PATH: shellPath(), PORT: String(this.port), HOST: '127.0.0.1', FORCE_COLOR: '0' }
    })
    this.child = child

    child.stdout?.on('data', (c: Buffer) => this.remember(c))
    child.stderr?.on('data', (c: Buffer) => this.remember(c))

    child.on('exit', (code, signal) => {
      this.exited = true
      if (this.child !== child) return
      this.child = null
      const how = signal ? t('сигнал {signal}', { signal }) : t('код {code}', { code })
      this.onUnexpectedExit(t('Процесс завершился ({how}). {tail}', { how, tail: this.tail }).trim())
    })

    child.on('error', (err) => {
      this.exited = true
      this.onUnexpectedExit(t('Не удалось запустить команду: {message}', { message: err.message }))
    })

    const ready = await waitForPort(this.port)
    if (!ready) {
      const reason = this.exited
        ? t('Процесс завершился, не открыв порт {port}.', { port: this.port })
        : t('Приложение не открыло порт {port} за 30 секунд.', { port: this.port })
      await this.stop()
      throw new Error(`${reason} ${this.tail}`.trim())
    }
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = null
    if (!child?.pid || child.exitCode !== null) return

    const killGroup = (signal: NodeJS.Signals): void => {
      try {
        // Минус перед pid — вся группа процессов, вместе с внуками npm.
        process.kill(-child.pid!, signal)
      } catch {
        try {
          child.kill(signal)
        } catch {
          // процесс уже умер
        }
      }
    }

    const finished = new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve()
      child.once('exit', () => resolve())
    })

    killGroup('SIGTERM')
    const inTime = await Promise.race([
      finished.then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 4000))
    ])
    if (!inTime) {
      killGroup('SIGKILL')
      await Promise.race([finished, new Promise((r) => setTimeout(r, 1500))])
    }
  }
}
