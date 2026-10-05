import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { tableFromArrays, tableFromIPC } from 'apache-arrow'
import { buildOperatorIndex, summarizeOperators } from '../src/data/operators.js'
import { aggregateSelection, applyRegionStats, buildDistrictIndex } from '../src/data/regions.js'
import { matchingIndices } from '../src/data/prepareSites.js'
const { readParquet } = createRequire(import.meta.url)('parquet-wasm/node')
const read = name => tableFromIPC(readParquet(new Uint8Array(fs.readFileSync(new URL(`../public/data/${name}_zstd10.parquet`, import.meta.url)))).intoIPCStream())
const sites = read('charging_sites'), links = buildDistrictIndex(sites, read('site_district_counts')), index = buildOperatorIndex(sites)
const close = (a, b) => assert.ok(Math.abs(a - b) < 0.001, `${a} != ${b}`)
test('technical normalization merges spacing/case variants without merging separate legal companies', () => {
  const table = tableFromArrays({ operator: ['  CUBOS  Service GmbH ', 'Cubos Service GmbH', 'Cubos GmbH', 'Autohaus\u00a0Horn', 'Autohaus Horn', '', null] })
  const op = buildOperatorIndex(table)
  assert.equal(op.ids[0], op.ids[1])
  assert.notEqual(op.ids[1], op.ids[2])
  assert.equal(op.ids[3], op.ids[4])
  assert.equal(op.ids[5], op.ids[6])
  assert.equal(op.names[op.ids[5]], 'Оператор не указан')
})
test('points and power have separate leaders; top five plus Others exhaust the denominator', () => {
  const totals = new Map([
    [0, { points: 100, power: 10 }], [1, { points: 10, power: 1000 }],
    [2, { points: 9, power: 90 }], [3, { points: 8, power: 80 }],
    [4, { points: 7, power: 70 }], [5, { points: 6, power: 60 }],
  ])
  const summary = summarizeOperators(totals, ['A', 'B', 'C', 'D', 'E', 'F'])
  assert.equal(summary.points.leaders[0].name, 'A')
  assert.equal(summary.power.leaders[0].name, 'B')
  assert.equal(summary.count, 6)
  for (const basis of ['points', 'power']) {
    const s = summary[basis]
    assert.equal(s.leaders.length, 5)
    assert.equal(s.others.count, 1)
    close(s.leaders.reduce((n, e) => n + e.value, 0) + s.others.value, s.total)
    close(s.leaders.reduce((n, e) => n + e.share, 0) + s.others.share, 100)
  }
  const zero = summarizeOperators(new Map([[0, { points: 1, power: 0 }]]), ['A'])
  assert.equal(zero.power.leaders[0].share, null)
})
test('operator denominators match national/state/district infrastructure under every filter', () => {
  for (const filter of [{}, { state: 'Bayern' }, { state: 'Brandenburg', minPower: 150 }, { dcOnly: true }, { alwaysOpen: true }, { minPower: 1e9 }]) {
    const selected = matchingIndices(sites, filter)
    const stats = aggregateSelection(sites, selected, links, index)
    for (const level of ['states', 'districts']) {
      for (const s of Object.values(stats[level])) {
        close(s.operators.points.total, s.points)
        close(s.operators.power.total, s.installed_power_kw)
        for (const basis of ['points', 'power']) {
          const d = s.operators[basis]
          close(d.leaders.reduce((n, e) => n + e.value, 0) + d.others.value, d.total)
        }
      }
      close(Object.values(stats[level]).reduce((n, s) => n + s.operators.points.total, 0), stats.nationalOperators.points.total)
      close(Object.values(stats[level]).reduce((n, s) => n + s.operators.power.total, 0), stats.nationalOperators.power.total)
    }
    const directPoints = Array.from(selected).reduce((n, row) => n + sites.getChild('charging_point_count').get(row), 0)
    close(stats.nationalOperators.points.total, directPoints)
    if (filter.minPower === 1e9) {
      assert.equal(stats.nationalOperators.count, 0)
      const regions = applyRegionStats({ states: [{ properties: { state_name: 'Bayern', bev_count: 1, operators: { count: 999 } } }], districts: [] }, stats)
      assert.equal(regions.states[0].properties.operators.count, 0)
    }
  }
})

test('operator cache preserves first display name across batches and sliced vectors', () => {
  const first = tableFromArrays({operator:['Unused', '  ÄCME GmbH  ', 'Other GmbH']}).slice(1)
  const second = tableFromArrays({operator:['  ÄCME GmbH  ', 'äcme gmbh', 'Other GmbH', null]})
  const index = buildOperatorIndex(first.concat(second))
  assert.deepEqual(index.names,['ÄCME GmbH','Other GmbH','Оператор не указан'])
  assert.deepEqual(Array.from(index.ids),[0,1,0,0,1,2])
})
