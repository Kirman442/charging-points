const accessNames = {
  customers: 'Доступ для клиентов',
  permissive: 'Проезд разрешён владельцем территории; условия могут изменяться',
  destination: 'Проезд к месту назначения',
  delivery: 'Доступ для доставки',
  private: 'Частный доступ',
  'private;delivery': 'Частный доступ / доставка',
}
const relevantConditional = /^(access|vehicle|motor_vehicle|motorcar|oneway|maxheight|maxwidth|maxweight):conditional$/

export function accessConditionLabels(conditions = []) {
  const labels = new Set()
  for (const condition of conditions) {
    const tags = condition.tags || {}
    if (tags.barrier) labels.add(['gate', 'lift_gate', 'swing_gate'].includes(tags.barrier) ? 'Шлагбаум или ворота на пути' : tags.barrier === 'height_restrictor' ? 'Ограничитель высоты на пути' : tags.barrier === 'chain' ? 'Цепь на пути' : tags.barrier === 'border_control' ? 'Пограничный контроль на пути' : `Препятствие на пути: ${tags.barrier}`)
    const access = tags.motorcar ?? tags.motor_vehicle ?? tags.vehicle ?? tags.access
    if (access && !['yes', 'designated'].includes(access)) labels.add(accessNames[access] || `Условие доступа: ${access}`)
    for (const [key, label] of [['maxheight', 'Максимальная высота'], ['maxwidth', 'Максимальная ширина'], ['maxweight', 'Максимальная масса']]) if (tags[key]) labels.add(`${label}: ${tags[key]} ${key === 'maxweight' ? 'т' : 'м'}`)
    if (tags.opening_hours) labels.add(`Часы доступа на пути: ${tags.opening_hours}`)
    const effectiveConditional = ['motorcar', 'motor_vehicle', 'vehicle', 'access'].map(k => `${k}:conditional`).find(k => tags[k])
    for (const [key, value] of Object.entries(tags)) if (relevantConditional.test(key) && (!/^(access|vehicle|motor_vehicle|motorcar):/.test(key) || key === effectiveConditional)) labels.add(`Условие ${key}: ${value}`)
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
