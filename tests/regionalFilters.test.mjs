import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { tableFromIPC } from 'apache-arrow'
import { aggregateSelection, applyRegionStats, buildDistrictIndex, decodeRegions } from '../src/data/regions.js'
import { matchingIndices, prepareSites } from '../src/data/prepareSites.js'
import { territoryLabel } from '../src/utils/territory.js'
const { readParquet } = createRequire(import.meta.url)('parquet-wasm/node')
const read = name => tableFromIPC(readParquet(new Uint8Array(fs.readFileSync(new URL(`../public/data/${name}`, import.meta.url)))).intoIPCStream())
const sites = read('charging_sites_zstd10.parquet')
const links = buildDistrictIndex(sites, read('site_district_counts_zstd10.parquet'))
const base = { states: decodeRegions(read('states_bev_display_100m_string.parquet'), 'states'), districts: decodeRegions(read('districts_bev_display_100m_string.parquet'), 'districts') }
test('all equipment-derived district points reconcile with accepted national total', () => {
  const stats = aggregateSelection(sites, matchingIndices(sites), links)
  assert.equal(Object.values(stats.districts).reduce((s, v) => s + v.points, 0), 208570)
  assert.equal(Object.values(stats.states).reduce((s, v) => s + v.sites, 0), 67680)
  assert.ok(stats.districts['05111'].sites > 0)
  assert.ok(stats.districts['05111'].points > 0)
})
test('power/DC/hours/state filters update state and district statistics together', () => {
  for (const filters of [{ minPower: 150 }, { dcOnly: true }, { alwaysOpen: true }, { state: 'Nordrhein-Westfalen', minPower: 300 }, { minPower: 1e9 }]) {
    const indices = matchingIndices(sites, filters)
    const stats = aggregateSelection(sites, indices, links)
    const data = prepareSites(sites, indices)
    assert.equal(Object.values(stats.states).reduce((s,v) => s+v.sites,0),data.count)
    assert.equal(Object.values(stats.states).reduce((s,v) => s+v.points,0),data.totalPoints)
    assert.equal(Object.values(stats.districts).reduce((s,v) => s+v.points,0),data.totalPoints)
    const regions = applyRegionStats(base, stats)
    const d = regions.districts.find(f => f.properties.district_code === '05111').properties
    assert.equal(typeof d.sites, 'number')
    assert.equal(d.bev_count, base.districts.find(f => f.properties.district_code === '05111').properties.bev_count)
    assert.equal(d.points_per_1000_bev, d.points / d.bev_count * 1000)
    if (filters.minPower === 1e9) { assert.equal(d.sites,0); assert.equal(d.points,0) }
  }
})
test('labels cover every KBA territory including all autonomous-city types and Trier', () => {
  const labels = JSON.parse(fs.readFileSync(new URL('../public/data/district_labels.json', import.meta.url)))
  assert.ok(base.districts.every(f => labels[f.properties.district_code]))
  assert.equal(labels['05111'].display_name,'Düsseldorf')
  assert.match(territoryLabel(labels['05111'].territory_type),/Город вне состава района/)
  assert.match(territoryLabel(labels['08111'].territory_type),/Город вне состава района/)
  assert.match(labels['07211'].territory_type,/Объединённая/)
})
