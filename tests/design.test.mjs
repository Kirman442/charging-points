import test from 'node:test'
import assert from 'node:assert/strict'
import { nearbySites } from '../src/map/nearby.js'
import { displayColors, FIXED_DOMAINS, rgba, paletteFor } from '../src/map/palette.js'
import { createLayers } from '../src/map/layers.js'

test('nearby results retain original row identities, sort distance and exclude invisible motorway sites', () => {
  const data = { count: 4, positions: new Float32Array([10,50,10,50.1,10,50.2,10,50.3]), rowIndices: new Uint32Array([91,72,53,34]), powers: new Float32Array([22,50,150,300]), pointCounts: new Uint32Array([2,4,6,8]), colors: new Uint8Array([0,0,0,0,0,0,0,255,0,0,0,255,0,0,0,255]) }
  const rows = nearbySites(data, { longitude: 10, latitude: 50 }, 2)
  assert.deepEqual(rows.map(row => row.rowIndex), [72,53])
  assert.equal(rows[0].power, 50)
  assert.equal(rows[1].points, 6)
  assert.ok(rows[0].distance > 11 && rows[0].distance < 12)
  assert.ok(rows[0].distance < rows[1].distance)
  assert.deepEqual(nearbySites(data, { longitude: 10, latitude: 50 }, 0), [])
  assert.deepEqual(nearbySites(null, null), [])
})

test('both map themes keep cluster counts neutral and power band edges while preserving worker buffers', () => {
  const data = { count: 5, powers: new Float32Array([22,23,50,150,300]), siteCounts: new Uint32Array([1,1,1,1,12]), colors: new Uint8Array(20).fill(77) }
  for (const style of ['dark','light']) {
    const colors = displayColors(data, { style }, true), palette = paletteFor(style)
    for (const [index, band] of [[0,0],[1,1],[2,2],[3,3]]) assert.deepEqual(Array.from(colors.subarray(index*4,index*4+4)), rgba(palette.power[band]))
    assert.deepEqual(Array.from(colors.subarray(16,20)), rgba(palette.cluster))
  }
  assert.ok(data.colors.every(value => value === 77))
})

test('fixed analytical domains survive changing selections; a true zero is not missing data', () => {
  const feature = bev_count => ({ type: 'Feature', geometry: { type:'Polygon', coordinates:[] }, properties: { bev_count } })
  const options = { metric:'bev', territory:'states', showSites:false, showBoundaries:false, style:'dark', scaleMode:'fixed' }
  const zero = feature(0), missing = feature(null)
  const first = createLayers(null, { states:[feature(100),zero,missing] }, options)
  const second = createLayers(null, { states:[feature(100000)] }, options)
  assert.equal(first.maximum, FIXED_DOMAINS.bev)
  assert.equal(first.maximum, second.maximum)
  assert.equal(first.layers[0].props.getFillPattern(zero), null)
  assert.equal(first.layers[0].props.getFillPattern(missing), 'missing')
  assert.equal(createLayers(null,{states:[feature(100)]},{...options,scaleMode:'selection'}).maximum,100)
})
