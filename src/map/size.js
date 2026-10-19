// Mount Deck only after layout has a real size, independently of data arrival.
// Keep the last usable size while a container is temporarily hidden.
export function observeMapSize(element, onSize, Observer = ResizeObserver) {
  let width = 0, height = 0
  const measure = () => {
    const nextWidth = element.clientWidth, nextHeight = element.clientHeight
    if (nextWidth <= 0 || nextHeight <= 0 || (nextWidth === width && nextHeight === height)) return
    width = nextWidth; height = nextHeight
    onSize({ width, height })
  }
  const observer = new Observer(measure)
  observer.observe(element)
  measure()
  return () => observer.disconnect()
}
