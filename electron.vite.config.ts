import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// Сборка не содержит ни одного инлайнового <script>, поэтому в продакшене
// script-src обходится без 'unsafe-inline'. Dev-серверу оно нужно: Vite и
// react-refresh инжектят инлайновую преамбулу и ходят на HMR-сокет.
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' ws://localhost:* http://localhost:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

function csp(): Plugin {
  return {
    name: 'sitedock-csp',
    transformIndexHtml: {
      order: 'pre',
      handler: (html, ctx) => html.replace('%CSP%', ctx.server ? DEV_CSP : PROD_CSP)
    }
  }
}

// Входные точки берутся из соглашений electron-vite: src/main/index.ts,
// src/preload/index.ts и src/renderer/index.html.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), csp()]
  }
})
