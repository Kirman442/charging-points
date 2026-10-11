import { IconLayer, ScatterplotLayer } from '@deck.gl/layers'

export function siteOutlineLayer({ id, position, radius, color, width, square = false }) {
  const common = { id: `${id}-${square ? 'square' : 'circle'}`, data: [{ position }], getPosition: d => d.position, pickable: false }
  if (!square) return new ScatterplotLayer({ ...common,
    radiusUnits: 'pixels', getRadius: radius, stroked: true, filled: false,
    getLineColor: color, getLineWidth: width, lineWidthUnits: 'pixels',
  })
  const size = radius * 2 + width, stroke = width * 32 / size
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect x="${stroke / 2}" y="${stroke / 2}" width="${32 - stroke}" height="${32 - stroke}" fill="none" stroke="white" stroke-width="${stroke}"/></svg>`
  return new IconLayer({ ...common,
    iconAtlas: 'data:image/svg+xml,' + encodeURIComponent(svg),
    iconMapping: { outline: { x: 0, y: 0, width: 32, height: 32, mask: true } },
    getIcon: 'outline', getColor: color, getSize: size, sizeUnits: 'pixels',
  })
}
