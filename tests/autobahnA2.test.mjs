import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { readParquet } from 'parquet-wasm/node'
import { tableFromIPC } from 'apache-arrow'
import { decodeMotorwayModel } from '../src/data/motorwayModel.js'
import { autobahnDirection, autobahnDirections, autobahnDisplayData, autobahnIntervalSite } from '../src/data/autobahn.js'
import { hasAccessConditions } from '../src/data/autobahnAccess.js'
import { motorwayReviewLabel } from '../src/data/motorwayDiagnostics.js'

const read = name => tableFromIPC(readParquet(fs.readFileSync(`public/data/${name}`)).intoIPCStream())
const files = { sites_startup: 'charging_sites_startup_zstd10.parquet', site_details: 'charging_site_details_zstd10.parquet', runtime_catalog: 'charging_runtime_catalog_zstd10.parquet', point_groups_numeric: 'charging_point_groups_numeric_zstd10.parquet' }
const hashes = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, createHash('sha256').update(fs.readFileSync(`public/data/${file}`)).digest('hex')]))
const registry = read(files.sites_startup)
const tables = Object.fromEntries(['sites', 'intervals', 'routes'].map(kind => [kind, read(`autobahn_a2_${kind}_zstd10.parquet`)]))
const model = decodeMotorwayModel(tables, registry, 'A2', hashes)
const edited = (kind, editRows = () => {}, editMetadata = () => {}) => {
  const values = Array.from(tables[kind], r => r.toJSON()), metadata = new Map(tables[kind].schema.metadata)
  editRows(values); editMetadata(metadata)
  return { ...tables, [kind]: { schema: { metadata }, *[Symbol.iterator]() { for (const value of values) yield { toJSON: () => value } } } }
}

test('A2 retains east/west and the completed directional results and unknown endpoints', () => {
  assert.deepEqual(autobahnDirections('A2'), ['east', 'west'])
  assert.equal(autobahnDirection('A2', 'north'), 'east')
  assert.equal(autobahnDirection('A2', 'west'), 'west')
  assert.equal(autobahnDirection('A9', 'west'), 'north')
  assert.equal(autobahnDirection('A1', 'south'), 'south')
  assert.deepEqual(model.summary.map(s => [s.direction, s.length_km, s.routed, s.fast_routed, s.eligible_routed, s.unresolved, s.max_gap_km, s.unknown_segments]), [
    ['east', 474.55, 422, 132, 97, 182, 30, 2],
    ['west', 474.78, 398, 115, 81, 151, 42.3, 2],
  ])
  assert.equal(model.segments.length, 86)
  assert.equal(model.segments.filter(s => s.status === 'unknown' && s.gap_km === null).length, 4)
  assert.equal(model.sections, null)
})

test('A2 visibility and access conditions preserve eligibility, numeric card joins and intervals', () => {
  const before = JSON.stringify(model.segments)
  for (const s of model.summary) {
    const sites = model.sites.filter(r => r.direction === s.direction)
    const data = { count: sites.length, rowIndices: Uint32Array.from(sites, r => r.site_row), positions: Float64Array.from(sites.flatMap(r => r.position)), colors: new Uint8Array(sites.length * 4), powers: new Float32Array(sites.length), pointCounts: new Int32Array(sites.length) }
    assert.equal(autobahnDisplayData(data, model, s.direction, true).count, s.routed)
    assert.equal(autobahnDisplayData(data, model, s.direction, true, 'all').count, s.active_candidates)
    const routed = autobahnDisplayData(data, model, s.direction, true)
    assert.equal(routed.autobahnEligible.reduce((a, b) => a + b, 0), s.eligible_routed)
    assert.equal(routed.autobahnAccess.reduce((a, b) => a + b, 0), sites.filter(hasAccessConditions).length)
  }
  assert.equal(JSON.stringify(model.segments), before)
  const restricted = model.sites.find(s => hasAccessConditions(s) && autobahnIntervalSite(s))
  assert.ok(restricted)
  assert.equal(restricted.accessEvidenceChecked, false)
  assert.match(restricted.accessEvidenceSource, /A2/)
  assert.equal(autobahnIntervalSite({ ...restricted, status: 'unconfirmed', neighbour_route_found: true }), false)
})

test('A2 saved IDs, powers and fast-point counts match the current registry equipment composition', () => {
  const details = read(files.site_details), groups = read(files.point_groups_numeric)
  const power = new Float64Array(registry.numRows), fast = new Uint32Array(registry.numRows), seen = new Set()
  for (const r of groups) {
    if (!seen.has(r.equipment_index)) { power[r.site_row] += r.equipment_power_kw; seen.add(r.equipment_index) }
    if (r.has_dc && r.max_power_kw >= 150) fast[r.site_row] += r.point_count
  }
  for (const s of model.sites) {
    assert.equal(s.registry_site_id, details.getChild('site_id').get(s.site_row))
    assert.ok(Math.abs(s.power_kw - power[s.site_row]) < 1e-6)
    assert.equal(s.fast_points, fast[s.site_row])
  }
})

test('A2 rejects stale registry bindings, mixed tables, invalid routes and row joins', () => {
  for (const key of Object.keys(hashes)) assert.throws(() => decodeMotorwayModel(tables, registry, 'A2', { ...hashes, [key]: 'stale' }))
  assert.throws(() => decodeMotorwayModel(edited('routes', () => {}, md => md.set('run_binding_json', '{}')), registry, 'A2', hashes))
  assert.throws(() => decodeMotorwayModel(edited('sites', rows => { rows[0].direction = 'north' }), registry, 'A2', hashes))
  assert.throws(() => decodeMotorwayModel(edited('sites', rows => { rows[0].longitude += 0.1 }), registry, 'A2', hashes))
  assert.throws(() => decodeMotorwayModel(edited('sites', rows => { rows.push(rows[0]) }), registry, 'A2', hashes))
  assert.throws(() => decodeMotorwayModel(edited('sites', rows => { rows.find(r => r.road_route_found).return_m = 3001 }), registry, 'A2', hashes))
})

test('A2 rejects changed interval formula, invented endpoint coverage and missing road sections', () => {
  assert.throws(() => decodeMotorwayModel(edited('intervals', rows => { rows.find(r => r.status !== 'unknown').gap_km += 1 }), registry, 'A2', hashes))
  assert.throws(() => decodeMotorwayModel(edited('intervals', rows => { rows[0].status = 'within'; rows[0].gap_km = 10 }), registry, 'A2', hashes))
  assert.throws(() => decodeMotorwayModel(edited('intervals', rows => { rows.splice(1, 1) }), registry, 'A2', hashes))
  assert.throws(() => decodeMotorwayModel(edited('routes', rows => { rows[0].length_m += 1 }), registry, 'A2', hashes))
})

test('A2 diagnostic exclusion hides long approaches even with review enabled, retaining reason labels', () => {
  assert.deepEqual(model.summary.map(s => [s.distance_excluded, s.unresolved]), [[947, 182], [1008, 151]])
  for (const s of model.sites) {
    if (s.status === 'distance_excluded') {
      assert.ok(s.diagnostic_approach_m > 3000)
      assert.equal(autobahnIntervalSite(s), false)
    }
    if (s.status === 'unconfirmed') assert.ok(motorwayReviewLabel(s.review_reason))
  }
  assert.equal(motorwayReviewLabel('unknown'), null)
  assert.ok(model.diagnostic)
})

test('A2 rejects mixed diagnostic generations, invalid exclusion and diagnostic promotion', () => {
  assert.throws(() => decodeMotorwayModel(edited('intervals', () => {}, md => md.delete('diagnostic_binding_json')), registry, 'A2', hashes))
  assert.throws(() => decodeMotorwayModel(edited('sites', values => { values.find(s => s.status === 'distance_excluded').diagnostic_approach_m = 3000 }), registry, 'A2', hashes))
  assert.throws(() => decodeMotorwayModel(edited('sites', values => { values.find(s => s.status === 'distance_excluded').review_reason = 'access_or_snap_review' }), registry, 'A2', hashes))
  assert.throws(() => decodeMotorwayModel(edited('sites', values => { values.find(s => s.status === 'unconfirmed').road_route_found = true }), registry, 'A2', hashes))
  assert.throws(() => decodeMotorwayModel(edited('sites', values => { values.find(s => s.road_route_found).review_reason = 'strict_pair_available_diagnostic_only' }), registry, 'A2', hashes))
  assert.throws(() => decodeMotorwayModel(edited('sites', () => {}, md => {
    const d = JSON.parse(md.get('diagnostic_binding_json')); d.engine_hashes['a5_full_road_access.py'] = '0'.repeat(64); md.set('diagnostic_binding_json', JSON.stringify(d))
  }), registry, 'A2', hashes))
})

test('Original pipeline tables remain supported without diagnostic metadata', () => {
  const original = Object.fromEntries(Object.entries(tables).map(([kind, table]) => {
    const metadata = new Map(table.schema.metadata)
    metadata.delete('diagnostic_format'); metadata.delete('diagnostic_binding_json')
    const values = Array.from(table, r => r.toJSON()).map(s => kind === 'sites' && s.status === 'distance_excluded' ? { ...s, status: 'unconfirmed' } : s)
    return [kind, { schema: { metadata }, *[Symbol.iterator]() { for (const value of values) yield { toJSON: () => value } } }]
  }))
  const old = decodeMotorwayModel(original, registry, 'A2', hashes)
  assert.deepEqual(old.summary.map(s => s.unresolved), [1129, 1159])
  assert.equal(old.diagnostic, null)
  assert.deepEqual(old.segments, model.segments)
})
