import { GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers'
export function regionValue(feature, metric) {
  return metric === 'ratio' ? feature.properties.points_per_1000_bev : feature.properties.bev_count
}
export function createLayers(data, regions, options) {
  const layers = []
  const level = options.metric === 'ratio' ? 'states' : options.level
  const features = regions?.[level]?.filter(feature => !options.state || (level === 'states' ? feature.properties.state_name === options.state : feature.properties.state_code === regions.states.find(state => state.properties.state_name === options.state)?.properties.state_code)) || []
  const maximum = Math.max(1, ...features.map(feature => regionValue(feature, options.metric) || 0))
  if (options.level !== 'none' || options.metric !== 'sites') layers.push(new GeoJsonLayer({
    id: `regions-${level}`, data: features, pickable: true, stroked: true, filled: true,
    getLineColor: [180,205,199,180], getLineWidth: 1, lineWidthUnits: 'pixels',
    getFillColor: feature => {
      if (options.metric === 'sites') return [40,90,85,12]
      const value = regionValue(feature, options.metric)
      if (value === null || value === undefined) return [110,110,110,100]
      const t = value / maximum
      return [Math.round(45 + 190 * t), Math.round(150 - 50 * t), Math.round(175 - 110 * t), 155]
    },
    updateTriggers: { getFillColor: [maximum, options.metric] },
  }))
  if (data && options.showSites) layers.push(new ScatterplotLayer({
    id: 'charging-sites', data: { length: data.count, attributes: {
      getPosition: { value: data.positions, size: 2 }, getFillColor: { value: data.colors, size: 4 },
    } }, getRadius: 45, radiusMinPixels: 2, radiusMaxPixels: 12,
    opacity: .85, pickable: true, autoHighlight: true, highlightColor: [255,255,255,230],
  }))
  return { layers, maximum }
}
