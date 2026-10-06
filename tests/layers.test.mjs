import test from 'node:test'
import assert from 'node:assert/strict'
import { createLayers } from '../src/map/layers.js'
const feature = properties => ({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [] } })
const regions = {
  states: [feature({ state_name: 'A', state_code: '01', bev_count: 100, points_per_1000_bev: 20 }), feature({ state_name: 'B', state_code: '02', bev_count: 200, points_per_1000_bev: 40 })],
  districts: [feature({ state_code: '01', bev_count: 10, points_per_1000_bev: 15, kw_per_1000_bev: 500 }), feature({ state_code: '02', bev_count: 30, points_per_1000_bev: 25, kw_per_1000_bev: 800 })],
}
const options = { metric: 'bev', territory: 'districts', showBoundaries: true, showSites: false }
test('hiding contours preserves analytical fill in both metrics', () => {
  for (const metric of ['bev', 'ratio', 'power']) {
    const { layers } = createLayers(null, regions, { ...options, metric, showBoundaries: false })
    assert.equal(layers.length, 1)
    assert.equal(layers[0].props.stroked, false)
    assert.equal(layers[0].props.filled, true)
  }
  assert.equal(createLayers(null, regions, { ...options, metric: 'sites', showBoundaries: false }).layers.length, 0)
})
test('contours and fill always share territories, for every metric', () => {
  for (const metric of ['sites', 'bev', 'ratio', 'power']) {
    for (const territory of ['states', 'districts']) {
      for (const showBoundaries of [false, true]) {
        const expected = territory
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
    assert.equal(createLayers(null, regions, { ...options, showBoundaries, metric: 'ratio', state: 'A' }).maximum, 15)
    assert.equal(createLayers(null, regions, { ...options, metric: 'power', state: 'A' }).maximum, 500)
  }
})

test('Autobahn outlines identify interval sites and radius accessors follow zoom', () => {
  const data={count:2,positions:new Float64Array(4),colors:new Uint8Array([68,190,170,255,68,190,170,255]),autobahnEligible:new Uint8Array([1,0])}
  const layerAt = zoom => createLayers(data,null,{metric:'sites',showSites:true,a9Mode:true,autobahnZoom:zoom}).layers[0]
  const far=layerAt(6), near=layerAt(14)
  assert.equal(far.props.radiusUnits,'pixels')
  assert.ok(far.props.getRadius(null,{index:0}) < near.props.getRadius(null,{index:0}))
  assert.equal(near.props.getLineWidth(null,{index:1}),0)
  assert.ok(near.props.getLineWidth(null,{index:0}) > 0)
})
