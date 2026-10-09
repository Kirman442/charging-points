import { hasAccessConditions } from './autobahnAccess.js'
export const AUTOBAHNS = { A5: { north: 'В сторону Hattenbacher Dreieck', south: 'В сторону Basel', view: { longitude: 8.2, latitude: 49.5, zoom: 6.3, pitch: 0, bearing: 0 } }, A9: { north: 'В сторону Берлина', south: 'В сторону Мюнхена', view: { longitude: 12.1, latitude: 50.3, zoom: 6.2, pitch: 0, bearing: 0 } }, A1: { north: 'В сторону Heiligenhafen', south: 'В сторону Saarbrücken', view: { longitude: 8.5, latitude: 51.8, zoom: 5.7, pitch: 0, bearing: 0 } } }
export const A9_STATUS = {
  within: { label: 'Расчётный интервал ≤50 км', color: [68,190,170,255], dash: [0,0] },
  near: { label: 'Расчётный интервал >50–60 км', color: [240,194,70,255], dash: [8,4] },
  gap: { label: 'Расчётный интервал >60 км', color: [232,104,126,255], dash: [2,3] },
  unknown: { label: 'Интервал не рассчитан / край маршрута', color: [150,162,179,255], dash: [4,5] },
}
const invalid = () => new Error('Данные автобана не соответствуют площадкам или имеют неверную структуру. Пересоздай пилот.')
export function decodeAutobahn(table, sitesHash, siteCount, expectedRoute = 'A9') {
  const metadata = table.schema.metadata
  if (!['autobahn-pilot-v2'].includes(metadata.get('format')) || (metadata.get('route') || '').replaceAll(' ', '') !== expectedRoute || metadata.get('startup_sites_sha256') !== sitesHash || Number(metadata.get('site_count')) !== siteCount) throw invalid()
  if (metadata.get('routing_policy') !== 'pilot-3km-out-3km-back-v1' || metadata.get('interval_method') !== 'return-road-approach-v1') throw invalid()
  const summary = JSON.parse(metadata.get('directions') || 'null')
  if (!Array.isArray(summary) || summary.length !== 2 || new Set(summary.map(s => s.direction)).size !== 2 || summary.some(s => !['north','south'].includes(s.direction) || !Number.isFinite(s.length_km) || s.length_km <= 0)) throw invalid()
  const sections = JSON.parse(metadata.get('sections') || 'null')
  const candidateMethod = metadata.get('candidate_method')
  const accessEvidence = metadata.get('access_evidence')
  if (accessEvidence != null && accessEvidence !== 'step35-own-registry-paths-v1') throw invalid()
  const exitZones = candidateMethod === 'all-exits-road-zones-v1' || (expectedRoute === 'A5' && candidateMethod === 'a5-all-exits-road-zones-v1')
  if (expectedRoute === 'A1' && (!Array.isArray(sections) || sections.length !== 4 || new Set(sections.map(s => `${s.section}:${s.direction}`)).size !== 4 || sections.some(s => !['northern','southern'].includes(s.section) || !['north','south'].includes(s.direction) || !Number.isFinite(s.length_km) || s.length_km <= 0))) throw invalid()
  const segments = [], sites = [], seen = new Set()
  for (const record of table) {
    const row = record.toJSON(), coordinates = JSON.parse(row.geometry_json)
    const validPoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90
    if (!['north','south'].includes(row.direction) || !Number.isFinite(row.chain_m) || row.chain_m < 0) throw invalid()
    if (expectedRoute === 'A1' && !['northern','southern'].includes(row.section)) throw invalid()
    if (row.kind === 'segment') {
      if (!A9_STATUS[row.status] || !Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.every(validPoint) || !Number.isFinite(row.end_m) || row.end_m <= row.chain_m || !Number.isFinite(row.gap_km) || row.gap_km <= 0) throw invalid()
      segments.push({ ...row, path: coordinates })
    } else if (row.kind === 'site') {
      const key = `${row.direction}:${row.site_row}`
      if (!Number.isInteger(row.site_row) || row.site_row < 0 || row.site_row >= siteCount || !validPoint(coordinates) || seen.has(key) || !['road_route_found_entrance_unverified','unconfirmed',...(exitZones ? ['distance_excluded'] : [])].includes(row.status) || !Number.isFinite(row.power_kw) || row.power_kw < 0 || !Number.isInteger(row.fast_points) || row.fast_points < 0) throw invalid()
      if (row.status === 'road_route_found_entrance_unverified' && (!Number.isFinite(row.access_m) || row.access_m < 0 || row.access_m > 3000 || !Number.isFinite(row.return_m) || row.return_m < 0 || row.return_m > 3000 || !Number.isFinite(row.snap_m) || row.snap_m < 0 || row.snap_m > 60)) throw invalid()
      if (row.status === 'distance_excluded' && (!Number.isFinite(row.diagnostic_access_m) || row.diagnostic_access_m <= 3000)) throw invalid()
      if (row.eligible_power !== (row.power_kw >= 400 && row.fast_points > 0)) throw invalid()
      let accessConditions = []
      if (accessEvidence) {
        accessConditions = JSON.parse(row.access_conditions_json)
        if (!Array.isArray(accessConditions) || typeof row.access_evidence_checked !== 'boolean' || typeof row.registry_site_id !== 'string' || !row.registry_site_id || accessConditions.some(c => !['barrier','road_restriction','terminal_restriction'].includes(c.kind) || !c.tags || typeof c.tags !== 'object' || Array.isArray(c.tags) || Object.values(c.tags).some(v => typeof v !== 'string'))) throw invalid()
      }
      seen.add(key); sites.push({ ...row, position: coordinates, accessConditions, accessEvidenceChecked: row.access_evidence_checked === true })
    } else throw invalid()
  }
  if (!segments.length || summary.some(s => !segments.some(r => r.direction === s.direction))) throw invalid()
  if (summary.some(s => s.candidates !== sites.filter(r => r.direction === s.direction).length || s.routed !== sites.filter(r => r.direction === s.direction && r.status === 'road_route_found_entrance_unverified').length)) throw invalid()
  if (summary.some(s => s.fast_routed !== sites.filter(r => r.direction === s.direction && r.status === 'road_route_found_entrance_unverified' && r.fast_points > 0).length || s.eligible_routed !== sites.filter(r => r.direction === s.direction && autobahnIntervalSite(r)).length)) throw invalid()
  const exits = JSON.parse(metadata.get('exits') || 'null')
  if ((expectedRoute === 'A5' || exitZones) && ((!exitZones) || !Array.isArray(exits) || !exits.length || exits.some(e => !['north','south'].includes(e.direction) || !Number.isSafeInteger(e.node) || !Number.isFinite(e.chain_m) || e.chain_m < 0) || summary.some(s => s.distance_excluded !== sites.filter(r => r.direction === s.direction && r.status === 'distance_excluded').length || s.active_candidates !== s.candidates - s.distance_excluded || s.unresolved !== sites.filter(r => r.direction === s.direction && r.status === 'unconfirmed').length))) throw invalid()
  if (exitZones) {
    const exitKeys = new Set(exits.map(e => `${e.direction}:${e.section || ''}:${e.node}`))
    if (exitKeys.size !== exits.length || sites.some(s => s.status === 'road_route_found_entrance_unverified' && !exitKeys.has(`${s.direction}:${s.section || ''}:${s.exit_node}`))) throw invalid()
  }
  return { candidateMethod, exits, route: expectedRoute, sections, segments, sites, summary, accessNetwork: metadata.get('access_network') === 'true', sourceDate: metadata.get('source_date') }
}

// Keep original numeric rows for clicks. Never mutate the regular map's buffers.
export function autobahnDisplayData(data, pilot, direction, hideOthers, siteMode = 'routed', focusedRow = null) {
  if (!data) return data
  if (!pilot) return { ...data, count: 0, colors: data.colors.subarray(0,0), positions: data.positions.subarray(0,0), rowIndices: data.rowIndices.subarray(0,0), powers: data.powers.subarray(0,0), pointCounts: data.pointCounts.subarray(0,0) }
  const memberships = new Map((pilot?.sites || []).filter(site => site.direction === direction).map(site => [site.site_row, site]))
  const indices = []
  for (let i = 0; i < data.count; i++) {
    const site = memberships.get(data.rowIndices[i])
    if (site?.status === 'distance_excluded') continue
    const matches = site && (siteMode === 'all' || (siteMode === 'routed' && site.status === 'road_route_found_entrance_unverified'))
    if (data.rowIndices[i] === focusedRow || (siteMode !== 'none' && (matches || (!site && !hideOthers)))) indices.push(i)
  }
  const count = indices.length, colors = new Uint8Array(count*4), positions = new Float64Array(count*2)
  const autobahnAccess = new Uint8Array(count), autobahnEligible = new Uint8Array(count), rowIndices = new Uint32Array(count), powers = new Float32Array(count), pointCounts = new Int32Array(count)
  for (let j = 0; j < count; j++) {
    const i = indices[j], row = data.rowIndices[i], site = memberships.get(row), status = site?.status
    autobahnAccess[j] = hasAccessConditions(site) ? 1 : 0
    autobahnEligible[j] = autobahnIntervalSite(site) ? 1 : 0
    colors.set(status === 'road_route_found_entrance_unverified' ? [68,190,170,255] : status === 'unconfirmed' ? [185,191,205,235] : [110,120,135,12], j*4)
    positions.set(data.positions.subarray(i*2,i*2+2),j*2)
    rowIndices[j] = row; powers[j] = data.powers[i]; pointCounts[j] = data.pointCounts[i]
  }
  return { ...data, count, positions, colors, rowIndices, powers, pointCounts, autobahnEligible, autobahnAccess }
}

export function autobahnIntervalSite(site) {
  return site?.status === 'road_route_found_entrance_unverified' && site.power_kw >= 400 && site.fast_points > 0
}

export function autobahnSiteRadius(zoom, candidate = true) {
  const radius = Math.max(0.8, Math.min(7, 0.8 + (zoom - 5) * 0.7))
  return candidate ? radius : Math.min(1.2, radius)
}
