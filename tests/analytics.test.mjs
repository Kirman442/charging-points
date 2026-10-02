import assert from 'node:assert/strict'
import test from 'node:test'
import { metricValue, rankStates, resolveRegion, summarizeStates } from '../src/data/analytics.js'
const states = [
  { properties: { state_code: '01', state_name: 'A', level: 'states', sites: 20, points: 40, bev_count: 1000, pkw_count: 2000, points_per_1000_bev: 40 } },
  { properties: { state_code: '02', state_name: 'B', level: 'states', sites: 10, points: 20, bev_count: 100, pkw_count: 1000, points_per_1000_bev: 200 } },
]
test('metric switches change the headline and ranking', () => {
  assert.equal(metricValue(states[0].properties, 'sites'), 20)
  assert.equal(metricValue(states[0].properties, 'bev'), 1000)
  assert.equal(metricValue(states[0].properties, 'ratio'), 40)
  assert.equal(rankStates(states, 'sites')[0].state_name, 'A')
  assert.equal(rankStates(states, 'ratio')[0].state_name, 'B')
})
test('national ratio is computed from totals, not the mean of state ratios', () => {
  const total = summarizeStates(states)
  assert.equal(total.sites, 30)
  assert.equal(total.points, 60)
  assert.equal(total.points_per_1000_bev, 60 / 1100 * 1000)
  assert.notEqual(total.points_per_1000_bev, 120)
})
test('dropdown selection resolves analytics before any map click', () => {
  assert.equal(resolveRegion(states, 'B', null).state_code, '02')
  assert.equal(resolveRegion(states, '', null), null)
  assert.equal(resolveRegion(states, 'B', states[0].properties).state_code, '01')
})
test('unavailable district infrastructure is not displayed as zero', () => {
  assert.equal(metricValue({ bev_count: 123 }, 'ratio'), null)
  assert.equal(metricValue({ bev_count: 123 }, 'sites'), null)
})
