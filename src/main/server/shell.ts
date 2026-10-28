import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * PATH для дочерних процессов.
 *
 * GUI-приложение получает от launchd урезанный PATH, а менеджеры версий node
 * (fnm, nvm, volta) прописываются в ~/.zshrc — его логин-шелл без интерактива
 * не читает. Поэтому их постоянные пути добавляем сами: интерактивный шелл
 * звать не хотим, он тянет плагины и мусорит в вывод.
 */
export function shellPath(): string {
  const home = os.homedir()
  const candidates = [
    path.join(home, '.local/share/fnm/aliases/default/bin'),
    path.join(home, '.volta/bin'),
    path.join(home, '.bun/bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin'
  ]

  // nvm держит версии в отдельных папках — берём самую свежую.
  const nvm = path.join(home, '.nvm/versions/node')
  try {
    const versions = fs
      .readdirSync(nvm)
      .filter((name) => name.startsWith('v'))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    if (versions[0]) candidates.push(path.join(nvm, versions[0], 'bin'))
  } catch {
    // nvm не установлен
  }

  const found = candidates.filter((dir) => {
    try {
      return fs.statSync(dir).isDirectory()
    } catch {
      return false
    }
  })

  return [...found, process.env['PATH'] ?? ''].filter(Boolean).join(':')
}
