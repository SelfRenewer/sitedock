#!/usr/bin/env node
// Moved your sites to another folder? Rewrite the paths in SiteDock's list.
//
//   node scripts/relocate-sites.mjs --from ~/OldSites --to ~/Sites --dry   show what would change
//   node scripts/relocate-sites.mjs --from ~/OldSites --to ~/Sites         write it (quit SiteDock first)
//
// SiteDock keeps absolute paths: the site's folder, a chosen icon, sometimes the start command. Only strings that
// start with the old folder (on a path boundary) change. A copy sites.json.bak-relocate-<time> is written next to it
// first. The folders themselves are not moved.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const STORE = path.join(os.homedir(), 'Library/Application Support/sitedock/sites.json')
const dry = process.argv.includes('--dry')

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}

function expand(p) {
  if (!p) return p
  return path.resolve(p.replace(/^~(?=\/|$)/, os.homedir())).replace(/\/+$/, '')
}

function running() {
  try {
    execFileSync('/usr/bin/pgrep', ['-x', 'SiteDock'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

const from = expand(arg('from'))
const to = expand(arg('to'))
if (!from || !to) {
  console.error('Both paths are needed: --from <old folder> --to <new folder>')
  process.exit(1)
}
if (from === to) {
  console.error('The old and the new folder are the same.')
  process.exit(1)
}

// on a path boundary only: /Sites must not touch /SitesOld
const pattern = new RegExp(`${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=/|$|["'\\s])`, 'g')
const changes = []

function walk(value, where) {
  if (typeof value === 'string') {
    const next = value.replace(pattern, to)
    if (next !== value) changes.push({ where, before: value, after: next })
    return next
  }
  if (Array.isArray(value)) return value.map((v, i) => walk(v, `${where}[${i}]`))
  if (value && typeof value === 'object') {
    const label = (v) => (typeof v.name === 'string' ? `«${v.name}»` : '')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, `${where}${label(value)}.${k}`)]))
  }
  return value
}

const raw = fs.readFileSync(STORE, 'utf8')
const next = walk(JSON.parse(raw), 'sites.json')

const missing = changes.filter((c) => /\.(path|iconPath)$/.test(c.where) && !fs.existsSync(c.after))
const home = (p) => p.replace(os.homedir(), '~')

console.log(`${home(from)} → ${home(to)}: ${changes.length} string(s) change`)
for (const c of changes.slice(0, 15)) console.log(`  ${c.where}: ${home(c.after)}`)
if (changes.length > 15) console.log(`  … and ${changes.length - 15} more`)
if (missing.length) {
  console.log(`\n${missing.length} path(s) do not exist at the new place yet (folders not moved?):`)
  for (const c of missing.slice(0, 10)) console.log(`  ${home(c.after)}`)
  if (missing.length > 10) console.log(`  … and ${missing.length - 10} more`)
}

if (dry || !changes.length) process.exit(0)

if (running()) {
  console.error('\nSiteDock is running — quit it first, or it will write its own copy over the file.')
  process.exit(1)
}

const backup = `${STORE}.bak-relocate-${new Date().toISOString().replace(/[:.]/g, '-')}`
fs.copyFileSync(STORE, backup)
const indent = raw.match(/^\{\n(\s+)/)?.[1] ?? '\t'
fs.writeFileSync(STORE, JSON.stringify(next, null, indent))
console.log(`\nWritten. Backup: ${home(backup)}`)
