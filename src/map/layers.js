import { autobahnSiteRadius } from '../data/autobahn.js'
import { GeoJsonLayer, ScatterplotLayer, TextLayer, IconLayer } from '@deck.gl/layers'
import { operatorConcentration } from '../data/concentration.js'
import { metricValue } from '../data/analytics.js'
import { normalizeOptions } from './settings.js'
import { FillStyleExtension } from '@deck.gl/extensions'
import { displayColors, paletteFor, rgba, sequentialColor, FIXED_DOMAINS } from './palette.js'
const hatchExtension = new FillStyleExtension({ proceduralPattern: true })
const hatchMapping = { missing: { type: 'hatch', strokeWidth: 1, gap: 7, angle: 45 } }
// Worker packets and region feature arrays are immutable snapshots. Weak keys let
// superseded filter results be collected while preserving deck.gl data identity.
const regionCache = new WeakMap()
const selectedCache = new WeakMap()
const presentationCache = new WeakMap()
const emptyFeatures = []
function regionFeatures(regions, level, state) {
  const source = regions?.[level]
  if (!source) return emptyFeatures
  if (!state) return source
  const stateCode = regions?.states?.find(f => f.properties.state_name === state)?.properties.state_code
  const key = JSON.stringify([level, state, stateCode])
  let cached = regionCache.get(source)
  if (!cached) regionCache.set(source, cached = new Map())
  if (!cached.has(key)) cached.set(key, source.filter(f => level === 'states'
    ? f.properties.state_name === state : f.properties.state_code === stateCode))
  return cached.get(key)
}
function presentation(data, options, clustered = false) {
  let cached = presentationCache.get(data)
  if (!cached) presentationCache.set(data, cached = new Map())
  const key = JSON.stringify([options.style, !!options.a9Mode, clustered])
  if (cached.has(key)) return cached.get(key)
  const colors = displayColors(data, options, clustered)
  const squares = !clustered && options.a9Mode && data.autobahnAccess
    ? Array.from(data.autobahnAccess, (flag, index) => flag ? {
      position: Array.from(data.positions.subarray(index * 2, index * 2 + 2)),
      color: Array.from(colors.subarray(index * 4, index * 4 + 4)),
      rowIndex: data.rowIndices[index], eligible: !!data.autobahnEligible?.[index],
    } : null).filter(Boolean) : []
  if (squares.length) data.autobahnAccess.forEach((flag, index) => { if (flag) colors[index * 4 + 3] = 0 })
  const binary = { length: data.count, attributes: {
    getPosition: { value: data.positions, size: 2 },
    getFillColor: { value: colors, size: 4 },
    ...(clustered ? { getRadius: { value: data.radii, size: 1 } } : {}),
  } }
  const result = { binary, squares, outlines: squares.filter(s => s.eligible),
    labels: { length: data.count, attributes: { getPosition: { value: data.positions, size: 2 } } } }
  cached.set(key, result)
  return result
}
export function regionValue(feature, metric, basis = 'points') { return metricValue(feature.properties, metric, basis) }
export function createLayers(data, regions, suppliedOptions, markers = null, clustered = false) {
  const options = normalizeOptions(suppliedOptions)
  const palette = paletteFor(options.style)
  const layers = []
  const useMarkers = options.showSites && clustered && markers
  const sitePresentation = data && options.showSites && !useMarkers ? presentation(data, options) : null
  const accessSquares = sitePresentation?.squares || emptyFeatures
  const level = options.territory
  const features = regionFeatures(regions, level, options.state)
  const maximum = options.metric === 'concentration' ? 100 : options.scaleMode === 'fixed' && FIXED_DOMAINS[options.metric] ? FIXED_DOMAINS[options.metric] : Math.max(1, ...features.map(feature => regionValue(feature, options.metric, options.operatorBasis) || 0))
  if (options.metric !== 'sites') layers.push(new GeoJsonLayer({
    id: `analysis-${level}`, data: features, pickable: true, stroked: false, filled: true,
    getFillColor: feature => {
      const value = regionValue(feature, options.metric, options.operatorBasis)
      if (value === null || value === undefined) return rgba(palette.missing, 200)
      if (options.metric === 'concentration') return rgba(palette.concentration[operatorConcentration(feature.properties.operators, options.operatorBasis)?.high ? 1 : 0], 220)
      return sequentialColor(value, maximum, options.style)
    },
    extensions: [hatchExtension], fillPatternMapping: hatchMapping, fillPatternSizeUnits: 'pixels',
    getFillPattern: feature => regionValue(feature, options.metric, options.operatorBasis) == null ? 'missing' : null,
    getFillPatternBackgroundColor: rgba(palette.casing, 150),
    updateTriggers: { getFillColor: [maximum, options.metric, options.operatorBasis, options.style], getFillPattern: [options.metric, options.operatorBasis] },
  }))
  if (options.showBoundaries) layers.push(new GeoJsonLayer({
    id: `boundaries-${level}`, data: features,
    // Keep region clicks in marker mode without adding a visible fill.
    pickable: !options.a9Mode, stroked: true, filled: !options.a9Mode && options.metric === 'sites',
    getFillColor: [0,0,0,0],
    getLineColor: palette.boundary, getLineWidth: 0.6, lineWidthUnits: 'pixels',
  }))
  if (options.selectedRegion && !options.a9Mode) {
    const selected = options.selectedRegion
    const feature = regions?.[selected.level]?.find(feature => (feature.properties.district_code || feature.properties.state_code) === (selected.district_code || selected.state_code))
    if (feature && !selectedCache.has(feature)) selectedCache.set(feature, [feature])
    if (feature) layers.push(new GeoJsonLayer({
      id: 'selected-territory', data: selectedCache.get(feature), pickable: false, filled: false, stroked: true,
      getLineColor: rgba(palette.territorySelected, 185), getLineWidth: 1.4, lineWidthUnits: 'pixels',
    }))
  }
  if (options.showSites && clustered && markers) {
    const { binary, labels } = presentation(markers, options, true)
    layers.push(new ScatterplotLayer({
      id: 'charging-markers', data: binary, radiusUnits: 'pixels',
      stroked: true, getLineColor: rgba(options.style === 'light' ? palette.missing : palette.casing), getLineWidth: 1.5, lineWidthUnits: 'pixels',
      opacity: 1, pickable: true, autoHighlight: false,
    }))
    layers.push(new TextLayer({
      id: 'cluster-labels', data: labels,
      getText: (_, { index }) => markers.siteCounts[index] > 1 ? String(markers.siteCounts[index]) : '',
      getSize: 13, getColor: rgba(palette.clusterText), fontWeight: 700, fontFamily: 'Arial, sans-serif',
      pickable: false, getTextAnchor: 'middle', getAlignmentBaseline: 'center',
      updateTriggers: { getText: markers.siteCounts },
    }))
  } else if (data && options.showSites && (!clustered || !markers)) layers.push(new ScatterplotLayer({
    id: 'charging-sites', data: sitePresentation.binary, getRadius: 45, radiusMinPixels: 4.5, radiusMaxPixels: 7,
    stroked: true, lineWidthUnits: 'pixels', getLineColor: rgba(palette.casing), getLineWidth: 1.3,
    ...(options.a9Mode ? { radiusUnits: 'pixels', getRadius: (_, { index }) => data.colors[index*4+3] > 200 ? Math.max(3, autobahnSiteRadius(options.autobahnZoom)) : 1.2, radiusMinPixels: 0.8, getLineColor: rgba(palette.outline), getLineWidth: (_, { index }) => data.autobahnEligible?.[index] && !data.autobahnAccess?.[index] ? Math.max(1, Math.min(1.8, autobahnSiteRadius(options.autobahnZoom) * 0.2)) : 0, updateTriggers: { getRadius: [data.colors, options.autobahnZoom], getLineWidth: [data.autobahnEligible, data.autobahnAccess, options.autobahnZoom] } } : {}),
    opacity: 1, pickable: true, autoHighlight: false,
  }))
  if (accessSquares.length) {
    const atlas = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect x="2" y="2" width="28" height="28" fill="white"/><rect x="34" y="2" width="28" height="28" fill="none" stroke="white" stroke-width="3"/></svg>')
    const iconMapping = { square: { x: 0, y: 0, width: 32, height: 32, mask: true }, outline: { x: 32, y: 0, width: 32, height: 32, mask: true } }
    const size = Math.max(3.5, autobahnSiteRadius(options.autobahnZoom)) * 2 * 32 / 28
    layers.push(new IconLayer({
      id: 'charging-access-sites', data: accessSquares, iconAtlas: atlas, iconMapping,
      getIcon: 'square', getPosition: s => s.position, getColor: s => s.color,
      getSize: size, sizeUnits: 'pixels', opacity: 1, pickable: true, autoHighlight: false,
    }))
    layers.push(new IconLayer({
      id: 'charging-access-outlines', data: sitePresentation.outlines, iconAtlas: atlas, iconMapping,
      getIcon: 'outline', getPosition: s => s.position, getColor: rgba(palette.outline),
      getSize: size, sizeUnits: 'pixels', pickable: false,
    }))
  }
  return { layers, maximum }
}
