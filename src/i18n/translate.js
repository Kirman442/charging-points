import de from './de.json' with { type: 'json' }

export const LANGUAGES = ['de', 'ru']
export function translatedPattern(language, key) {
  const pattern = language === 'de' && Object.hasOwn(de, key) ? de[key] : key
  return language === 'de' && typeof pattern === 'string' ? pattern.replace(/(\d|\{\w+\}) (kW|MW|km|m|t|%)(?!\w)/g, '$1\u00a0$2') : pattern
}
export function translate(language, key, values = {}) {
  if (typeof key !== 'string') return key
  return translatedPattern(language, key).replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match)
}
export function messageParts(language, key, values = {}) {
  return translatedPattern(language, key).split(/(\{\w+\})/).map(part => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1]
    return name && Object.hasOwn(values, name) ? values[name] : part
  })
}
