import { useMemo } from 'react'
import type { LogEntry, SiteView } from '../../shared/types'
import { formatTime } from '../lib/format'
import { t } from '../../shared/i18n'

interface Props {
  logs: LogEntry[]
  sites: SiteView[]
  filter: string
  onFilter: (value: string) => void
  onClear: () => void
  onClose: () => void
}

function statusClass(status: number): string {
  if (status >= 500) return 'log__status log__status--err'
  if (status >= 400) return 'log__status log__status--warn'
  if (status >= 300) return 'log__status log__status--redirect'
  return 'log__status log__status--ok'
}

export function LogPanel({ logs, sites, filter, onFilter, onClear, onClose }: Props): JSX.Element {
  const visible = useMemo(
    () => (filter === 'all' ? logs : logs.filter((l) => l.siteId === filter)).slice().reverse(),
    [logs, filter]
  )

  return (
    <section className="logs">
      <header className="logs__head">
        <strong>{t('Запросы')}</strong>
        <select value={filter} onChange={(e) => onFilter(e.target.value)}>
          <option value="all">{t('Все сайты')}</option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
        <span className="logs__count">{visible.length}</span>
        <div className="logs__spacer" />
        <button type="button" className="btn btn--ghost" onClick={onClear}>
          {t('Очистить')}
        </button>
        <button type="button" className="icon-btn" onClick={onClose} title={t('Свернуть')}>
          ▾
        </button>
      </header>

      <div className="logs__body">
        {visible.length === 0 ? (
          <p className="logs__empty">{t('Пока ни одного запроса')}</p>
        ) : (
          <table className="logs__table">
            <tbody>
              {visible.map((entry) => (
                <tr key={entry.id}>
                  <td className="log__time">{formatTime(entry.ts)}</td>
                  <td className="log__site">{entry.siteName}</td>
                  <td className="log__method">{entry.method}</td>
                  <td className="log__path" title={entry.path}>
                    {entry.path}
                  </td>
                  <td className={statusClass(entry.status)}>{entry.status}</td>
                  <td className="log__ms">{entry.ms} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
