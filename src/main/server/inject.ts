import type { ServerResponse } from 'node:http'

export const LIVE_RELOAD_PATH = '/__sitedock_lr'

export const LIVE_RELOAD_SNIPPET = `<script data-sitedock-livereload>
(function () {
  var url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '${LIVE_RELOAD_PATH}';
  var timer = null;
  function schedule(reloadOnOpen) {
    clearTimeout(timer);
    timer = setTimeout(function () { connect(reloadOnOpen); }, 1000);
  }
  function connect(reloadOnOpen) {
    var ws;
    try { ws = new WebSocket(url); } catch (e) { schedule(true); return; }
    ws.onopen = function () { if (reloadOnOpen) location.reload(); };
    ws.onmessage = function (e) { if (e.data === 'reload') location.reload(); };
    ws.onclose = function () { schedule(true); };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }
  connect(false);
})();
</script>`

function toBuffer(chunk: unknown, encoding?: unknown): Buffer | null {
  if (chunk === null || chunk === undefined || typeof chunk === 'function') return null
  if (Buffer.isBuffer(chunk)) return chunk
  if (typeof chunk === 'string') {
    return Buffer.from(chunk, typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8')
  }
  return Buffer.from(chunk as Uint8Array)
}

/**
 * Дописывает скрипт live-reload в HTML-ответ.
 *
 * serve-handler отдаёт файл как `writeHead(200, headers)` + `stream.pipe(res)`,
 * причём после writeHead заголовки уже сериализованы и setHeader кинет
 * ERR_HTTP_HEADERS_SENT. Поэтому перехватываем сам writeHead: там определяем
 * text/html и снимаем Content-Length (дальше ответ уедет chunked), а write/end
 * буферизуем только для HTML — всё остальное проходит насквозь.
 */
export function injectIntoHtml(res: ServerResponse, snippet: string): void {
  const chunks: Buffer[] = []
  let isHtml = false

  const originalWriteHead = res.writeHead.bind(res)
  const originalWrite = res.write.bind(res)
  const originalEnd = res.end.bind(res)

  const markHtmlFromOwnHeaders = (): void => {
    if (isHtml || res.headersSent) return
    const type = String(res.getHeader('Content-Type') ?? '').toLowerCase()
    if (type.includes('text/html')) {
      isHtml = true
      res.removeHeader('Content-Length')
    }
  }

  res.writeHead = ((...args: unknown[]) => {
    const headers = args.find(
      (arg, index) => index > 0 && typeof arg === 'object' && arg !== null
    ) as Record<string, unknown> | undefined

    if (headers && !Array.isArray(headers)) {
      for (const key of Object.keys(headers)) {
        if (
          key.toLowerCase() === 'content-type' &&
          String(headers[key]).toLowerCase().includes('text/html')
        ) {
          isHtml = true
        }
      }
      if (isHtml) {
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === 'content-length') delete headers[key]
        }
      }
    }
    markHtmlFromOwnHeaders()
    return (originalWriteHead as Function)(...args)
  }) as typeof res.writeHead

  res.write = ((chunk: unknown, encoding?: unknown, callback?: unknown) => {
    markHtmlFromOwnHeaders()
    if (!isHtml) return (originalWrite as Function)(chunk, encoding, callback)
    const buf = toBuffer(chunk, encoding)
    if (buf) chunks.push(buf)
    const done = typeof encoding === 'function' ? encoding : callback
    if (typeof done === 'function') done()
    return true
  }) as typeof res.write

  res.end = ((chunk?: unknown, encoding?: unknown, callback?: unknown) => {
    markHtmlFromOwnHeaders()
    if (!isHtml) return (originalEnd as Function)(chunk, encoding, callback)
    const buf = toBuffer(chunk, encoding)
    if (buf) chunks.push(buf)
    const body = Buffer.concat(chunks).toString('utf8')
    const patched = body.includes('</body>')
      ? body.replace('</body>', `${snippet}</body>`)
      : body + snippet
    const done = [chunk, encoding, callback].find((arg) => typeof arg === 'function')
    return (originalEnd as Function)(Buffer.from(patched, 'utf8'), done)
  }) as typeof res.end
}
