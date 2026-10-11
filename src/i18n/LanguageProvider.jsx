import { useEffect, useMemo, useState, Fragment } from 'react'
import { I18nContext } from './context.js'
import { LANGUAGES, translate, messageParts } from './translate.js'

function initialLanguage() {
  try { const saved = localStorage.getItem('charging-language'); if (LANGUAGES.includes(saved)) return saved } catch { /* Storage is optional. */ }
  return 'de'
}
export default function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(initialLanguage)
  useEffect(() => {
    document.documentElement.lang = language
    document.title = language === 'de' ? 'Ladeinfrastruktur in Deutschland' : 'Зарядная инфраструктура Германии'
    try { localStorage.setItem('charging-language', language) } catch { /* Storage is optional. */ }
  }, [language])
  const value = useMemo(() => ({
    language, setLanguage: next => { if (LANGUAGES.includes(next)) setLanguage(next) },
    t: (key, values) => translate(language, key, values),
    message: (key, values) => messageParts(language, key, values).map((part, index) => <Fragment key={index}>{part}</Fragment>),
  }), [language])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
