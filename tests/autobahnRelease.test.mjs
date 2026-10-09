import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import initWasm, { readParquet } from 'parquet-wasm/esm'
import { tableFromIPC } from 'apache-arrow'
import { decodeAutobahn, autobahnDisplayData, autobahnIntervalSite } from '../src/data/autobahn.js'
import { accessConditionLabels, otherRoadConditionLabels, hasAccessConditions } from '../src/data/autobahnAccess.js'

await initWasm(fs.readFileSync('node_modules/parquet-wasm/esm/parquet_wasm_bg.wasm'))
const hash = createHash('sha256').update(fs.readFileSync('public/data/charging_sites_startup_zstd10.parquet')).digest('hex')
for (const route of ['A5', 'A1', 'A9']) {
  const table = tableFromIPC(readParquet(fs.readFileSync(`public/data/autobahn_${route.toLowerCase()}_zstd10.parquet`)).intoIPCStream())
  const pilot = decodeAutobahn(table, hash, 67680, route)
  test(`${route}: release intervals reproduce return + motorway + approach and survive checkbox changes`, () => {
    assert.equal(table.schema.metadata.get('assessment'), 'road-model-accessibility')
    assert.ok(pilot.sites.some(s => s.accessConditions.length && autobahnIntervalSite(s)))
    const before = JSON.stringify(pilot.segments)
    for (const direction of ['north', 'south']) {
      const sites = pilot.sites.filter(s => s.direction === direction)
      const data = { count: sites.length, rowIndices: Uint32Array.from(sites, s => s.site_row), positions: new Float64Array(sites.length * 2), colors: new Uint8Array(sites.length * 4), powers: new Float32Array(sites.length), pointCounts: new Int32Array(sites.length) }
      for (const mode of ['routed', 'all', 'none']) autobahnDisplayData(data, pilot, direction, true, mode)
    }
    assert.equal(JSON.stringify(pilot.segments), before)
    for (const s of pilot.segments.filter(s => s.status !== 'unknown')) {
      const eligible = pilot.sites.filter(r => r.direction === s.direction && r.section === s.section && autobahnIntervalSite(r))
      const first = eligible.filter(r => Math.abs(r.chain_m - s.chain_m) < 1e-8)
      const next = eligible.filter(r => Math.abs(r.chain_m - s.end_m) < 1e-8)
      const distances = first.flatMap(a => next.filter(b => a.entry_chain_m <= b.chain_m).map(b => (a.return_m + b.chain_m - a.entry_chain_m + b.access_m) / 1000))
      assert.ok(distances.length)
      assert.ok(Math.abs(s.gap_km - Math.min(...distances)) < 1e-8)
    }
  })
  test(`${route}: own model links survive rejected OSM candidates; neighbour routes cannot grant eligibility`, () => {
    const good = pilot.sites.find(autobahnIntervalSite)
    assert.equal(autobahnIntervalSite({ ...good, accessConditions: [{ kind: 'barrier', tags: { barrier: 'lift_gate', access: 'customers' } }], rejected_osm_candidates: ['foreign'] }), true)
    const pending = pilot.sites.find(s => s.status === 'unconfirmed' && s.power_kw >= 400 && s.fast_points > 0)
    assert.ok(pending)
    assert.equal(autobahnIntervalSite({ ...pending, neighbour_route_found: true, neighbour_power_kw: 2000 }), false)
    assert.ok(pilot.sites.every(s => typeof s.accessEvidenceChecked === 'boolean' && s.registry_site_id.startsWith('site_')))
  })
}
test('Access conditions retain explanation and respect motorcar permission precedence', () => {
  assert.deepEqual(accessConditionLabels([{ kind: 'barrier', tags: { barrier: 'lift_gate', access: 'permissive' } }]), ['Шлагбаум или ворота на пути', 'Проезд разрешён владельцем территории; условия могут изменяться'])
  assert.deepEqual(accessConditionLabels([{ kind: 'road_restriction', tags: { access: 'customers', motorcar: 'yes' } }]), [])
})

test('Only car access conditions select squares; parking, speed and HGV tags remain supplementary', () => {
  const other = [{ tags: { 'parking:right:restriction:conditional': 'loading_only @ (Mo-Fr 06:00-15:00)', 'hgv:conditional': 'no @ (22:00-06:00)', 'maxspeed:conditional': '30 @ (22:00-06:00)' } }]
  assert.deepEqual(accessConditionLabels(other), [])
  assert.equal(otherRoadConditionLabels(other).length, 3)
  assert.equal(hasAccessConditions({ status: 'road_route_found_entrance_unverified', accessConditions: other }), false)
  const access = [{ tags: { motor_vehicle: 'destination', barrier: 'height_restrictor', maxheight: '2.2' } }]
  assert.ok(accessConditionLabels(access).includes('Максимальная высота: 2.2 м'))
  assert.equal(hasAccessConditions({ status: 'road_route_found_entrance_unverified', accessConditions: access }), true)
  assert.equal(hasAccessConditions({ status: 'unconfirmed', accessConditions: access }), false)
})
