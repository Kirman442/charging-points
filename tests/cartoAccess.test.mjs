import test from 'node:test'
import assert from 'node:assert/strict'
import { cartoRequest } from '../src/map/carto-access.js'

test('Basemaps key covers styles, tilejson, sprites, glyphs and tile subdomains', () => {
  const resources = [
    'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    'https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json',
    'https://tiles.basemaps.cartocdn.com/gl/dark-matter-gl-style/sprite@2x.png',
    'https://tiles.basemaps.cartocdn.com/fonts/Open%20Sans/0-255.pbf',
    'https://tiles-d.basemaps.cartocdn.com/vectortiles/carto.streets/v1/5/16/10.mvt?other=1',
  ]
  for (const resource of resources) {
    const url = new URL(cartoRequest(resource, ' test-key ').url)
    assert.equal(url.searchParams.get('key'), 'test-key')
    assert.equal(url.pathname, new URL(resource).pathname)
    if (resource.includes('other=1')) assert.equal(url.searchParams.get('other'), '1')
  }
})
test('key never leaks to other services, same-origin data, HTTP, or lookalike hosts', () => {
  for (const url of [
    'https://kirman442.github.io/charging-points/data/file.parquet',
    'https://basemaps.cartocdn.com.example.org/tile',
    'https://evilbasemaps.cartocdn.com/tile',
    'https://carto.com/tile', 'http://basemaps.cartocdn.com/tile',
    'data:image/svg+xml,test', '/data/file.parquet', 'not a URL',
  ]) assert.deepEqual(cartoRequest(url, 'test-key'), {url})
})
test('missing key preserves current behavior and existing key is replaced once', () => {
  const url = 'https://basemaps.cartocdn.com/style.json?key=old'
  for (const key of [undefined, '', '  ']) assert.deepEqual(cartoRequest(url, key), {url})
  assert.deepEqual(new URL(cartoRequest(url,'new').url).searchParams.getAll('key'), ['new'])
})
