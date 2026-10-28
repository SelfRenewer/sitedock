declare module 'serve-handler' {
  import type { IncomingMessage, ServerResponse } from 'node:http'

  interface Rewrite {
    source: string
    destination: string
  }
  interface HeaderRule {
    source: string
    headers: { key: string; value: string }[]
  }
  export interface ServeHandlerOptions {
    public?: string
    cleanUrls?: boolean | string[]
    rewrites?: Rewrite[]
    redirects?: { source: string; destination: string; type?: number }[]
    headers?: HeaderRule[]
    directoryListing?: boolean | string[]
    unlisted?: string[]
    trailingSlash?: boolean
    renderSingle?: boolean
    symlinks?: boolean
    etag?: boolean
  }

  export default function handler(
    request: IncomingMessage,
    response: ServerResponse,
    options?: ServeHandlerOptions
  ): Promise<void>
}
