import { useMemo } from 'react'
import DeckGL from '@deck.gl/react'
import Map from 'react-map-gl/maplibre'
import maplibre from '../map/maplibre.js'
import { createLayers, regionValue } from '../map/layers.js'
import { MAP_STYLES } from '../config/map.js'
import { format } from '../utils/format.js'
import 'maplibre-gl/dist/maplibre-gl.css'

export default function ChargingMap({ data, regions, options, viewState, onViewChange, onSite, onRegion, onMapError }) {
  const { layers } = useMemo(() => createLayers(data, regions, options), [data, regions, options])
  const isSite = info => info.layer?.id === 'charging-sites'
  return <DeckGL viewState={viewState} onViewStateChange={({ viewState: next }) => onViewChange(next)} controller layers={layers}
    onClick={info => {
      if (isSite(info) && info.index >= 0) onSite(data.rowIndices[info.index])
      else if (info.object?.properties) onRegion(info.object.properties)
    }}
    getTooltip={info => {
      if (isSite(info) && info.index >= 0) return { text: `${format(data.pointCounts[info.index])} зарядных точек\nДо ${format(data.powers[info.index])} kW` }
      if (info.object?.properties) {
        const p = info.object.properties
        return { text: `${p.state_name || p.display_name || p.district_name}\n${options.metric === 'ratio' ? 'Точек на 1 000 BEV' : 'BEV'}: ${format(regionValue(info.object, options.metric))}` }
      }
      return null
    }}>
    <Map mapLib={maplibre} mapStyle={MAP_STYLES[options.style]} onError={event => onMapError(event.error?.message || 'Ошибка подложки')} />
  </DeckGL>
}
