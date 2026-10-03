import test from 'node:test'
import assert from 'node:assert/strict'
import { createLayers } from '../src/map/layers.js'
const feature = properties => ({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [] } })
const regions = {
  states: [feature({ state_name: 'A', state_code: '01', bev_count: 100, points_per_1000_bev: 20 }), feature({ state_name: 'B', state_code: '02', bev_count: 200, points_per_1000_bev: 40 })],
  districts: [feature({ state_code: '01', bev_count: 10 }), feature({ state_code: '02', bev_count: 30 })],
}
const options = { metric: 'bev', level: 'states', analysisLevel: 'districts', showSites: false }
test('hiding contours preserves analytical fill in both metrics', () => {
  for (const metric of ['bev', 'ratio']) {
    const { layers } = createLayers(null, regions, { ...options, metric, level: 'none' })
    assert.equal(layers.length, 1)
    assert.equal(layers[0].props.stroked, false)
    assert.equal(layers[0].props.filled, true)
  }
  assert.equal(createLayers(null, regions, { ...options, metric: 'sites', level: 'none' }).layers.length, 0)
})
test('contours and fill keep independent territory levels across all metrics', () => {
  for (const metric of ['sites', 'bev', 'ratio']) {
    for (const level of ['none', 'states', 'districts']) {
      const { layers } = createLayers(null, regions, { ...options, metric, level })
      const outline = layers.find(layer => layer.id.startsWith('boundaries-'))
      assert.equal(Boolean(outline), level !== 'none')
      if (outline) {
        assert.deepEqual(outline.props.data, regions[level])
        assert.equal(outline.id, `boundaries-${level}`)
        assert.deepEqual(outline.props.getFillColor, [0, 0, 0, 0])
      }
      const fill = layers.find(layer => layer.id.startsWith('analysis-'))
      assert.equal(Boolean(fill), metric !== 'sites')
      if (fill) assert.equal(fill.id, metric === 'ratio' ? 'analysis-states' : 'analysis-districts')
    }
  }
})
test('legend domain follows analytical territories and selected state, regardless of contours', () => {
  for (const level of ['none', 'states', 'districts']) {
    const result = createLayers(null, regions, { ...options, level, state: 'A' })
    assert.equal(result.maximum, 10)
    for (const layer of result.layers) assert.equal(layer.props.data.length, 1)
    assert.equal(createLayers(null, regions, { ...options, level, metric: 'ratio', state: 'A' }).maximum, 20)
  }
})
