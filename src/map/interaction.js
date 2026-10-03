import { MapController } from '@deck.gl/core'

// Keep the double-click recognizer enabled; let the map component choose the
// target zoom instead of applying the controller's default zoom as well.
export class ChargingMapController extends MapController {
  handleEvent(event) {
    if (event.type === 'dblclick') return false
    return super.handleEvent(event)
  }
}
export function mapCursor({ isDragging, isHovering }) {
  return isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'
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
