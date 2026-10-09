export function accessConditionLabels(conditions = []) {
  const labels = new Set()
  for (const condition of conditions) {
    const tags = condition.tags || {}
    if (tags.barrier) labels.add(['gate', 'lift_gate', 'swing_gate'].includes(tags.barrier) ? 'Шлагбаум или ворота на пути' : tags.barrier === 'height_restrictor' ? 'Ограничитель высоты на пути' : `Препятствие на пути: ${tags.barrier}`)
    const access = tags.motorcar ?? tags.motor_vehicle ?? tags.vehicle ?? tags.access
    if (access === 'customers') labels.add('Доступ для клиентов')
    else if (access === 'permissive') labels.add('Проезд разрешён владельцем территории; условия могут изменяться')
    else if (access && !['yes', 'designated'].includes(access)) labels.add(`Условие доступа: ${access}`)
    if (tags.opening_hours) labels.add(`Часы доступа на пути: ${tags.opening_hours}`)
    for (const [key, value] of Object.entries(tags)) if (key.includes('conditional')) labels.add(`Условие ${key}: ${value}`)
  }
  return [...labels]
}
