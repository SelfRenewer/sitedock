export type SiteKind = 'static' | 'command'

export type SiteStatus = 'stopped' | 'starting' | 'running' | 'error'

/** То, что реально хранится в electron-store. */
export interface Site {
  id: string
  /** Отображаемое имя. Хранится отдельно от имени папки. */
  name: string
  path: string
  port: number
  /** Все 404 отдавать index.html. */
  spa: boolean
  liveReload: boolean
  /** Биндить на 0.0.0.0 и показывать URL с IP машины. */
  lan: boolean
  /** Ключ доступа для запросов не с этой машины. Наружу уходит только в LAN-URL и QR. */
  token: string
  /** static — раздаём папку сами; command — запускаем приложение и проксируем на него. */
  kind: SiteKind
  /** Что запускать в папке сайта. Только для kind === 'command'. */
  command: string
  /** Порт запускаемого приложения. Отдаётся ему же в переменной PORT. */
  targetPort: number
  /** Команда туннеля наружу. {port} подставляется портом сайта. */
  tunnelCommand: string
  /** Папка на главном экране. Пусто — «Без папки». */
  group: string
  /** Раздел внутри папки (у демо — ниша: «Авто», «Стоматология»). Пусто — без раздела. */
  section: string
  /** Неактуальные работы уезжают в архив и не мешают на главном экране. */
  archived: boolean
  /** Иконка, выбранная вручную. Пусто — ищем в папке сайта сами. */
  iconPath: string
  /**
   * Пускать трафик туннеля без ключа SiteDock: для клиентских сайтов, которые
   * и так публичные, и для сайтов со своим входом. Личное — только под ключом.
   */
  tunnelOpen: boolean
  autoStart: boolean
  createdAt: number
}

/** Site + вычисляемое рантайм-состояние. Именно это уходит в renderer. */
export interface SiteView extends Site {
  status: SiteStatus
  error: string | null
  /** Папка существует и это директория. */
  exists: boolean
  hasIndex: boolean
  url: string | null
  lanUrl: string | null
  /** Публичный адрес туннеля с ключом, пока туннель поднят. */
  tunnelUrl: string | null
  tunnelStatus: 'off' | 'starting' | 'on' | 'error'
  tunnelError: string | null
  /** Адрес в mesh-сети (Tailscale): постоянный, работает через любой NAT. */
  meshUrl: string | null
}

export interface LogEntry {
  id: number
  ts: number
  siteId: string
  siteName: string
  method: string
  path: string
  status: number
  ms: number
}

export type StartResult =
  | { ok: true }
  | { ok: false; code: 'port-busy'; message: string; port: number; suggested: number | null }
  | { ok: false; code: 'no-folder' | 'error'; message: string }

export interface ToastPayload {
  kind: 'error' | 'info'
  text: string
}

export const DEFAULT_PORT = 5173

/** Папка на главном экране: порядок в списке, значок и участие в «Запустить все». */
export interface Folder {
  name: string
  icon: string
  /** Только вручную: «Запустить все» эту папку пропускает (большие коллекции вроде демо). */
  manual: boolean
}

export interface BulkResult {
  id: string
  name: string
  message: string
}

/** Пульт управления: тот же список сайтов, но по локальной сети. */
export interface RemoteConfig {
  enabled: boolean
  port: number
  /** Ключ доступа к пульту. Отдельный от ключей сайтов. */
  token: string
}

export interface RemoteView extends RemoteConfig {
  running: boolean
  ip: string | null
  /** Полный адрес с ключом — вход без ввода пароля. */
  url: string | null
  /** Тот же адрес без ключа — для входа по паролю. */
  plainUrl: string | null
  error: string | null
}
