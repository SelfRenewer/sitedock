import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { t } from '../shared/i18n'

const run = promisify(execFile)

const VSCODE_BINARIES = [
  'code',
  '/opt/homebrew/bin/code',
  '/usr/local/bin/code',
  '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
]

/**
 * `code <path>`. GUI-приложение не наследует PATH из шелла, поэтому
 * пробуем известные места, а в конце — открыть через LaunchServices.
 */
export async function openInEditor(dir: string): Promise<void> {
  const env = { ...process.env, PATH: `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin` }
  for (const bin of VSCODE_BINARIES) {
    try {
      await run(bin, [dir], { env })
      return
    } catch {
      // пробуем следующий кандидат
    }
  }
  try {
    await run('open', ['-b', 'com.microsoft.VSCode', dir])
  } catch {
    throw new Error(t('VS Code не найден. Установите команду «code» через Command Palette → Shell Command: Install \'code\' command in PATH.'))
  }
}
