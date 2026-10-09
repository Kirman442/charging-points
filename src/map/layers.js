import { autobahnSiteRadius } from '../data/autobahn.js'
import { GeoJsonLayer, ScatterplotLayer, TextLayer, IconLayer } from '@deck.gl/layers'
import { operatorConcentration } from '../data/concentration.js'
import { metricValue } from '../data/analytics.js'
import { normalizeOptions } from './settings.js'
export function regionValue(feature, metric, basis = 'points') { return metricValue(feature.properties, metric, basis) }
export function createLayers(data, regions, suppliedOptions, markers = null, clustered = false) {
  const options = normalizeOptions(suppliedOptions)
  const layers = []
  const accessSquares = options.a9Mode && data?.autobahnAccess ? Array.from(data.autobahnAccess, (flag, index) => flag ? {
    position: Array.from(data.positions.subarray(index * 2, index * 2 + 2)),
    color: Array.from(data.colors.subarray(index * 4, index * 4 + 4)),
    rowIndex: data.rowIndices[index], eligible: !!data.autobahnEligible?.[index],
  } : null).filter(Boolean) : []
  const circleColors = accessSquares.length ? data.colors.slice() : data?.colors
  if (accessSquares.length) data.autobahnAccess.forEach((flag, index) => { if (flag) circleColors[index * 4 + 3] = 0 })
  const level = options.territory
  const featuresFor = level => regions?.[level]?.filter(feature => !options.state || (
    level === 'states'
      ? feature.properties.state_name === options.state
      : feature.properties.state_code === regions?.states?.find(state => state.properties.state_name === options.state)?.properties.state_code
  )) || []
  const features = featuresFor(level)
  const maximum = options.metric === 'concentration' ? 100 : Math.max(1, ...features.map(feature => regionValue(feature, options.metric, options.operatorBasis) || 0))
  if (options.metric !== 'sites') layers.push(new GeoJsonLayer({
    id: `analysis-${level}`, data: features, pickable: true, stroked: false, filled: true,
    getFillColor: feature => {
      const value = regionValue(feature, options.metric, options.operatorBasis)
      if (value === null || value === undefined) return [110,110,110,100]
      if (options.metric === 'concentration') return operatorConcentration(feature.properties.operators, options.operatorBasis)?.high ? [205,90,65,160] : [65,155,140,145]
      const t = value / maximum
      return [Math.round(45 + 190 * t), Math.round(150 - 50 * t), Math.round(175 - 110 * t), 155]
    },
    updateTriggers: { getFillColor: [maximum, options.metric, options.operatorBasis] },
  }))
  if (options.showBoundaries) layers.push(new GeoJsonLayer({
    id: `boundaries-${level}`, data: featuresFor(level),
    // Keep region clicks in marker mode without adding a visible fill.
    pickable: true, stroked: true, filled: options.metric === 'sites',
    getFillColor: [0,0,0,0],
    getLineColor: [180,205,199,180], getLineWidth: 1, lineWidthUnits: 'pixels',
  }))
  if (options.showBoundaries && options.selectedRegion) {
    const selected = options.selectedRegion
    const feature = regions?.[selected.level]?.find(feature => (feature.properties.district_code || feature.properties.state_code) === (selected.district_code || selected.state_code))
    if (feature) layers.push(new GeoJsonLayer({
      id: 'selected-territory', data: [feature], pickable: false, filled: false, stroked: true,
      getLineColor: [180,205,199,180], getLineWidth: 3, lineWidthUnits: 'pixels',
    }))
  }
  if (options.showSites && clustered && markers) {
    const binary = { length: markers.count, attributes: {
      getPosition: { value: markers.positions, size: 2 },
      getFillColor: { value: markers.colors, size: 4 },
      getRadius: { value: markers.radii, size: 1 },
    } }
    layers.push(new ScatterplotLayer({
      id: 'charging-markers', data: binary, radiusUnits: 'pixels',
      stroked: true, getLineColor: [255,255,255,210], getLineWidth: 1, lineWidthUnits: 'pixels',
      opacity: .95, pickable: true, autoHighlight: true, highlightColor: [255,255,255,230],
    }))
    layers.push(new TextLayer({
      id: 'cluster-labels', data: { length: markers.count, attributes: { getPosition: { value: markers.positions, size: 2 } } },
      getText: (_, { index }) => markers.siteCounts[index] > 1 ? String(markers.siteCounts[index]) : '',
      getSize: 11, getColor: [20,35,40,255], fontWeight: 700, fontFamily: 'Arial, sans-serif',
      pickable: false, getTextAnchor: 'middle', getAlignmentBaseline: 'center',
      updateTriggers: { getText: markers.siteCounts },
    }))
  } else if (data && options.showSites && (!clustered || !markers)) layers.push(new ScatterplotLayer({
    id: 'charging-sites', data: { length: data.count, attributes: {
      getPosition: { value: data.positions, size: 2 }, getFillColor: { value: circleColors, size: 4 },
    } }, getRadius: 45, radiusMinPixels: 4, radiusMaxPixels: 12,
    ...(options.a9Mode ? { radiusUnits: 'pixels', getRadius: (_, { index }) => autobahnSiteRadius(options.autobahnZoom, data.colors[index*4+3] > 200), radiusMinPixels: 0.8, stroked: true, lineWidthUnits: 'pixels', getLineColor: [235,255,248,255], getLineWidth: (_, { index }) => data.autobahnEligible?.[index] && !data.autobahnAccess?.[index] ? Math.max(0.5, Math.min(1.5, autobahnSiteRadius(options.autobahnZoom) * 0.2)) : 0, updateTriggers: { getRadius: [data.colors, options.autobahnZoom], getLineWidth: [data.autobahnEligible, data.autobahnAccess, options.autobahnZoom] } } : {}),
    opacity: .85, pickable: true, autoHighlight: true, highlightColor: [255,255,255,230],
  }))
  if (accessSquares.length) {
    const atlas = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect x="2" y="2" width="28" height="28" fill="white"/><rect x="34" y="2" width="28" height="28" fill="none" stroke="white" stroke-width="3"/></svg>')
    const iconMapping = { square: { x: 0, y: 0, width: 32, height: 32, mask: true }, outline: { x: 32, y: 0, width: 32, height: 32, mask: true } }
    const size = autobahnSiteRadius(options.autobahnZoom) * 2 * 32 / 28
    layers.push(new IconLayer({
      id: 'charging-access-sites', data: accessSquares, iconAtlas: atlas, iconMapping,
      getIcon: 'square', getPosition: s => s.position, getColor: s => s.color,
      getSize: size, sizeUnits: 'pixels', opacity: .85, pickable: true,
      autoHighlight: true, highlightColor: [255,255,255,230],
    }))
    layers.push(new IconLayer({
      id: 'charging-access-outlines', data: accessSquares.filter(s => s.eligible), iconAtlas: atlas, iconMapping,
      getIcon: 'outline', getPosition: s => s.position, getColor: [235,255,248,255],
      getSize: size, sizeUnits: 'pixels', pickable: false,
    }))
  }
  return { layers, maximum }
}
