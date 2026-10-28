import { BrowserWindow } from 'electron'
import type { LogEntry } from '../shared/types'

const LIMIT = 200
let seq = 0
const buffer: LogEntry[] = []

export function pushLog(entry: Omit<LogEntry, 'id'>): void {
  const full: LogEntry = { ...entry, id: ++seq }
  buffer.push(full)
  if (buffer.length > LIMIT) buffer.splice(0, buffer.length - LIMIT)
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('logs:entry', full)
  }
}

export function listLogs(): LogEntry[] {
  return buffer
}

export function clearLogs(): void {
  buffer.length = 0
}
