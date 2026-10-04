import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { tableFromIPC } from 'apache-arrow'
import { WebMercatorViewport } from '@deck.gl/core'
import { decodeRegions } from '../src/data/regions.js'
import { geometryBounds, fitRegionViewState, mapPadding, returnRegionFeature } from '../src/map/navigation.js'
import { GERMANY } from '../src/config/map.js'
const { readParquet } = createRequire(import.meta.url)('parquet-wasm/node')
const table = tableFromIPC(readParquet(new Uint8Array(fs.readFileSync(new URL('../public/data/states_bev_display_100m_string.parquet', import.meta.url)))).intoIPCStream())
const states = decodeRegions(table, 'states')
test('every state fits the unobscured desktop map at different screen sizes', () => {
  for (const [width,height] of [[1920,1080],[1280,800],[1000,700]]) {
    const left = width > 1100 ? 290 : 250, right = width > 1100 ? 340 : 285, gap = width > 1100 ? 16 : 10
    const rect = { width,height,left:0,top:0,right:width,bottom:height }
    const padding = mapPadding(rect, {right:left+gap}, {left:width-right-gap})
    for (const feature of states) {
      const target = fitRegionViewState(feature, rect, GERMANY, padding)
      const viewport = new WebMercatorViewport({width,height,...target})
      const bounds = geometryBounds(feature.geometry)
      for (const coordinate of [bounds[0],bounds[1],[bounds[0][0],bounds[1][1]],[bounds[1][0],bounds[0][1]]]) {
        const [x,y] = viewport.project(coordinate)
        assert.ok(x >= padding.left - .01 && x <= width-padding.right+.01, feature.properties.state_name)
        assert.ok(y >= padding.top - .01 && y <= height-padding.bottom+.01, feature.properties.state_name)
      }
    }
  }
})
test('multipart bounds include every component and are cached; missing geometry keeps view', () => {
  const geometry={type:'MultiPolygon',coordinates:[[[[7,50],[8,51],[7,50]]],[[[10,53],[11,54],[10,53]]]]}
  assert.deepEqual(geometryBounds(geometry),[[7,50],[11,54]])
  assert.equal(geometryBounds(geometry),geometryBounds(geometry))
  assert.equal(fitRegionViewState(null,{width:800,height:600},GERMANY,{}),GERMANY)
})
test('mobile padding always leaves a usable vertical map area', () => {
  const p=mapPadding({width:400,height:600,left:0,right:400,top:0,bottom:600},{bottom:300},{top:250})
  assert.ok(p.top+p.bottom <= 420+.01)
})

test('return navigation focuses the retained district or state only with a manual state filter', () => {
  const state = { properties: { state_name: 'Bayern', state_code: '09' } }
  const district = { properties: { level: 'districts', district_code: '09373', state_code: '09' } }
  const other = { properties: { level: 'districts', district_code: '05111', state_code: '05' } }
  const regions = { states: [state], districts: [district, other] }
  assert.equal(returnRegionFeature(regions, '', district.properties), null)
  assert.equal(returnRegionFeature(regions, 'Bayern', district.properties), district)
  assert.equal(returnRegionFeature(regions, 'Bayern', null), state)
  assert.equal(returnRegionFeature(regions, 'Bayern', state.properties), state)
  assert.equal(returnRegionFeature(regions, 'Bayern', other.properties), state)
  assert.equal(returnRegionFeature(null, 'Bayern', district.properties), null)
})
