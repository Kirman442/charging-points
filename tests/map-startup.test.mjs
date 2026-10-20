import test from 'node:test'
import assert from 'node:assert/strict'
import { WebMercatorViewport } from '@deck.gl/core'
import { ChargingMapController } from '../src/map/interaction.js'
import { observeMapSize } from '../src/map/size.js'

const event = (type, x = 400, y = 300) => ({ type, offsetCenter: { x, y }, delta: 80,
  srcEvent: { preventDefault() {} }, stopPropagation() {} })

test('a controller with temporary canvas bounds rejects input; measured bounds accept wheel and drag without data', () => {
  const updates = []
  const controller = new ChargingMapController({ onViewStateChange: value => updates.push(value.viewState),
    makeViewport: props => new WebMercatorViewport(props) })
  const view = { id: 'map', longitude: 10, latitude: 51, zoom: 5, x: 0, y: 0, width: 1, height: 1 }
  controller.setProps(view)
  const initialUpdates = updates.length
  assert.equal(controller.handleEvent(event('wheel')), false)
  assert.equal(controller.handleEvent(event('panstart')), false)
  assert.equal(updates.length, initialUpdates)
  const element = { clientWidth: 1200, clientHeight: 800 }
  class Observer { observe() {} disconnect() {} }
  const stop = observeMapSize(element, size => controller.setProps({ ...view, ...size }), Observer)
  assert.equal(controller.handleEvent(event('wheel')), true)
  assert.ok(updates.at(-1).zoom > view.zoom)
  controller.setProps({ ...view, width: 1200, height: 800 })
  assert.equal(controller.handleEvent(event('panstart')), true)
  assert.equal(controller.handleEvent(event('panmove', 480, 350)), true)
  assert.notEqual(updates.at(-1).longitude, view.longitude)
  assert.notEqual(updates.at(-1).latitude, view.latitude)
  stop(); controller.finalize()
})

test('layout observation starts without a data update, follows resizes and ignores hidden or unchanged sizes', () => {
  const element = { clientWidth: 0, clientHeight: 0 }, sizes = []
  let notify, observed, disconnected = false
  class Observer {
    constructor(callback) { notify = callback }
    observe(value) { observed = value }
    disconnect() { disconnected = true }
  }
  const stop = observeMapSize(element, value => sizes.push(value), Observer)
  assert.equal(observed, element)
  assert.deepEqual(sizes, [])
  element.clientWidth = 1200; element.clientHeight = 800; notify()
  assert.deepEqual(sizes, [{ width: 1200, height: 800 }])
  notify(); assert.equal(sizes.length, 1)
  element.clientWidth = 0; notify(); assert.equal(sizes.length, 1)
  element.clientWidth = 600; element.clientHeight = 900; notify()
  assert.deepEqual(sizes.at(-1), { width: 600, height: 900 })
  stop(); assert.equal(disconnected, true)
})

test('basemap mounts with no data and before Deck has a measured viewport; camera props stay synchronized', async () => {
  const { readFileSync } = await import('node:fs')
  const { createRequire } = await import('node:module')
  const { pathToFileURL } = await import('node:url')
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { transformWithOxc } = await import('vite')
  const { I18nContext } = await import('../src/i18n/context.js')
  const require = createRequire(import.meta.url)
  const reactUrl = pathToFileURL(require.resolve('react')).href
  const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
  const mapStub = moduleUrl(`import {createElement} from '${reactUrl}'; export const mounts=[]; export default props => { mounts.push(props); return createElement('div', {'data-basemap': true, 'data-longitude': props.longitude, 'data-zoom': props.zoom, 'data-interactive': String(props.interactive)}) }`)
  const deckStub = moduleUrl(`export default () => { throw Error('Deck must wait for measured dimensions') }`)
  let source = "import React from 'react'\n" + readFileSync(new URL('../src/components/ChargingMap.jsx', import.meta.url), 'utf8')
  source = source.replace(/^import ['"][^'"]+\.css['"];?\s*$/gm, '')
  source = source.replace(/from ['"]([^'"]+)['"]/g, (_, specifier) => {
    const url = specifier === 'react-map-gl/maplibre' ? mapStub : specifier === '@deck.gl/react' ? deckStub
      : specifier === '../map/maplibre.js' ? moduleUrl('export default {}')
      : specifier.startsWith('.') ? new URL('../src/components/' + specifier, import.meta.url).href
      : import.meta.resolve(specifier)
    return `from '${url}'`
  })
  const { code } = await transformWithOxc(source, 'ChargingMap.jsx', { jsx: { runtime: 'classic' } })
  const ChargingMap = (await import(moduleUrl(code))).default
  const render = viewState => renderToStaticMarkup(createElement(I18nContext.Provider,
    { value: { language: 'de', t: text => text } }, createElement(ChargingMap,
      { data: null, regions: null, markers: null, autobahn: null, options: { style: 'dark', metric: 'sites' }, viewState })))
  const before = render({ longitude: 10, latitude: 51, zoom: 5 })
  assert.match(before, /data-basemap="true"/)
  assert.match(before, /data-zoom="5"/)
  assert.match(before, /data-interactive="false"/)
  const moved = render({ longitude: 11, latitude: 51, zoom: 6 })
  assert.match(moved, /data-longitude="11"/)
  assert.match(moved, /data-zoom="6"/)
  const { mounts } = await import(mapStub)
  for (const props of mounts) {
    assert.equal(typeof props.onLoad, 'function')
    assert.equal(typeof props.onStyleData, 'function')
    assert.equal(typeof props.onIdle, 'function')
    const layer = { id: 'city', layout: { 'text-field': '{name_en}' } }
    let writes = 0
    const map = { isStyleLoaded: () => true, getStyle: () => ({ layers: [layer] }),
      setLayoutProperty: (id, key, value) => { assert.equal(id, 'city'); layer.layout[key] = value; writes++ } }
    props.onLoad({ target: map })
    props.onStyleData({ target: map })
    props.onIdle({ target: map })
    assert.equal(writes, 1)
    layer.layout['text-field'] = '{name}'
    props.onStyleData({ target: map })
    props.onIdle({ target: map })
    assert.equal(writes, 2)
  }
})
