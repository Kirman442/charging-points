import { BACKGROUND_DETAIL_COLUMNS, SITE_DETAIL_COLUMNS } from '../config/siteColumns.js'

export function validateDetails(details, startup, catalog, hashes) {
  const metadata = details.schema.metadata
  if (details.numRows !== startup.numRows || metadata.get('loading_format') !== 'split-sites-v1' ||
    metadata.get('startup_sites_sha256') !== hashes.sites ||
    metadata.get('source_sites_sha256') !== catalog.schema.metadata.get('sites_sha256') ||
    catalog.schema.metadata.get('details_sha256') !== hashes.details) {
    throw new Error('Подробности площадок не соответствуют карте. Пересоздай файлы: python scripts/prepare_site_loading.py')
  }
  for (const name of BACKGROUND_DETAIL_COLUMNS) {
    if (!details.getChild(name) || details.getChild(name).length !== startup.numRows) throw new Error(`Отсутствует поле подробностей: ${name}`)
  }
}

export function siteDetail(table, index, selection) {
  const detail = Object.fromEntries(SITE_DETAIL_COLUMNS.map(name => [name, table.getChild(name).get(index)]))
  detail.available_power_kw = Array.from(table.getChild('available_power_kw').get(index) || [])
  detail.selected_point_count = selection.points[index]
  detail.selected_equipment_count = selection.equipmentCounts[index]
  detail.selected_power_kw = selection.nominal[index]
  return detail
}
