import { forwardRef } from 'react'
import { getLang, t, type Lang } from '../../shared/i18n'

/** RU / EN: saved in main (the tray and the remote page follow), then the window reloads in the new language. */
function setLanguage(lang: Lang): void {
  if (lang === getLang()) return
  void window.api.setLanguage(lang).then(() => window.location.reload())
}

export type ViewMode = 'cards' | 'list'

interface Props {
  icon: string
  title: string
  subtitle: string
  query: string
  onQuery: (value: string) => void
  mode: ViewMode
  onMode: (mode: ViewMode) => void
  busy: boolean
  logsOpen: boolean
  /** Кнопки для открытой папки (запустить / остановить её сайты). */
  folder: { canStart: boolean; canStop: boolean; onStart: () => void; onStop: () => void } | null
  /** «Запустить все» — только на «Все сайты»: без архива и папок «только вручную». */
  startAll: { disabled: boolean; hint: string; onRun: () => void } | null
  onAdd: () => void
  addHint: string
  onToggleLogs: () => void
  onRemote: () => void
}

export const Toolbar = forwardRef<HTMLInputElement, Props>(function Toolbar(props, searchRef) {
  const { folder, startAll } = props
  return (
    <header className="toolbar">
      <div className="toolbar__top">
        <div className="toolbar__title">
          <h1>
            {props.icon ? <span className="toolbar__icon">{props.icon}</span> : null}
            {props.title}
          </h1>
          <span className="toolbar__count">{props.subtitle}</span>
        </div>
        <div className="toolbar__actions">
          <div className="segmented segmented--lang" role="group" aria-label={t('Язык')}>
            {(['ru', 'en'] as const).map((lang) => (
              <button
                key={lang}
                type="button"
                className={getLang() === lang ? 'is-on' : ''}
                aria-pressed={getLang() === lang}
                onClick={() => setLanguage(lang)}
              >
                {lang.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={props.onRemote}
            title={t('Пульт: управление сайтами с другого компьютера')}
          >
            {t('Доступ с ПК')}
          </button>
          <button
            type="button"
            className={`btn btn--ghost${props.logsOpen ? ' btn--active' : ''}`}
            onClick={props.onToggleLogs}
            title={t('Панель логов')}
          >
            {t('Логи')}
          </button>
          <button type="button" className="btn btn--primary" onClick={props.onAdd} title={props.addHint}>
            {t('＋ Сайт')}
          </button>
        </div>
      </div>

      <div className="toolbar__bar">
        <label className="search">
          <span className="search__icon" aria-hidden="true">
            ⌕
          </span>
          <input
            ref={searchRef}
            type="search"
            value={props.query}
            placeholder={t('Поиск по названию, папке, разделу, пути')}
            onChange={(e) => props.onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') props.onQuery('')
            }}
            aria-label={t('Поиск сайтов')}
          />
          {props.query ? null : <kbd>⌘F</kbd>}
        </label>

        <div className="segmented" role="group" aria-label={t('Вид')}>
          <button
            type="button"
            className={props.mode === 'cards' ? 'is-on' : ''}
            onClick={() => props.onMode('cards')}
            title={t('Карточки')}
          >
            ▦<span className="seg__text">{' '}{t('Карточки')}</span>
          </button>
          <button
            type="button"
            className={props.mode === 'list' ? 'is-on' : ''}
            onClick={() => props.onMode('list')}
            title={t('Компактный список')}
          >
            ☰<span className="seg__text">{' '}{t('Список')}</span>
          </button>
        </div>

        <span className="toolbar__spacer" />

        {folder ? (
          <>
            {folder.canStop ? (
              <button type="button" className="btn" disabled={props.busy} onClick={folder.onStop}>
                {t('Остановить папку')}
              </button>
            ) : null}
            <button type="button" className="btn" disabled={props.busy || !folder.canStart} onClick={folder.onStart}>
              {t('Запустить папку')}
            </button>
          </>
        ) : null}
        {startAll ? (
          <button
            type="button"
            className="btn"
            disabled={props.busy || startAll.disabled}
            title={startAll.hint}
            onClick={startAll.onRun}
          >
            {t('Запустить все')}
          </button>
        ) : null}
      </div>
    </header>
  )
})
