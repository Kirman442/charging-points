export const CLUSTER_MAX_ZOOM = 12
export const clusterZoom = zoom => Math.max(0, Math.floor(zoom))

export function markersForView(packet, selection, zoom) {
  return packet && selection && packet.requestId === selection.requestId && packet.zoom === clusterZoom(zoom)
    ? packet.markers : null
}
