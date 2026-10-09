// Use DOM pointer coordinates, independent of Deck's widget canvas offsets.
export function tooltipPlacement(pointer, viewport) {
  const left = pointer.x > (viewport.right ?? viewport.width) - 324
  const above = pointer.y > viewport.height - 180
  return {
    position: 'fixed',
    left: `${pointer.x + (left ? -12 : 12)}px`,
    top: `${pointer.y + (above ? -12 : 12)}px`,
    transform: `translate(${left ? '-100%' : '0'}, ${above ? '-100%' : '0'})`,
    zIndex: '5',
  }
}
