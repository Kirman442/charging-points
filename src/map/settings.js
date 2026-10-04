export const DEFAULT_OPTIONS = {
  metric: 'sites', territory: 'states', showBoundaries: true, showSites: true, clusterSites: true, style: 'dark',
}

export function normalizeOptions(options) { return { ...options } }

// Automatic defaults on state selection or metric change; manual territory changes remain available.
export function territoryForSelection(options, state) {
  return ['bev', 'ratio', 'power'].includes(options.metric)
    ? { ...options, territory: state ? 'districts' : 'states' } : { ...options }
}

export function resetOptions(options) {
  return { ...DEFAULT_OPTIONS, style: options.style }
}

// A selected district becomes its parent state when switching to state analysis.
// A state remains a useful summary until the user chooses a specific district.
export function reconcileRegion(region, options, regions) {
  if (region?.level !== 'districts' || options.territory !== 'states') return region
  return regions?.states?.find(feature => feature.properties.state_code === region.state_code)?.properties || null
}
