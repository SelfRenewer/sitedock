import { useEffect, useRef, useState } from 'react'
import type { Site, SiteView } from '../../shared/types'
import { t } from '../../shared/i18n'

interface Props {
  site: SiteView
  /** Названия папок — для подсказки; можно вписать и новую, она появится в боковой панели. */
  folders: string[]
  /** Разделы, которые уже есть в папках: { папка: [разделы] }. */
  sections: Record<string, string[]>
  focusPort: boolean
  onClose: () => void
  onSave: (patch: Partial<Site>) => Promise<boolean>
  onSuggestPort: () => Promise<number | null>
}

export function SettingsModal({
  site,
  folders,
  sections,
  focusPort,
  onClose,
  onSave,
  onSuggestPort
}: Props): JSX.Element {
  const [name, setName] = useState(site.name)
  const [group, setGroup] = useState(site.group)
  const [section, setSection] = useState(site.section)
  const [port, setPort] = useState(String(site.port))
  const [spa, setSpa] = useState(site.spa)
  const [liveReload, setLiveReload] = useState(site.liveReload)
  const [lan, setLan] = useState(site.lan)
  const [autoStart, setAutoStart] = useState(site.autoStart)
  const [tunnelOpen, setTunnelOpen] = useState(site.tunnelOpen)
  const [kind, setKind] = useState(site.kind)
  const [command, setCommand] = useState(site.command)
  const [targetPort, setTargetPort] = useState(site.targetPort ? String(site.targetPort) : '')
  const [saving, setSaving] = useState(false)
  const portRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focusPort) {
      portRef.current?.focus()
      portRef.current?.select()
    }
  }, [focusPort])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setSaving(true)
    const ok = await onSave({
      name,
      group: group.trim(),
      section: section.trim(),
      port: Number(port),
      spa,
      liveReload,
      lan,
      autoStart,
      tunnelOpen,
      kind,
      command: command.trim(),
      targetPort: Number(targetPort) || 0
    })
    setSaving(false)
    if (ok) onClose()
  }

  const toggle = (
    label: string,
    hint: string,
    value: boolean,
    set: (v: boolean) => void
  ): JSX.Element => (
    <label className="toggle">
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} />
      <span>
        <strong>{label}</strong>
        <em>{hint}</em>
      </span>
    </label>
  )

  return (
    <div className="overlay" onMouseDown={onClose}>
      <form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3 className="modal__title">{t('Настройки сайта')}</h3>

        <label className="field">
          <span>{t('Название')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="field__pair">
          <label className="field">
            <span>{t('Папка')}</span>
            <input
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              placeholder={t('Без папки')}
              list="site-folders"
            />
            <datalist id="site-folders">
              {folders.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>{t('Раздел в папке')}</span>
            <input
              value={section}
              onChange={(e) => setSection(e.target.value)}
              placeholder={t('Без раздела')}
              list="site-sections"
            />
            <datalist id="site-sections">
              {(sections[group.trim()] ?? []).map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
        </div>
        <span className="field__hint field__hint--block">
          {t('Папка — где сайт лежит в боковой панели. Раздел — подгруппа внутри папки (например, ниша у демо). Новое название папки создаст её.')}
        </span>

        <label className="field">
          <span>{t('Порт')}</span>
          <div className="field__row">
            <input
              ref={portRef}
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
            <button
              type="button"
              className="btn btn--ghost"
              onClick={async () => {
                const free = await onSuggestPort()
                if (free) setPort(String(free))
              }}
            >
              {t('Свободный')}
            </button>
          </div>
        </label>

        <label className="field">
          <span>{t('Что раздаём')}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="static">{t('Статику из папки')}</option>
            <option value="command">{t('Приложение — запустить команду')}</option>
          </select>
        </label>

        {kind === 'command' ? (
          <>
            <label className="field">
              <span>{t('Команда запуска')}</span>
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="npm start"
                spellCheck={false}
              />
              <span className="field__hint">
                {t('Выполняется в папке сайта через ваш шелл, поэтому доступны те же node и npm, что и в терминале.')}
              </span>
            </label>

            <label className="field">
              <span>{t('Порт приложения')}</span>
              <input
                type="number"
                min={0}
                max={65535}
                value={targetPort}
                onChange={(e) => setTargetPort(e.target.value)}
                placeholder={t('свободный автоматически')}
              />
              <span className="field__hint">
                {t('Передаётся приложению в переменной PORT. Наружу он не смотрит — запросы идут через порт сайта, поэтому ключ доступа, проверка Host и логи работают как обычно.')}
              </span>
            </label>
          </>
        ) : null}

        <div className="modal__toggles">
          {kind === 'static'
            ? toggle(t('SPA-режим'), t('Все 404 отдавать index.html'), spa, setSpa)
            : null}
          {kind === 'static'
            ? toggle(
                'Live reload',
                t('Следить за файлами и перезагружать вкладку'),
                liveReload,
                setLiveReload
              )
            : null}
          {toggle(
            t('Туннель без ключа'),
            t('Для клиентских сайтов и сайтов со своим входом. Ссылка туннеля откроется у любого, у кого она есть. Личное держите под ключом'),
            tunnelOpen,
            setTunnelOpen
          )}
          {toggle(
            t('Доступ по локальной сети'),
            t('Слушать 0.0.0.0. Открыть можно только по ссылке с ключом — из карточки или по QR-коду'),
            lan,
            setLan
          )}
          {toggle(t('Автозапуск при старте приложения'), t('Поднимать этот сайт сразу'), autoStart, setAutoStart)}
        </div>

        <p className="modal__hint">{site.path}</p>

        <div className="modal__actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('Отмена')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {t('Сохранить')}
          </button>
        </div>
      </form>
    </div>
  )
}
