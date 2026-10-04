export const METRICS = {
  sites: { title: 'Зарядные площадки', field: 'sites', unit: 'площадок' },
  bev: { title: 'Легковые BEV', field: 'bev_count', unit: 'автомобилей' },
  power: { title: 'Номинальная мощность на 1 000 BEV', field: 'kw_per_1000_bev', unit: 'кВт / 1 000 BEV' },
  ratio: { title: 'Точки на 1 000 BEV', field: 'points_per_1000_bev', unit: 'точек / 1 000 BEV' },
}
export function metricValue(region, metric) { return region?.[METRICS[metric].field] ?? null }
export function rankStates(features = [], metric = 'sites') {
  return features.map(feature => feature.properties).sort((a, b) => (metricValue(b, metric) ?? -1) - (metricValue(a, metric) ?? -1) || a.state_name.localeCompare(b.state_name))
}
export function summarizeStates(features = []) {
  const result = { sites: 0, points: 0, installed_power_kw: 0, equipment: 0, bev_count: 0, pkw_count: 0 }
  for (const { properties: p } of features) {
    for (const key of Object.keys(result)) result[key] += p[key] || 0
  }
  result.points_per_1000_bev = result.bev_count > 0 ? result.points / result.bev_count * 1000 : null
  result.kw_per_1000_bev = result.bev_count > 0 ? result.installed_power_kw / result.bev_count * 1000 : null
  return result
}
export function resolveRegion(features, stateName, clickedRegion) {
  if (clickedRegion) return clickedRegion
  return features?.find(feature => feature.properties.state_name === stateName)?.properties || null
}
