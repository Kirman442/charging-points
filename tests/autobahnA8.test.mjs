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
const tables = Object.fromEntries(['sites', 'intervals', 'routes'].map(kind => [kind, read(`autobahn_a8_${kind}_zstd10.parquet`)]))
const model = decodeMotorwayModel(tables, registry, 'A8', hashes)
const edited = (kind, edit) => {
  const values = Array.from(tables[kind], r => r.toJSON()); edit(values)
  return { ...tables, [kind]: { schema: tables[kind].schema, *[Symbol.iterator]() { for (const value of values) yield { toJSON: () => value } } } }
}

test('A8 preserves three separate parts in each direction without bridging physical gaps', () => {
  assert.deepEqual(autobahnDirections('A8'), ['east', 'west'])
  assert.equal(model.diagnostic.version, 'motorway-diagnostics-v1')
  assert.deepEqual(model.summary.map(s => [s.direction, s.length_km, s.routed, s.fast_routed, s.eligible_routed, s.unresolved, s.max_gap_km, s.unknown_segments]), [
    ['east', 504, 376, 134, 84, 537, 28.7, 5], ['west', 503.31, 409, 143, 92, 485, 35.1, 7],
  ])
  assert.deepEqual(model.sections.map(s => [s.direction, s.section, s.routed, s.eligible_routed, s.unresolved]), [
    ['east', 'section_01', 84, 15, 26], ['east', 'section_02', 176, 51, 479], ['east', 'section_03', 116, 18, 32],
    ['west', 'section_01', 91, 17, 23], ['west', 'section_02', 206, 55, 348], ['west', 'section_03', 112, 20, 114],
  ])
  assert.equal(model.segments.length, 95)
  assert.equal(model.segments.filter(s => s.status === 'unknown' && s.gap_km === null).length, 12)
  for (const s of model.segments) {
    assert.ok(s.path.every(p => s.section === 'section_01' ? p[0] < 7.6 : s.section === 'section_02' ? p[0] > 8.4 && p[0] < 11.5 : p[0] > 11.6))
  }
})

test('A8 review switch hides excluded sites, preserves intervals and uses own site eligibility', () => {
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

test('A8 saved site IDs, installed power and fast points match current registry composition', () => {
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

test('A8 rejects missing or mixed sections, invented distances and diagnostic promotion', () => {
  for (const [kind, edit] of [
    ['routes', values => values.splice(2, 1)],
    ['routes', values => { values[0].section = 'section_03' }],
    ['sites', values => { values[0].section = null }],
    ['intervals', values => { values.find(s => s.section === 'section_03').section = 'section_02' }],
    ['intervals', values => { values.find(s => s.status !== 'unknown').gap_km += 1 }],
    ['sites', values => { values.find(s => s.status === 'unconfirmed').road_route_found = true }],
  ]) assert.throws(() => decodeMotorwayModel(edited(kind, edit), registry, 'A8', hashes))
})
