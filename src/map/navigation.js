import { WebMercatorViewport } from '@deck.gl/core'
import { transitionViewState } from './interaction.js'
import { isMobileWidth } from '../config/layout.js'

const boundsCache = new WeakMap()
export function geometryBounds(geometry) {
  if (!geometry) return null
  if (boundsCache.has(geometry)) return boundsCache.get(geometry)
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity
  const visit = coordinates => {
    if (typeof coordinates[0] === 'number') {
      const [lon, lat] = coordinates
      west = Math.min(west, lon); east = Math.max(east, lon)
      south = Math.min(south, lat); north = Math.max(north, lat)
    } else for (const child of coordinates) visit(child)
  }
  visit(geometry.coordinates)
  const bounds = Number.isFinite(west) ? [[west,south],[east,north]] : null
  boundsCache.set(geometry, bounds)
  return bounds
}

export function mapPadding(container, controls, analytics) {
  const { width, height } = container
  if (!isMobileWidth(width)) return safePadding(container, {
    left: controls ? controls.right - container.left + 18 : 24,
    right: analytics ? container.right - analytics.left + 18 : 24,
    top: 156, bottom: 48,
  })
  // On short/mobile screens the panels may leave too little vertical space.
  let top = controls ? controls.bottom - container.top + 12 : 180
  let bottom = analytics ? container.bottom - analytics.top + 12 : 48
  const scale = Math.min(1, height * .7 / (top + bottom))
  top *= scale; bottom *= scale
  return safePadding(container, { left: 12, right: 12, top, bottom })
}

// Panels can overlap or cover almost the whole map on small viewports.
// Retain their proportions while reserving at least 30% of each axis for fitting.
export function safePadding(size, padding = {}) {
  const result = Object.fromEntries(['left', 'right', 'top', 'bottom'].map(key => [key, Number.isFinite(padding[key]) ? Math.max(0, padding[key]) : 0]))
  for (const [first, second, dimension] of [['left', 'right', 'width'], ['top', 'bottom', 'height']]) {
    const total = result[first] + result[second]
    const scale = total ? Math.min(1, Math.max(0, size[dimension]) * .7 / total) : 1
    result[first] *= scale; result[second] *= scale
  }
  return result
}

export function fitRegionViewState(feature, size, previous, padding, maxZoom = 11) {
  const bounds = geometryBounds(feature?.geometry)
  if (!bounds || !Number.isFinite(size?.width) || !Number.isFinite(size?.height) || size.width <= 0 || size.height <= 0) return previous
  const fitted = new WebMercatorViewport({ width: size.width, height: size.height })
    .fitBounds(bounds, { padding: safePadding(size, padding), maxZoom })
  return transitionViewState(previous, { longitude: fitted.longitude, latitude: fitted.latitude, zoom: fitted.zoom, pitch: 0, bearing: 0 })
}

// Return navigation is opt-in only for a manually selected state.
export function returnRegionFeature(regions, selectedState, region) {
  if (!selectedState) return null
  const state = regions?.states?.find(feature => feature.properties.state_name === selectedState)
  if (region?.level === 'districts') {
    const district = regions?.districts?.find(feature => feature.properties.district_code === region.district_code && feature.properties.state_code === state?.properties.state_code)
    if (district) return district
  }
  return state || null
}
