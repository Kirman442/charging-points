export const CLUSTER_MAX_ZOOM = 12
export const clusterZoom = zoom => Math.max(0, Math.floor(zoom))

// Reuse the last view for this selection while the next zoom packet is pending.
// A different filter revision must never reuse those markers.
export function markersForView(packet, selection, zoom) {
  return packet && selection && packet.requestId === selection.requestId && zoom < CLUSTER_MAX_ZOOM
    ? packet.markers : null
}
export function useClusters(options, zoom) {
  return options.clusterSites && zoom < CLUSTER_MAX_ZOOM
}
