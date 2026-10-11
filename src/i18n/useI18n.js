import { useContext } from 'react'
import { I18nContext } from './context.js'
export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('LanguageProvider is required')
  return context
}
