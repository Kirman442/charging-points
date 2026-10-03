import test from 'node:test'
import assert from 'node:assert/strict'
import { createLayers } from '../src/map/layers.js'
const feature = properties => ({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [] } })
const regions = {
  states: [feature({ state_name: 'A', state_code: '01', bev_count: 100, points_per_1000_bev: 20 }), feature({ state_name: 'B', state_code: '02', bev_count: 200, points_per_1000_bev: 40 })],
  districts: [feature({ state_code: '01', bev_count: 10 }), feature({ state_code: '02', bev_count: 30 })],
}
const options = { metric: 'bev', territory: 'districts', showBoundaries: true, showSites: false }
test('hiding contours preserves analytical fill in both metrics', () => {
  for (const metric of ['bev', 'ratio']) {
    const { layers } = createLayers(null, regions, { ...options, metric, showBoundaries: false })
    assert.equal(layers.length, 1)
    assert.equal(layers[0].props.stroked, false)
    assert.equal(layers[0].props.filled, true)
  }
  assert.equal(createLayers(null, regions, { ...options, metric: 'sites', showBoundaries: false }).layers.length, 0)
})
test('contours and fill always share territories, with ratio locked to states', () => {
  for (const metric of ['sites', 'bev', 'ratio']) {
    for (const territory of ['states', 'districts']) {
      for (const showBoundaries of [false, true]) {
        const expected = metric === 'ratio' ? 'states' : territory
        const { layers } = createLayers(null, regions, { ...options, metric, territory, showBoundaries })
        const outline = layers.find(layer => layer.id.startsWith('boundaries-'))
        assert.equal(Boolean(outline), showBoundaries)
        if (outline) {
          assert.deepEqual(outline.props.data, regions[expected])
          assert.equal(outline.id, `boundaries-${expected}`)
          assert.deepEqual(outline.props.getFillColor, [0, 0, 0, 0])
        }
        const fill = layers.find(layer => layer.id.startsWith('analysis-'))
        assert.equal(Boolean(fill), metric !== 'sites')
        if (fill) assert.equal(fill.id, `analysis-${expected}`)
      }
    }
  }
})
test('legend domain follows analytical territories and selected state, regardless of contours', () => {
  for (const showBoundaries of [false, true]) {
    const result = createLayers(null, regions, { ...options, showBoundaries, state: 'A' })
    assert.equal(result.maximum, 10)
    for (const layer of result.layers) assert.equal(layer.props.data.length, 1)
    assert.equal(createLayers(null, regions, { ...options, showBoundaries, metric: 'ratio', state: 'A' }).maximum, 20)
  }
})
