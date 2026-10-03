import { WebMercatorViewport } from '@deck.gl/core'
import { transitionViewState } from './interaction.js'

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
  if (width > 760) return {
    left: controls ? controls.right - container.left + 18 : 24,
    right: analytics ? container.right - analytics.left + 18 : 24,
    top: 24, bottom: 48,
  }
  // On short/mobile screens the panels may leave too little vertical space.
  let top = controls ? controls.bottom - container.top + 12 : 24
  let bottom = analytics ? container.bottom - analytics.top + 12 : 48
  const scale = Math.min(1, height * .7 / (top + bottom))
  top *= scale; bottom *= scale
  return { left: 12, right: 12, top, bottom }
}

export function fitRegionViewState(feature, size, previous, padding) {
  const bounds = geometryBounds(feature?.geometry)
  if (!bounds || !size?.width || !size?.height) return previous
  const fitted = new WebMercatorViewport({ width: size.width, height: size.height })
    .fitBounds(bounds, { padding, maxZoom: 11 })
  return transitionViewState(previous, { longitude: fitted.longitude, latitude: fitted.latitude, zoom: fitted.zoom, pitch: 0, bearing: 0 })
}
