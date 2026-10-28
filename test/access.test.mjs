// The gate of the site servers and the remote: Host (DNS rebinding), the site key, the tunnel, CSRF.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  TOKEN_COOKIE,
  isAllowedHost,
  liveReloadAllowed,
  readCookie,
  remotePostAllowed,
  tokenMatches,
  withoutKeyCookie
} from '../src/main/server/access.ts'

test('Host: localhost and IPs pass, a domain (DNS rebinding) does not', () => {
  assert.ok(isAllowedHost('localhost:5173'))
  assert.ok(isAllowedHost('127.0.0.1:5173'))
  assert.ok(isAllowedHost('[::1]:5173'))
  assert.ok(isAllowedHost('192.168.1.20:5173'))
  assert.ok(!isAllowedHost('evil.example:5173'))
  assert.ok(!isAllowedHost(undefined))
})

test('the key: constant-time comparison, cookie parsing', () => {
  assert.ok(tokenMatches('abc', 'abc'))
  assert.ok(!tokenMatches('abd', 'abc'))
  assert.ok(!tokenMatches('', 'abc'))
  assert.equal(readCookie(`a=1; ${TOKEN_COOKIE}=k%2Fey`, TOKEN_COOKIE), 'k/ey')
  assert.equal(readCookie('a=1', TOKEN_COOKIE), null)
})

test('the remote takes a POST only from its own page', () => {
  const own = { host: '192.168.1.20:7788', 'x-sitedock': '1' }
  assert.ok(remotePostAllowed(own))
  assert.ok(remotePostAllowed({ ...own, origin: 'http://192.168.1.20:7788', 'sec-fetch-site': 'same-origin' }))
  // another page open on this Mac: it cannot add the header without a preflight, and its Origin is not ours
  assert.ok(!remotePostAllowed({ host: '127.0.0.1:7788' }))
  assert.ok(!remotePostAllowed({ ...own, origin: 'https://evil.example' }))
  assert.ok(!remotePostAllowed({ ...own, 'sec-fetch-site': 'cross-site' }))
})

const base = { origin: undefined, token: 'site-key', port: 5173, tunnelHost: null, tunnelOpen: false }

test('live reload: from this Mac without the key, from the network only with it', () => {
  assert.ok(liveReloadAllowed({ ...base, host: 'localhost:5173', remoteAddress: '127.0.0.1', cookie: undefined }))
  assert.ok(!liveReloadAllowed({ ...base, host: '192.168.1.20:5173', remoteAddress: '192.168.1.30', cookie: undefined }))
  assert.ok(liveReloadAllowed({ ...base, host: '192.168.1.20:5173', remoteAddress: '192.168.1.30', cookie: `${TOKEN_COOKIE}=site-key` }))
  assert.ok(!liveReloadAllowed({ ...base, host: 'evil.example:5173', remoteAddress: '127.0.0.1', cookie: undefined }))
})

test('live reload through the tunnel needs the key, though cloudflared connects from 127.0.0.1', () => {
  const tunnel = { ...base, host: 'brave-cat.trycloudflare.com', remoteAddress: '127.0.0.1', tunnelHost: 'brave-cat.trycloudflare.com' }
  assert.ok(!liveReloadAllowed({ ...tunnel, cookie: undefined }))
  assert.ok(liveReloadAllowed({ ...tunnel, cookie: `${TOKEN_COOKIE}=site-key` }))
  assert.ok(liveReloadAllowed({ ...tunnel, cookie: undefined, tunnelOpen: true }))
  assert.ok(!liveReloadAllowed({ ...tunnel, cookie: `${TOKEN_COOKIE}=site-key`, origin: 'https://evil.example' }))
})

test("our key cookie is not passed to a command site's app", () => {
  assert.equal(withoutKeyCookie(`${TOKEN_COOKIE}=k; theirs=1`), 'theirs=1')
  assert.equal(withoutKeyCookie(`${TOKEN_COOKIE}=k`), undefined)
  assert.equal(withoutKeyCookie('theirs=1'), 'theirs=1')
})
