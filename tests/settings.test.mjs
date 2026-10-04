import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_OPTIONS, normalizeOptions, territoryForSelection, resetOptions, reconcileRegion } from '../src/map/settings.js'

const state = { level: 'states', state_code: '05', state_name: 'Nordrhein-Westfalen' }
const district = { level: 'districts', state_code: '05', district_code: '05111' }
const regions = { states: [{ properties: state }] }

test('analytical metrics default to districts for a selected state and states nationally', () => {
  for (const metric of ['bev', 'ratio', 'power']) {
    const options = { ...DEFAULT_OPTIONS, metric, showBoundaries: false, showSites: false }
    const selected = territoryForSelection(options, 'Hessen')
    assert.equal(selected.territory, 'districts')
    assert.equal(selected.showBoundaries, false)
    assert.equal(selected.showSites, false)
    assert.equal(territoryForSelection(selected, '').territory, 'states')
    assert.equal(normalizeOptions({ ...selected, territory: 'states' }).territory, 'states')
    assert.equal(normalizeOptions({ ...selected, territory: 'districts' }).territory, 'districts')
  }
  assert.equal(territoryForSelection({ ...DEFAULT_OPTIONS, territory: 'districts' }, '').territory, 'districts')
})
test('reset restores every map setting except the chosen basemap', () => {
  const changed = { metric: 'bev', territory: 'districts', showBoundaries: false, showSites: false, clusterSites: false, style: 'light' }
  assert.deepEqual(resetOptions(changed), { ...DEFAULT_OPTIONS, style: 'light' })
})
test('district selection becomes its parent state; switching to districts retains state summary', () => {
  assert.equal(reconcileRegion(district, DEFAULT_OPTIONS, regions), state)
  assert.equal(reconcileRegion(state, { ...DEFAULT_OPTIONS, territory: 'districts' }, regions), state)
  assert.equal(reconcileRegion(district, { ...DEFAULT_OPTIONS, territory: 'districts' }, regions), district)
  assert.equal(reconcileRegion(null, DEFAULT_OPTIONS, regions), null)
  assert.equal(reconcileRegion(district, DEFAULT_OPTIONS, null), null)
})
