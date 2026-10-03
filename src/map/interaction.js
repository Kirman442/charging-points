import { LinearInterpolator, MapController, TRANSITION_EVENTS } from '@deck.gl/core'

// Keep the double-click recognizer enabled; let the map component choose the
// target zoom instead of applying the controller's default zoom as well.
export class ChargingMapController extends MapController {
  handleEvent(event) {
    if (event.type === 'dblclick') return false
    return super.handleEvent(event)
  }
}
export function mapCursor({ isDragging, isHovering, markerHovered }) {
  return isDragging ? 'grabbing' : isHovering && markerHovered ? 'pointer' : 'grab'
}

const zoomInterpolator = new LinearInterpolator(['longitude', 'latitude', 'zoom'])
export function zoomViewState(viewState, cluster, coordinate) {
  return { ...viewState,
    longitude: cluster?.longitude ?? coordinate?.[0] ?? viewState.longitude,
    latitude: cluster?.latitude ?? coordinate?.[1] ?? viewState.latitude,
    zoom: Math.min(20, cluster ? Math.max(viewState.zoom + 1, cluster.expansionZoom) : viewState.zoom + 1),
    transitionDuration: 280, transitionInterpolator: zoomInterpolator,
    transitionEasing: t => t * t * (3 - 2 * t),
    transitionInterruption: TRANSITION_EVENTS.BREAK,
  }
}
export function markerSelection(markers, index) {
  if (!markers || index < 0 || index >= markers.count) return null
  if (markers.siteCounts[index] <= 1) return { type: 'site', rowIndex: markers.rowIndices[index] }
  return {
    type: 'cluster', id: markers.clusterIds[index], sites: markers.siteCounts[index],
    points: markers.pointCounts[index], maxPower: markers.powers[index],
    longitude: markers.positions[index * 2], latitude: markers.positions[index * 2 + 1],
    expansionZoom: markers.expansionZooms[index],
  }
}
