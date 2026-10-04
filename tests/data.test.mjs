import fs from 'node:fs'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import test from 'node:test'
import { tableFromIPC } from 'apache-arrow'
import { decodeRegions, aggregateStates, enrichStates } from '../src/data/regions.js'
import { matchingIndices, prepareSites } from '../src/data/prepareSites.js'
const { readParquet } = createRequire(import.meta.url)('parquet-wasm/node')
const read = name => tableFromIPC(readParquet(new Uint8Array(fs.readFileSync(new URL(`../public/data/${name}`, import.meta.url)))).intoIPCStream())
const sites = read('charging_sites_zstd10.parquet')
test('full registry, including the final Arrow batch', () => {
  const result = prepareSites(sites)
  assert.equal(result.count, 67680)
  assert.equal(result.totalPoints, 208570)
  assert.equal(result.rowIndices.at(-1), sites.numRows - 1)
  assert.equal(result.positions.at(-2), sites.getChild('longitude').get(sites.numRows - 1))
})
test('state aggregates conserve registry totals and decode WKB', () => {
  const states = enrichStates(decodeRegions(read('states_bev_display_100m_string.parquet'), 'states'), aggregateStates(sites))
  const districts = decodeRegions(read('districts_bev_display_100m_string.parquet'), 'districts')
  assert.equal(states.length, 16)
  assert.equal(districts.length, 400)
  assert.equal(states.reduce((sum, f) => sum + f.properties.points, 0), 208570)
  assert.equal(states.reduce((sum, f) => sum + f.properties.bev_count, 0), 2031870)
  for (const f of [...states, ...districts]) {
    assert.ok(['Polygon', 'MultiPolygon'].includes(f.geometry.type))
    assert.ok(f.geometry.coordinates.length > 0)
    assert.equal(typeof f.properties.bev_count, 'number')
  }
})
test('combined filters retain correct original row IDs; empty results work', () => {
  const indices = matchingIndices(sites, { state: 'Baden-Württemberg', minPower: 150, dcOnly: true, alwaysOpen: true })
  assert.ok(indices.length > 0)
  for (const row of indices) {
    assert.equal(sites.getChild('state_name').get(row), 'Baden-Württemberg')
    assert.ok(sites.getChild('max_power_kw').get(row) >= 150)
    assert.ok(sites.getChild('dc_point_count').get(row) > 0)
    assert.equal(sites.getChild('opening_hours_type').get(row), '24_7')
  }
  const empty = prepareSites(sites, matchingIndices(sites, { minPower: 1e9 }))
  assert.equal(empty.count, 0)
  assert.equal(empty.totalPoints, 0)
})
