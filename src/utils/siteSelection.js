import { format } from './format.js'

const plurals = new Intl.PluralRules('ru')
export function countWord(value, forms) {
  return forms[{ one: 0, few: 1, many: 2, other: 2 }[plurals.select(value)]]
}
export function counted(value, forms) {
  return `${format(value)} ${countWord(value, forms)}`
}

export function siteSelectionText(site) {
  const points = site.selected_point_count ?? site.charging_point_count
  const equipment = site.selected_equipment_count ?? site.equipment_count
  if (points === site.charging_point_count && equipment === site.equipment_count) return null
  const describe = (p, e) => `${counted(p, ['точка', 'точки', 'точек'])} и ${counted(e, ['установка', 'установки', 'установок'])}`
  return `В выборке: ${describe(points, equipment)}. Всего на площадке: ${describe(site.charging_point_count, site.equipment_count)}.`
}
