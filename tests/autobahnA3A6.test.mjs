import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { readParquet } from 'parquet-wasm/node'
import { tableFromIPC } from 'apache-arrow'
import { decodeMotorwayModel } from '../src/data/motorwayModel.js'
import { autobahnDirection, autobahnDirections, autobahnDisplayData, autobahnIntervalSite } from '../src/data/autobahn.js'
import { motorwayReviewLabel } from '../src/data/motorwayDiagnostics.js'

const read = name => tableFromIPC(readParquet(fs.readFileSync(`public/data/${name}`)).intoIPCStream())
const files = { sites_startup: 'charging_sites_startup_zstd10.parquet', site_details: 'charging_site_details_zstd10.parquet', runtime_catalog: 'charging_runtime_catalog_zstd10.parquet', point_groups_numeric: 'charging_point_groups_numeric_zstd10.parquet' }
const hashes = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, createHash('sha256').update(fs.readFileSync(`public/data/${file}`)).digest('hex')]))
const registry = read(files.sites_startup), details = read(files.site_details), groups = read(files.point_groups_numeric)
const power = new Float64Array(registry.numRows), fast = new Uint32Array(registry.numRows), seen = new Set()
for (const r of groups) {
  if (!seen.has(r.equipment_index)) { power[r.site_row] += r.equipment_power_kw; seen.add(r.equipment_index) }
  if (r.has_dc && r.max_power_kw >= 150) fast[r.site_row] += r.point_count
}

for (const [route, expected, segmentCount] of [
  ['A3', [['east', 768.36, 622, 201, 141, 389, 1793, 43.7], ['west', 768.81, 643, 210, 148, 338, 1826, 36.3]], 130],
  ['A6', [['east', 484.15, 307, 130, 76, 115, 733, 42.5], ['west', 484.28, 280, 120, 70, 121, 748, 45.5]], 78],
]) {
  const tables = Object.fromEntries(['sites', 'intervals', 'routes'].map(kind => [kind, read(`autobahn_${route.toLowerCase()}_${kind}_zstd10.parquet`)]))
  const model = decodeMotorwayModel(tables, registry, route, hashes)
  const edited = (kind, edit) => {
    const values = Array.from(tables[kind], r => r.toJSON()); edit(values)
    return { ...tables, [kind]: { schema: tables[kind].schema, *[Symbol.iterator]() { for (const value of values) yield { toJSON: () => value } } } }
  }

  test(`${route} preserves saved direction lengths, road links, power eligibility and unknown endpoints`, () => {
    assert.deepEqual(autobahnDirections(route), ['east', 'west'])
    assert.equal(autobahnDirection(route, 'north'), 'east')
    assert.equal(autobahnDirection(route, 'west'), 'west')
    assert.equal(model.diagnostic.version, 'motorway-diagnostics-v1')
    assert.deepEqual(model.summary.map(s => [s.direction, s.length_km, s.routed, s.fast_routed, s.eligible_routed, s.unresolved, s.distance_excluded, s.max_gap_km]), expected)
    assert.equal(model.sections, null)
    assert.equal(model.segments.length, segmentCount)
    assert.equal(model.segments.filter(s => s.status === 'unknown' && s.gap_km === null).length, 4)
  })

  test(`${route} hides excluded sites from both map modes without changing intervals`, () => {
    const before = JSON.stringify(model.segments)
    for (const summary of model.summary) {
      const ss = model.sites.filter(s => s.direction === summary.direction)
      const data = { count: ss.length, rowIndices: Uint32Array.from(ss, s => s.site_row), positions: Float64Array.from(ss.flatMap(s => s.position)), colors: new Uint8Array(ss.length * 4), powers: new Float32Array(ss.length), pointCounts: new Int32Array(ss.length) }
      assert.equal(autobahnDisplayData(data, model, summary.direction, true).count, summary.routed)
      const all = autobahnDisplayData(data, model, summary.direction, true, 'all')
      assert.equal(all.count, summary.routed + summary.unresolved)
      assert.equal(all.autobahnEligible.reduce((a, b) => a + b, 0), summary.eligible_routed)
      for (const s of ss) {
        if (s.status === 'distance_excluded') assert.ok(!Array.from(all.rowIndices).includes(s.site_row))
        if (s.status === 'unconfirmed') {
          assert.ok(motorwayReviewLabel(s.review_reason))
          assert.equal(autobahnIntervalSite({ ...s, neighbour_route_found: true }), false)
        }
      }
    }
    assert.equal(JSON.stringify(model.segments), before)
  })

  test(`${route} site card joins, installed powers and DC point counts match registry composition`, () => {
    for (const s of model.sites) {
      assert.equal(s.registry_site_id, details.getChild('site_id').get(s.site_row))
      assert.ok(Math.abs(s.power_kw - power[s.site_row]) < 1e-6)
      assert.equal(s.fast_points, fast[s.site_row])
    }
  })

  test(`${route} rejects mixed route directions, changed interval distances and diagnostic promotion`, () => {
    assert.throws(() => decodeMotorwayModel(edited('sites', values => { values[0].direction = 'north' }), registry, route, hashes))
    assert.throws(() => decodeMotorwayModel(edited('routes', values => { values[0].route = 'A4' }), registry, route, hashes))
    assert.throws(() => decodeMotorwayModel(edited('intervals', values => { values.find(s => s.status !== 'unknown').gap_km += 1 }), registry, route, hashes))
    assert.throws(() => decodeMotorwayModel(edited('intervals', values => { const end = values.filter(s => s.direction === 'east').at(-1); end.end_m += 0.001; end.road_km += 0.000001 }), registry, route, hashes))
    assert.throws(() => decodeMotorwayModel(edited('sites', values => { values.find(s => s.status === 'distance_excluded').diagnostic_approach_m = 3000 }), registry, route, hashes))
    assert.throws(() => decodeMotorwayModel(edited('sites', values => { values.find(s => s.status === 'unconfirmed').road_route_found = true }), registry, route, hashes))
  })
}
