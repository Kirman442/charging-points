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

// Selection is a subset of the registry equipment; each selected installation
// is counted once by selectPoints. Equal cardinalities mean all installations
// are included, even when only some of their points match the filters.
export function sitePowerRows(site) {
  const equipment = site.selected_equipment_count ?? site.equipment_count
  const complete = equipment === site.equipment_count
  const rows = [{ label: 'Номинальная мощность всей площадки', value: `${format(site.installed_power_kw)} кВт` }]
  if (!complete) rows.push({ label: 'Мощность установок в выборке', value: `${format(site.selected_power_kw ?? site.installed_power_kw)} кВт` })
  rows.push({ label: 'Мощность точек', value: `${site.available_power_kw.map(format).join(', ')} кВт` })
  return rows
}
