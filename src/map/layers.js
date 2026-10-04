import { GeoJsonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { operatorConcentration } from '../data/concentration.js'
import { metricValue } from '../data/analytics.js'
import { normalizeOptions } from './settings.js'
export function regionValue(feature, metric, basis = 'points') { return metricValue(feature.properties, metric, basis) }
export function createLayers(data, regions, suppliedOptions, markers = null, clustered = false) {
  const options = normalizeOptions(suppliedOptions)
  const layers = []
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
      getPosition: { value: data.positions, size: 2 }, getFillColor: { value: data.colors, size: 4 },
    } }, getRadius: 45, radiusMinPixels: 4, radiusMaxPixels: 12,
    opacity: .85, pickable: true, autoHighlight: true, highlightColor: [255,255,255,230],
  }))
  return { layers, maximum }
}
