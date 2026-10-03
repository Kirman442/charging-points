import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_OPTIONS, normalizeOptions, resetOptions, reconcileRegion } from '../src/map/settings.js'

const state = { level: 'states', state_code: '05', state_name: 'Nordrhein-Westfalen' }
const district = { level: 'districts', state_code: '05', district_code: '05111' }
const regions = { states: [{ properties: state }] }

test('ratio switches districts to states while preserving hidden boundaries and markers', () => {
  const ratio = normalizeOptions({ ...DEFAULT_OPTIONS, metric: 'ratio', territory: 'districts', showBoundaries: false, showSites: false })
  assert.equal(ratio.territory, 'states')
  assert.equal(ratio.showBoundaries, false)
  assert.equal(ratio.showSites, false)
  assert.equal(normalizeOptions({ ...ratio, metric: 'bev' }).territory, 'states')
})
test('reset restores every map setting except the chosen basemap', () => {
  const changed = { metric: 'bev', territory: 'districts', showBoundaries: false, showSites: false, style: 'light' }
  assert.deepEqual(resetOptions(changed), { ...DEFAULT_OPTIONS, style: 'light' })
})
test('district selection becomes its parent state; switching to districts retains state summary', () => {
  assert.equal(reconcileRegion(district, DEFAULT_OPTIONS, regions), state)
  assert.equal(reconcileRegion(state, { ...DEFAULT_OPTIONS, territory: 'districts' }, regions), state)
  assert.equal(reconcileRegion(district, { ...DEFAULT_OPTIONS, territory: 'districts' }, regions), district)
  assert.equal(reconcileRegion(null, DEFAULT_OPTIONS, regions), null)
  assert.equal(reconcileRegion(district, DEFAULT_OPTIONS, null), null)
})
