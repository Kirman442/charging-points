import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { readParquet } from 'parquet-wasm/node'
import { tableFromIPC } from 'apache-arrow'
import { decodeMotorwayModel } from '../src/data/motorwayModel.js'
import { autobahnDirection, autobahnDirections, autobahnDisplayData } from '../src/data/autobahn.js'
import { hasAccessConditions } from '../src/data/autobahnAccess.js'

const read = name => tableFromIPC(readParquet(fs.readFileSync(`public/data/${name}`)).intoIPCStream())
const files = { sites_startup: 'charging_sites_startup_zstd10.parquet', site_details: 'charging_site_details_zstd10.parquet', runtime_catalog: 'charging_runtime_catalog_zstd10.parquet', point_groups_numeric: 'charging_point_groups_numeric_zstd10.parquet' }
const hashes = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, createHash('sha256').update(fs.readFileSync(`public/data/${file}`)).digest('hex')]))
const registry = read(files.sites_startup)
const tables = Object.fromEntries(['sites', 'intervals', 'routes'].map(kind => [kind, read(`autobahn_a4_${kind}_zstd10.parquet`)]))
const model = decodeMotorwayModel(tables, registry, 'A4', hashes)
const edited = (kind, edit) => {
  const values = Array.from(tables[kind], r => r.toJSON())
  edit(values)
  return { ...tables, [kind]: { schema: tables[kind].schema, *[Symbol.iterator]() { for (const value of values) yield { toJSON: () => value } } } }
}

test('A4 retains both directions, two separate sections and saved unknown endpoints', () => {
  assert.deepEqual(autobahnDirections('A4'), ['east', 'west'])
  assert.equal(autobahnDirection('A4', 'west'), 'west')
  assert.equal(autobahnDirection('A4', 'south'), 'east')
  assert.deepEqual(model.summary.map(s => [s.length_km, s.routed, s.fast_routed, s.eligible_routed, s.unresolved, s.max_gap_km, s.unknown_segments]), [
    [584.45, 438, 154, 89, 188, 46.8, 4], [585.05, 408, 144, 80, 202, 46.9, 4],
  ])
  assert.deepEqual(model.sections.map(s => [s.direction, s.section, s.routed, s.eligible_routed, s.max_gap_km]), [
    ['east', 'section_01', 222, 27, 30.9], ['east', 'section_02', 216, 62, 46.8],
    ['west', 'section_01', 203, 23, 30], ['west', 'section_02', 205, 57, 46.9],
  ])
  assert.equal(model.segments.length, 95)
  assert.equal(model.segments.filter(s => s.status === 'unknown' && s.gap_km === null).length, 8)
  for (const s of model.segments) {
    // Saved interval paths stay on their own side of the physical motorway gap.
    assert.ok(s.path.every(p => s.section === 'section_01' ? p[0] < 8 : p[0] > 9.5))
  }
})

test('A4 visibility does not change intervals or grant neighbour-based eligibility', () => {
  const before = JSON.stringify(model.segments)
  for (const s of model.summary) {
    const sites = model.sites.filter(r => r.direction === s.direction)
    assert.equal(new Set(sites.map(r => r.site_row)).size, sites.length)
    const data = { count: sites.length, rowIndices: Uint32Array.from(sites, r => r.site_row), positions: Float64Array.from(sites.flatMap(r => r.position)), colors: new Uint8Array(sites.length * 4), powers: new Float32Array(sites.length), pointCounts: new Int32Array(sites.length) }
    const routed = autobahnDisplayData(data, model, s.direction, true)
    assert.equal(routed.count, s.routed)
    assert.equal(routed.autobahnEligible.reduce((a, b) => a + b, 0), s.eligible_routed)
    assert.equal(routed.autobahnAccess.reduce((a, b) => a + b, 0), sites.filter(hasAccessConditions).length)
    assert.equal(autobahnDisplayData(data, model, s.direction, true, 'all').count, s.active_candidates)
  }
  assert.equal(JSON.stringify(model.segments), before)
})

test('A4 saved powers, fast points and site identifiers match current equipment composition', () => {
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
    assert.equal(s.accessEvidenceChecked, false)
    assert.match(s.accessEvidenceSource, /A4/)
  }
})

test('A4 rejects missing or mixed sections and changed interval distances', () => {
  for (const [kind, edit] of [
    ['routes', r => r.splice(1, 1)],
    ['routes', r => { r[0].section = 'section_02' }],
    ['sites', r => { r[0].section = null }],
    ['sites', r => { r.find(s => !s.road_route_found).projected_chain_m = 1e9 }],
    ['intervals', r => { r.find(s => s.status !== 'unknown').gap_km += 1 }],
    ['intervals', r => { r.find(s => s.section === 'section_01').section = 'section_02' }],
    ['intervals', r => { r.splice(1, 1) }],
  ]) assert.throws(() => decodeMotorwayModel(edited(kind, edit), registry, 'A4', hashes))
  for (const key of Object.keys(hashes)) assert.throws(() => decodeMotorwayModel(tables, registry, 'A4', { ...hashes, [key]: 'stale' }))
})

test('A4 preserves tiny endpoint projection roundoff without changing saved coordinates', () => {
  const routes = Array.from(tables.routes, r => r.toJSON())
  const boundary = model.sites.filter(s => !s.road_route_found && s.projected_chain_m > routes.find(r => r.direction === s.direction && r.section === s.section).length_m)
  assert.equal(boundary.length, 12)
  for (const s of boundary) assert.equal(s.chain_m, s.projected_chain_m)
})
