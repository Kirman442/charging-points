// Keep popup placement in the viewport, independent of panel scroll/clipping.
export function tooltipPosition(anchor, popup, viewport, margin = 12, gap = 6) {
  const width = Math.min(popup.width, Math.max(0, viewport.width - margin * 2))
  const height = Math.min(popup.height, Math.max(0, viewport.height - margin * 2))
  const clamp = (value, size, limit) => Math.max(margin, Math.min(value, limit - size - margin))
  const below = anchor.bottom + gap
  return {
    left: clamp(anchor.left, width, viewport.width),
    top: clamp(below + height <= viewport.height - margin ? below : anchor.top - height - gap, height, viewport.height),
  }
}
