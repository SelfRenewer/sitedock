// Every Russian text in the code has English, with the same {params}; no Russian outside t() and comments.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { EN, resolveLang, setLang, sitesWord, t } from '../src/shared/i18n.ts'

const CYR = /[А-Яа-яЁё]/

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return sources(p)
    return /\.(ts|tsx)$/.test(e.name) && !p.endsWith(path.join('shared', 'i18n.ts')) ? [p] : []
  })
}

const files = sources('src').map((file) => [file, fs.readFileSync(file, 'utf8')])
const keysIn = (src) => [...src.matchAll(/\bt\('((?:\\.|[^'\\])*)'/g)].map((m) => m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'))

test('every t() text has an English translation', () => {
  const missing = files.flatMap(([file, src]) => keysIn(src).filter((k) => !(k in EN)).map((k) => `${file}: ${k}`))
  assert.deepEqual(missing, [])
})

test('translations keep the same {params}', () => {
  const params = (s) => (s.match(/\{\w+\}/g) || []).sort().join()
  const bad = Object.entries(EN).filter(([ru, en]) => params(ru) !== params(en)).map(([ru]) => ru)
  assert.deepEqual(bad, [])
})

test('no Russian text outside t() and comments', () => {
  const left = []
  for (const [file, src] of files) {
    let code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    code = code.replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
    code = code.replace(/\bt\('(?:\\.|[^'\\])*'/g, (m) => m.replace(/[^\n]/g, ' '))
    const raw = src.split('\n')
    code.split('\n').forEach((line, i) => {
      if (CYR.test(line) && !raw[i].includes('i18n-ignore')) left.push(`${file}:${i + 1}: ${line.trim()}`)
    })
  }
  assert.deepEqual(left, [])
})

test('t() fills params and falls back to the Russian text', () => {
  setLang('en')
  assert.equal(t('Порт {port} занят', { port: 5173 }), 'Port 5173 is busy')
  assert.equal(t('нет такой фразы {x}', { x: 1 }), 'нет такой фразы 1')
  setLang('ru')
  assert.equal(t('Порт {port} занят', { port: 5173 }), 'Порт 5173 занят')
})

test('the language: the setting, else macOS', () => {
  assert.equal(resolveLang('ru', 'en-US'), 'ru')
  assert.equal(resolveLang('en', 'ru-RU'), 'en')
  assert.equal(resolveLang('system', 'ru-RU'), 'ru')
  assert.equal(resolveLang('system', 'de-DE'), 'en')
})

test('site counts read right in both languages', () => {
  setLang('ru')
  assert.deepEqual([1, 2, 5, 11, 21, 22, 112].map(sitesWord), ['1 сайт', '2 сайта', '5 сайтов', '11 сайтов', '21 сайт', '22 сайта', '112 сайтов'])
  setLang('en')
  assert.deepEqual([1, 2].map(sitesWord), ['1 site', '2 sites'])
})
