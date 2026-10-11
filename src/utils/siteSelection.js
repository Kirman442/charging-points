import { format } from './format.js'
import { translate } from '../i18n/translate.js'

const plurals = new Intl.PluralRules('ru')
export function countWord(value, forms, language = 'ru') {
  if (language === 'de') {
    const first = forms[0].toLowerCase()
    if (first.includes('площад')) return value === 1 ? 'Standort' : 'Standorte'
    if (first.includes('установ')) return value === 1 ? 'Station' : 'Stationen'
    if (first.includes('точ')) return value === 1 ? 'Ladepunkt' : 'Ladepunkte'
  }
  return forms[{ one: 0, few: 1, many: 2, other: 2 }[plurals.select(value)]]
}
export function counted(value, forms, language = 'ru') {
  return `${format(value)} ${countWord(value, forms, language)}`
}

export function siteSelectionText(site, language = 'ru') {
  const points = site.selected_point_count ?? site.charging_point_count
  const equipment = site.selected_equipment_count ?? site.equipment_count
  if (points === site.charging_point_count && equipment === site.equipment_count) return null
  if (language === 'de') return translate(language, 'selection-composition', {
    points: counted(points, ['точка', 'точки', 'точек'], language),
    equipment: counted(equipment, ['установка', 'установки', 'установок'], language),
    totalPoints: counted(site.charging_point_count, ['точка', 'точки', 'точек'], language),
    totalEquipment: counted(site.equipment_count, ['установка', 'установки', 'установок'], language),
  })
  const describe = (p, e) => `${counted(p, ['точка', 'точки', 'точек'])} и ${counted(e, ['установка', 'установки', 'установок'])}`
  return `В выборке: ${describe(points, equipment)}. Всего на площадке: ${describe(site.charging_point_count, site.equipment_count)}.`
}

// Selection is a subset of the registry equipment; each selected installation
// is counted once by selectPoints. Equal cardinalities mean all installations
// are included, even when only some of their points match the filters.
export function sitePowerRows(site, language = 'ru') {
  const equipment = site.selected_equipment_count ?? site.equipment_count
  const complete = equipment === site.equipment_count
  const unit = language === 'de' ? 'kW' : 'кВт'
  const rows = [{ label: 'Номинальная мощность всей площадки', value: `${format(site.installed_power_kw)} ${unit}` }]
  if (!complete) rows.push({ label: 'Мощность установок в выборке', value: `${format(site.selected_power_kw ?? site.installed_power_kw)} ${unit}` })
  rows.push({ label: 'Мощность точек', value: `${site.available_power_kw.map(format).join(', ')} ${unit}` })
  return rows
}
