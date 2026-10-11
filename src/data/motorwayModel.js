import { AUTOBAHNS, autobahnDirections, autobahnIntervalSite, A9_STATUS } from './autobahn.js'
import { MOTORWAY_REVIEW_REASONS } from './motorwayDiagnostics.js'

const invalid = () => Object.assign(new Error('Готовые данные автобана не соответствуют реестру или дорожной модели.'), { code: 'motorway-data-mismatch' })
const requireValid = condition => { if (!condition) throw invalid() }
const finite = value => Number.isFinite(value)
const point = value => Array.isArray(value) && value.length === 2 && value.every(finite) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90
const close = (a, b) => Math.abs(a - b) < 1e-7
const partKey = row => `${row.direction}:${row.section ?? ''}`
const rows = table => Array.from(table, row => Object.fromEntries(Object.entries(row.toJSON()).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value])))

// Adapt completed pipeline tables. No route search, geometry reconstruction or
// interval recalculation: validate and retain the saved interval values.
export function decodeMotorwayModel(tables, registry, route, registryHashes) {
  const directions = autobahnDirections(route)
  requireValid(directions.length === 2 && tables.sites && tables.intervals && tables.routes)
  const metadata = tables.sites.schema.metadata
  const binding = JSON.parse(metadata.get('run_binding_json') || 'null')
  const policy = JSON.parse(metadata.get('policy_json') || 'null')
  const diagnostic = JSON.parse(metadata.get('diagnostic_binding_json') || 'null')
  const diagnosticFormat = metadata.get('diagnostic_format')
  requireValid(diagnosticFormat ? diagnosticFormat === 'motorway-diagnostics-v1' && diagnostic?.version === diagnosticFormat : diagnostic === null)
  requireValid(binding?.version === 'motorway-pipeline-v1')
  if (diagnostic) {
    const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
    for (const name of ['original_run_binding_sha256', 'source_archive_sha256', 'network_sha256', 'completion_marker_sha256']) requireValid(hex(diagnostic[name]))
    requireValid(diagnostic.definition_sha256 === binding.definitions?.[route])
    for (const [key, value] of Object.entries(binding.registry || {})) requireValid(diagnostic.registry?.[key] === value)
    for (const [key, value] of Object.entries(binding.policy || {})) requireValid(diagnostic.original_policy?.[key] === value)
    const dp = diagnostic.diagnostic_policy
    for (const [key, value] of Object.entries({ ordinary_access_m: 3000, ordinary_snap_m: 60, optimistic_access_m: 15000, optimistic_snap_m: 200, never_promote_links: true })) requireValid(dp?.[key] === value)
    requireValid(Object.keys(diagnostic.engine_hashes || {}).length >= 2 && Object.keys(diagnostic.diagnostic_code_hashes || {}).length > 0)
    for (const [file, hash] of Object.entries(diagnostic.engine_hashes)) requireValid(hex(hash) && Object.entries(binding.code || {}).some(([path, original]) => path.replaceAll('\\', '/').endsWith(`/${file}`) && original === hash))
    requireValid(Object.values(diagnostic.diagnostic_code_hashes).every(hex))
    const inputs = JSON.parse(metadata.get('input_sha256_json') || 'null')
    for (const name of ['intervals.json', 'paths.geojson']) requireValid(hex(diagnostic.source_input_hashes?.[name]) && diagnostic.source_input_hashes[name] === inputs?.[name])
  }
  for (const key of ['sites_startup', 'site_details', 'runtime_catalog', 'point_groups_numeric']) requireValid(typeof registryHashes?.[key] === 'string' && binding.registry?.[key] === registryHashes[key])
  for (const [name, expected] of Object.entries({ approach_m: 3000, return_m: 3000, snap_m: 60, pool_power_kw: 400, dc_point_kw: 150 })) {
    requireValid(policy?.[name] === expected && binding.policy?.[name] === expected)
  }
  for (const kind of ['sites', 'intervals', 'routes']) {
    const md = tables[kind].schema.metadata
    requireValid(md.get('format') === 'motorway-model-parquet-v1' && md.get('table_kind') === kind && md.get('route') === route)
    for (const name of ['run_binding_json', 'policy_json', 'input_sha256_json', 'route_geometry_source_json']) requireValid(md.get(name) === metadata.get(name))
    for (const name of ['diagnostic_format', 'diagnostic_binding_json']) requireValid(md.get(name) === metadata.get(name))
  }
  const routes = rows(tables.routes), lengths = new Map()
  const sectionIds = AUTOBAHNS[route].sectionIds || [null]
  requireValid(routes.length === directions.length * sectionIds.length)
  for (const r of routes) {
    const geometry = JSON.parse(r.geometry_json), chain = JSON.parse(r.chain_json)
    requireValid(r.route === route && directions.includes(r.direction) && sectionIds.includes(r.section) && !lengths.has(partKey(r)) && finite(r.length_m) && r.length_m > 0)
    requireValid(Array.isArray(geometry) && geometry.length >= 2 && geometry.every(point) && Array.isArray(chain) && chain.length === geometry.length && close(chain[0], 0) && close(chain.at(-1), r.length_m))
    requireValid(chain.every((value, i) => finite(value) && (i === 0 || value > chain[i - 1])))
    lengths.set(partKey(r), r.length_m)
  }
  const seen = new Set(), sites = rows(tables.sites).map(s => {
    const key = `${partKey(s)}:${s.site_row}`
    requireValid(s.route === route && lengths.has(partKey(s)) && !seen.has(key))
    requireValid(Number.isInteger(s.site_row) && s.site_row >= 0 && s.site_row < registry.numRows && typeof s.site_id === 'string' && s.site_id.startsWith('site_'))
    requireValid(point([s.longitude, s.latitude]) && finite(s.power_kw) && s.power_kw >= 0 && Number.isInteger(s.fast_points) && s.fast_points >= 0)
    requireValid(s.eligible_power === (s.power_kw >= 400 && s.fast_points > 0) && s.entrance_verified === false)
    const original = registry.get(s.site_row)
    requireValid(close(s.longitude, original.longitude) && close(s.latitude, original.latitude) && s.source_date === original.source_date && s.max_power_kw === original.max_power_kw && s.charging_point_count === original.charging_point_count)
    const found = s.status === 'road_route_found_entrance_unverified'
    const excluded = s.status === 'distance_excluded'
    requireValid((found || s.status === 'unconfirmed' || (diagnostic && excluded)) && s.road_route_found === found)
    if (diagnostic) {
      if (found) requireValid(['review_reason', 'review_detail', 'diagnostic_approach_m', 'diagnostic_snap_m', 'strict_approach_found', 'strict_pair_available'].every(key => s[key] === null))
      else {
        requireValid(Object.hasOwn(MOTORWAY_REVIEW_REASONS, s.review_reason) && typeof s.strict_approach_found === 'boolean' && typeof s.strict_pair_available === 'boolean')
        const hasApproach = finite(s.diagnostic_approach_m) && s.diagnostic_approach_m >= 0 && s.diagnostic_approach_m <= 15000
        requireValid(hasApproach ? finite(s.diagnostic_snap_m) && s.diagnostic_snap_m >= 0 && s.diagnostic_snap_m <= 200 : s.diagnostic_approach_m === null && s.diagnostic_snap_m === null)
        requireValid(excluded === (s.review_reason === 'access_exceeds_3km_even_optimistic'))
        if (excluded) requireValid(hasApproach && s.diagnostic_approach_m > 3000 && !s.strict_approach_found && !s.strict_pair_available)
        if (s.review_reason === 'topology_or_coordinate_review') requireValid(!hasApproach && !s.strict_approach_found && !s.strict_pair_available)
        if (s.review_reason === 'access_or_snap_review') requireValid(hasApproach && s.diagnostic_approach_m <= 3000 && !s.strict_approach_found && !s.strict_pair_available)
        if (s.review_reason === 'return_or_snap_unconfirmed') requireValid(s.strict_approach_found && !s.strict_pair_available)
        if (s.review_reason === 'strict_pair_available_diagnostic_only') requireValid(s.strict_pair_available)
      }
    }
    if (found) {
      requireValid(finite(s.access_m) && s.access_m >= 0 && s.access_m <= 3000 && finite(s.return_m) && s.return_m >= 0 && s.return_m <= 3000 && finite(s.snap_m) && s.snap_m >= 0 && s.snap_m <= 60)
      requireValid(finite(s.chain_m) && s.chain_m >= 0 && s.chain_m <= lengths.get(partKey(s)) && finite(s.entry_chain_m) && s.entry_chain_m >= 0 && s.entry_chain_m <= lengths.get(partKey(s)))
      requireValid(Number.isSafeInteger(s.exit_node) && Number.isSafeInteger(s.entry_node))
    } else requireValid(finite(s.projected_chain_m) && s.projected_chain_m >= 0 && (s.projected_chain_m <= lengths.get(partKey(s)) || close(s.projected_chain_m, lengths.get(partKey(s)))))
    const restrictions = JSON.parse(s.restriction_notes_json || '[]'), barriers = JSON.parse(s.barrier_notes_json || '[]')
    requireValid(Array.isArray(restrictions) && Array.isArray(barriers) && (found || (!restrictions.length && !barriers.length)))
    const accessConditions = [...restrictions.map(c => ({ ...c, kind: 'road_restriction' })), ...barriers.map(c => ({ ...c, kind: 'barrier' }))]
    requireValid(accessConditions.every(c => c.tags && typeof c.tags === 'object' && !Array.isArray(c.tags) && Object.values(c.tags).every(value => typeof value === 'string')))
    seen.add(key)
    return { ...s, chain_m: found ? s.chain_m : s.projected_chain_m, position: [s.longitude, s.latitude], registry_site_id: s.site_id, accessConditions, accessEvidenceChecked: false, accessEvidenceSourceKey: 'osm-route', accessEvidenceRoute: route, accessEvidenceSource: `сохранённые данные OSM из расчёта ${route}` }
  })
  const segments = rows(tables.intervals).map(s => {
    const path = JSON.parse(s.geometry_json)
    requireValid(s.route === route && lengths.has(partKey(s)) && Object.hasOwn(A9_STATUS, s.status))
    requireValid(finite(s.start_m) && s.start_m >= 0 && finite(s.end_m) && s.end_m > s.start_m && (s.end_m <= lengths.get(partKey(s)) || close(s.end_m, lengths.get(partKey(s)))) && close(s.road_km, (s.end_m - s.start_m) / 1000))
    requireValid(Array.isArray(path) && path.length >= 2 && path.every(point))
    requireValid(s.status === 'unknown' ? s.gap_km === null : finite(s.gap_km) && s.gap_km > 0)
    return { ...s, kind: 'segment', chain_m: s.start_m, road_gap_km: s.road_km, path }
  })
  const sections = routes.map(r => {
    const { direction, section } = r
    const ss = sites.filter(s => partKey(s) === partKey(r)), eligible = ss.filter(autobahnIntervalSite)
    const parts = segments.filter(s => partKey(s) === partKey(r)).sort((a, b) => a.chain_m - b.chain_m)
    requireValid(parts.length > 0 && close(parts[0].chain_m, 0) && close(parts.at(-1).end_m, r.length_m))
    for (let i = 0; i < parts.length; i++) {
      const s = parts[i]
      requireValid(i === 0 || close(parts[i - 1].end_m, s.chain_m))
      const before = eligible.filter(a => close(a.chain_m, s.chain_m)), after = eligible.filter(b => close(b.chain_m, s.end_m))
      const distances = before.flatMap(a => after.filter(b => a.entry_chain_m <= b.chain_m).map(b => (a.return_m + b.chain_m - a.entry_chain_m + b.access_m) / 1000))
      if (s.status === 'unknown') requireValid(distances.length === 0)
      else {
        requireValid(distances.length > 0 && close(s.gap_km, Math.min(...distances)))
        requireValid(s.status === (s.gap_km > 60 ? 'gap' : s.gap_km > 50 ? 'near' : 'within'))
      }
    }
    const routed = ss.filter(s => s.status === 'road_route_found_entrance_unverified'), known = parts.filter(s => s.status !== 'unknown')
    const excluded = ss.filter(s => s.status === 'distance_excluded').length
    return { direction, section, length_km: Math.round(r.length_m / 10) / 100, candidates: ss.length, active_candidates: ss.length - excluded, routed: routed.length, fast_routed: routed.filter(s => s.fast_points > 0).length, eligible_routed: eligible.length, unresolved: ss.filter(s => s.status === 'unconfirmed').length, distance_excluded: excluded, max_gap_km: known.length ? Math.round(Math.max(...known.map(s => s.gap_km)) * 10) / 10 : null, unknown_segments: parts.filter(s => s.status === 'unknown').length, verified_entrances: 0 }
  })
  const summary = directions.map(direction => {
    const ss = sections.filter(s => s.direction === direction), known = ss.filter(s => s.max_gap_km != null)
    const result = { direction, length_km: Math.round(routes.filter(r => r.direction === direction).reduce((sum, r) => sum + r.length_m, 0) / 10) / 100, max_gap_km: known.length ? Math.max(...known.map(s => s.max_gap_km)) : null }
    for (const key of ['candidates', 'active_candidates', 'routed', 'fast_routed', 'eligible_routed', 'unresolved', 'distance_excluded', 'unknown_segments', 'verified_entrances']) result[key] = ss.reduce((sum, s) => sum + s[key], 0)
    return result
  })
  return { route, diagnostic: diagnostic ? { version: diagnostic.version } : null, candidateMethod: 'pipeline-corridor-review', candidateCorridorM: policy.candidate_corridor_m, exits: null, sections: sectionIds.length > 1 ? sections : null, segments, sites, summary, accessNetwork: true, sourceDate: sites[0]?.source_date }
}
