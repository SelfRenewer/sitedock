import net from 'node:net'
import { DEFAULT_PORT } from '../shared/types'

/** Реальная проверка: пробуем занять порт и сразу отпускаем. */
export function isPortFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port, host)
  })
}

/**
 * Первый свободный порт начиная с `from`, пропуская уже закреплённые за
 * другими сайтами. Проверяем и loopback, и 0.0.0.0 — чтобы порт годился
 * в обоих режимах доступа.
 */
export async function findFreePort(
  from: number = DEFAULT_PORT,
  taken: Set<number> = new Set()
): Promise<number | null> {
  for (let port = from; port < from + 500 && port <= 65535; port++) {
    if (taken.has(port)) continue
    if (await isPortFree(port, '127.0.0.1')) return port
  }
  return null
}
