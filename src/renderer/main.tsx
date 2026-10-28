import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { setLang } from '../shared/i18n'
import './styles.css'

// The language comes from main (its setting or macOS's) before the first render.
void window.api
  .getLanguage()
  .catch(() => ({ lang: 'en' as const }))
  .then(({ lang }) => {
    setLang(lang)
    document.documentElement.lang = lang
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>
    )
  })
