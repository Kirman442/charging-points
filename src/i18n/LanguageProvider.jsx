import { useEffect, useMemo, useState, Fragment } from 'react'
import { I18nContext } from './context.js'
import { LANGUAGES, translate, messageParts } from './translate.js'
import { allowReview, savedLanguage } from './languageAccess.js'

const germanOnly = import.meta.env.VITE_CHARGING_GERMAN_ONLY === '1'
export default function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(() => germanOnly ? 'de' : savedLanguage())
  const [canSwitch, setCanSwitch] = useState(!germanOnly)
  useEffect(() => {
    if (!germanOnly) return
    let live = true
    allowReview(window.location.search, import.meta.env.VITE_CHARGING_REVIEW_HASH).then(allowed => {
      if (live && allowed) {
        setLanguage(savedLanguage())
        setCanSwitch(true)
      }
    })
    return () => { live = false }
  }, [])
  useEffect(() => {
    document.documentElement.lang = language
    document.title = language === 'de' ? 'Ladeinfrastruktur in Deutschland' : 'Зарядная инфраструктура Германии'
    try { if (canSwitch) localStorage.setItem('charging-language', language) } catch { /* Storage is optional. */ }
  }, [language, canSwitch])
  const value = useMemo(() => ({
    language, canSwitch, setLanguage: next => { if (canSwitch && LANGUAGES.includes(next)) setLanguage(next) },
    t: (key, values) => translate(language, key, values),
    message: (key, values) => messageParts(language, key, values).map((part, index) => <Fragment key={index}>{part}</Fragment>),
  }), [language, canSwitch])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
