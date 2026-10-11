import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { readParquet } from 'parquet-wasm/node'
import { tableFromIPC } from 'apache-arrow'
import { decodeMotorwayModel } from '../src/data/motorwayModel.js'
import { autobahnDirections, autobahnDisplayData, autobahnIntervalSite } from '../src/data/autobahn.js'
import { motorwayReviewLabel } from '../src/data/motorwayDiagnostics.js'

const read = name => tableFromIPC(readParquet(fs.readFileSync(`public/data/${name}`)).intoIPCStream())
const files = { sites_startup: 'charging_sites_startup_zstd10.parquet', site_details: 'charging_site_details_zstd10.parquet', runtime_catalog: 'charging_runtime_catalog_zstd10.parquet', point_groups_numeric: 'charging_point_groups_numeric_zstd10.parquet' }
const hashes = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, createHash('sha256').update(fs.readFileSync(`public/data/${file}`)).digest('hex')]))
const registry = read(files.sites_startup)
const tables = Object.fromEntries(['sites', 'intervals', 'routes'].map(kind => [kind, read(`autobahn_a7_${kind}_zstd10.parquet`)]))
const model = decodeMotorwayModel(tables, registry, 'A7', hashes)
const edited = (kind, edit) => {
  const values = Array.from(tables[kind], r => r.toJSON()); edit(values)
  return { ...tables, [kind]: { schema: tables[kind].schema, *[Symbol.iterator]() { for (const value of values) yield { toJSON: () => value } } } }
}

test('A7 preserves both directions, passenger profile binding and saved interval endpoints', () => {
  assert.deepEqual(autobahnDirections('A7'), ['north', 'south'])
  assert.equal(model.diagnostic.version, 'motorway-diagnostics-v1')
  const binding = JSON.parse(tables.sites.schema.metadata.get('run_binding_json'))
  const diagnostic = JSON.parse(tables.sites.schema.metadata.get('diagnostic_binding_json'))
  assert.equal(binding.policy.vehicle_profile, 'ordinary_passenger_car_non_hazmat')
  assert.equal(diagnostic.original_policy.vehicle_profile, binding.policy.vehicle_profile)
  assert.equal(diagnostic.engine_hashes['passenger_access.py'], '65e3eb112ca27bb07cd38d81f71743b0831aa107d0f36d5dc3417a7a3c468b77')
  assert.deepEqual(model.summary.map(s => [s.direction, s.length_km, s.routed, s.fast_routed, s.eligible_routed, s.unresolved, s.max_gap_km, s.unknown_segments]), [
    ['north', 961.87, 665, 276, 173, 188, 46.1, 2], ['south', 961.85, 598, 277, 177, 264, 46.8, 2],
  ])
  assert.equal(model.sections, null)
  assert.equal(model.segments.length, 165)
  assert.equal(model.segments.filter(s => s.status === 'unknown' && s.gap_km === null).length, 4)
})
test('A7 review switch hides excluded sites, preserves intervals and uses own site eligibility', () => {
  const before = JSON.stringify(model.segments)
  for (const summary of model.summary) {
    const ss = model.sites.filter(s => s.direction === summary.direction)
    assert.equal(new Set(ss.map(s => s.site_row)).size, ss.length)
    const data = { count: ss.length, rowIndices: Uint32Array.from(ss, s => s.site_row), positions: Float64Array.from(ss.flatMap(s => s.position)), colors: new Uint8Array(ss.length * 4), powers: new Float32Array(ss.length), pointCounts: new Int32Array(ss.length) }
    assert.equal(autobahnDisplayData(data, model, summary.direction, true).count, summary.routed)
    const all = autobahnDisplayData(data, model, summary.direction, true, 'all')
    assert.equal(all.count, summary.routed + summary.unresolved)
    assert.equal(all.autobahnEligible.reduce((a, b) => a + b, 0), summary.eligible_routed)
    const visible = new Set(all.rowIndices)
    for (const s of ss) {
      if (s.status === 'distance_excluded') assert.equal(visible.has(s.site_row), false)
      if (s.status === 'unconfirmed') {
        assert.ok(motorwayReviewLabel(s.review_reason))
        assert.equal(autobahnIntervalSite({ ...s, neighbour_route_found: true }), false)
      }
    }
  }
  assert.equal(JSON.stringify(model.segments), before)
})

test('A7 saved site IDs, installed power and fast points match current registry composition', () => {
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

test('A7 rejects wrong directions, invented distances and diagnostic promotion', () => {
  for (const [kind, edit] of [
    ['routes', values => values.splice(1, 1)],
    ['routes', values => { values[0].direction = 'east' }],
    ['sites', values => { values[0].direction = 'west' }],
    ['intervals', values => { values.find(s => s.status !== 'unknown').gap_km += 1 }],
    ['sites', values => { values.find(s => s.status === 'unconfirmed').road_route_found = true }],
  ]) assert.throws(() => decodeMotorwayModel(edited(kind, edit), registry, 'A7', hashes))
})
