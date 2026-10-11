import { translate } from '../i18n/translate.js'
const accessNames = {
  customers: 'Доступ для клиентов',
  permissive: 'Проезд разрешён владельцем территории; условия могут изменяться',
  destination: 'Проезд к месту назначения',
  delivery: 'Доступ для доставки',
  private: 'Частный доступ',
  'private;delivery': 'Частный доступ / доставка',
}
const relevantConditional = /^(access|vehicle|motor_vehicle|motorcar|oneway|maxheight|maxwidth|maxweight):conditional$/

export function accessConditionLabels(conditions = [], language = 'ru') {
  const t = (key, params) => translate(language, key, params)
  const labels = new Set()
  for (const condition of conditions) {
    const tags = condition.tags || {}
    if (tags.barrier) labels.add(['gate', 'lift_gate', 'swing_gate'].includes(tags.barrier) ? t('Шлагбаум или ворота на пути') : tags.barrier === 'height_restrictor' ? t('Ограничитель высоты на пути') : tags.barrier === 'chain' ? t('Цепь на пути') : tags.barrier === 'border_control' ? t('Пограничный контроль на пути') : t('Препятствие на пути: {value}', { value: tags.barrier }))
    const access = tags.motorcar ?? tags.motor_vehicle ?? tags.vehicle ?? tags.access
    if (access && !['yes', 'designated'].includes(access)) labels.add(accessNames[access] ? t(accessNames[access]) : t('Условие доступа: {value}', { value: access }))
    for (const [key, label] of [['maxheight', 'Максимальная высота'], ['maxwidth', 'Максимальная ширина'], ['maxweight', 'Максимальная масса']]) if (tags[key]) {
      const unit = key === 'maxweight' ? (language === 'de' ? 't' : 'т') : (language === 'de' ? 'm' : 'м')
      const value = /\s(?:m|t|м|т)$/.test(tags[key]) ? tags[key] : `${tags[key]} ${unit}`
      labels.add(`${t(label)}: ${value}`)
    }
    if (tags.opening_hours) labels.add(t('Часы доступа на пути: {value}', { value: tags.opening_hours }))
    const effectiveConditional = ['motorcar', 'motor_vehicle', 'vehicle', 'access'].map(k => `${k}:conditional`).find(k => tags[k])
    for (const [key, value] of Object.entries(tags)) if (relevantConditional.test(key) && (!/^(access|vehicle|motor_vehicle|motorcar):/.test(key) || key === effectiveConditional)) labels.add(t('Условие {key}: {value}', { key, value }))
  }
  return [...labels]
}

export function otherRoadConditionLabels(conditions = []) {
  const labels = new Set()
  for (const { tags = {} } of conditions) for (const [key, value] of Object.entries(tags)) {
    if (key.includes('conditional') && !relevantConditional.test(key)) labels.add(`${key}: ${value}`)
  }
  return [...labels]
}

export function hasAccessConditions(site) {
  return site?.status === 'road_route_found_entrance_unverified' && accessConditionLabels(site.accessConditions).length > 0
}
