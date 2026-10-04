import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { tableFromIPC } from 'apache-arrow'
import { aggregateSelection, buildDistrictIndex, applyRegionStats } from '../src/data/regions.js'
import { matchingIndices } from '../src/data/prepareSites.js'
import { summarizeStates } from '../src/data/analytics.js'
const { readParquet } = createRequire(import.meta.url)('parquet-wasm/node')
const read = name => tableFromIPC(readParquet(new Uint8Array(fs.readFileSync(new URL(`../public/data/${name}_zstd10.parquet`, import.meta.url)))).intoIPCStream())
const sites = read('charging_sites'), points = read('charging_points')
const links = buildDistrictIndex(sites, read('site_district_counts'))
const equipment = new Map()
for (let i = 0; i < points.numRows; i++) {
  const id = points.getChild('equipment_id').get(i)
  const power = points.getChild('equipment_power_kw').get(i)
  if (equipment.has(id)) assert.equal(equipment.get(id).power, power)
  equipment.set(id, { site: points.getChild('site_id').get(i), power })
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 0.001, `${a} != ${b}`)
test('nominal power counts each installation once and district totals conserve it under all filters', () => {
  for (const filter of [{}, { state: 'Hessen' }, { minPower: 150 }, { dcOnly: true }, { alwaysOpen: true }, { minPower: 1e9 }]) {
    const indices = matchingIndices(sites, filter)
    const selected = new Set(Array.from(indices, row => sites.getChild('site_id').get(row)))
    let expected = 0, installations = 0
    for (const e of equipment.values()) if (selected.has(e.site)) { expected += e.power; installations++ }
    const stats = aggregateSelection(sites, indices, links)
    for (const level of ['states', 'districts']) {
      close(Object.values(stats[level]).reduce((sum, p) => sum + p.installed_power_kw, 0), expected)
      assert.equal(Object.values(stats[level]).reduce((sum, p) => sum + p.equipment, 0), installations)
    }
  }
})
test('site powers are deduplicated installation sums, including multiple-point equipment', () => {
  const totals = new Map()
  for (const e of equipment.values()) totals.set(e.site, (totals.get(e.site) || 0) + e.power)
  for (let row = 0; row < sites.numRows; row++) close(sites.getChild('installed_power_kw').get(row), totals.get(sites.getChild('site_id').get(row)))
  assert.equal(equipment.size, 116108)
})
test('power ratios use regional BEV denominators, national totals, and null for zero BEV', () => {
  const base = { states: [
    { properties: { state_name: 'A', bev_count: 1000 } },
    { properties: { state_name: 'B', bev_count: 100 } },
    { properties: { state_name: 'C', bev_count: 0 } },
  ], districts: [{ properties: { district_code: '01', bev_count: 10 } }] }
  const regions = applyRegionStats(base, { states: { A: { installed_power_kw: 2200 }, B: { installed_power_kw: 6040 } }, districts: { '01': { installed_power_kw: 150 } } })
  assert.equal(regions.states[0].properties.kw_per_1000_bev, 2200)
  assert.equal(regions.states[1].properties.kw_per_1000_bev, 60400)
  assert.equal(regions.states[2].properties.kw_per_1000_bev, null)
  assert.equal(regions.districts[0].properties.kw_per_1000_bev, 15000)
  assert.equal(summarizeStates(regions.states).kw_per_1000_bev, 8240 / 1100 * 1000)
})
