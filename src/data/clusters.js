import Supercluster from 'supercluster'
import { powerColor } from './prepareSites.js'

import { CLUSTER_MAX_ZOOM, clusterZoom } from '../config/clustering.js'

export function buildClusters(sites) {
  const points = Array.from({ length: sites.count }, (_, i) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [sites.positions[i * 2], sites.positions[i * 2 + 1]] },
    properties: { rowIndex: sites.rowIndices[i], chargingPoints: sites.pointCounts[i], maxPower: sites.powers[i] },
  }))
  return new Supercluster({
    radius: 48, maxZoom: CLUSTER_MAX_ZOOM - 1,
    map: properties => ({ chargingPoints: properties.chargingPoints, maxPower: properties.maxPower }),
    reduce: (sum, properties) => {
      sum.chargingPoints += properties.chargingPoints
      sum.maxPower = Math.max(sum.maxPower, properties.maxPower)
    },
  }).load(points)
}

export function clusterMarkers(index, zoom) {
  zoom = clusterZoom(zoom)
  if (zoom >= CLUSTER_MAX_ZOOM) return null
  const features = index.getClusters([-180, -85, 180, 85], zoom)
  const count = features.length
  const positions = new Float64Array(count * 2), colors = new Uint8Array(count * 4)
  const powers = new Float32Array(count), pointCounts = new Uint32Array(count), rowIndices = new Uint32Array(count)
  const siteCounts = new Uint32Array(count), clusterIds = new Uint32Array(count), expansionZooms = new Uint8Array(count)
  const radii = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const { geometry, properties: p } = features[i]
    positions.set(geometry.coordinates, i * 2)
    powers[i] = p.maxPower; pointCounts[i] = p.chargingPoints
    colors.set(powerColor(p.maxPower), i * 4)
    siteCounts[i] = p.cluster ? p.point_count : 1
    radii[i] = p.cluster ? Math.min(20, 12 + Math.log2(p.point_count) * 0.7) : 4.5
    if (p.cluster) {
      clusterIds[i] = p.cluster_id
      expansionZooms[i] = Math.min(CLUSTER_MAX_ZOOM, index.getClusterExpansionZoom(p.cluster_id))
    } else rowIndices[i] = p.rowIndex
  }
  return { count, zoom, positions, colors, powers, pointCounts, rowIndices, siteCounts, clusterIds, expansionZooms, radii }
}

export function markerTransfers(markers) {
  return markers ? Object.values(markers).filter(value => ArrayBuffer.isView(value)).map(value => value.buffer) : []
}
