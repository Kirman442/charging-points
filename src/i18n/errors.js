import { translate } from './translate.js'

// Error categories are protocol fields; raw library details stay available in
// the stored packet and developer logs, outside the translated UI sentence.
export function errorText(language, raw, category = 'data') {
  if (!raw) return ''
  if (language === 'ru') return raw
  const http = /HTTP\s+(\d{3})/.exec(raw)
  const route = /\bA[1-9]\b/.exec(raw)?.[0]
  if (http) return translate(language, route ? 'Загрузка {route}: HTTP {status}' : 'HTTP {status} при загрузке', { route, status: http[1] })
  return translate(language, category === 'boundaries' ? 'Границы: ошибка' : category === 'details' ? 'Карточки: ошибка' : category === 'map' ? 'Ошибка подложки' : category === 'motorway-data-mismatch' ? 'Неверная версия данных автобана' : category === 'motorway-load' ? 'Не удалось загрузить маршрут.' : 'Ошибка загрузки данных')
}
