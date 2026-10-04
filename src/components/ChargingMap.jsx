import { useMemo, useRef } from 'react'
import DeckGL from '@deck.gl/react'
import Map from 'react-map-gl/maplibre'
import maplibre from '../map/maplibre.js'
import { createLayers, regionValue } from '../map/layers.js'
import { ChargingMapController, mapCursor, markerSelection, zoomViewState, CLICK_RECOGNIZER_OPTIONS } from '../map/interaction.js'
import { useClusters } from '../config/clustering.js'
import { MAP_STYLES } from '../config/map.js'
import { METRICS } from '../data/analytics.js'
import { format } from '../utils/format.js'
import 'maplibre-gl/dist/maplibre-gl.css'

export default function ChargingMap({ data, markers, regions, options, viewState, onViewChange, onSite, onCluster, onRegion, onMapError }) {
  const clustered = useClusters(options, viewState.zoom)
  const markerHover = useRef(false)
  const { layers } = useMemo(() => createLayers(data, regions, options, markers, clustered), [data, regions, options, markers, clustered])
  const isSite = info => info.layer?.id === 'charging-sites'
  const isMarker = info => info.layer?.id === 'charging-markers'
  return <DeckGL viewState={viewState} onViewStateChange={({ viewState: next }) => onViewChange(next)}
    controller={{ type: ChargingMapController, doubleClickZoom: true }} layers={layers} eventRecognizerOptions={CLICK_RECOGNIZER_OPTIONS} pickingRadius={6} getCursor={state => mapCursor({ ...state, markerHovered: markerHover.current })}
    onHover={info => { markerHover.current = (isSite(info) || isMarker(info)) && info.index >= 0 }}
    onClick={(info, event) => {
      const selection = isMarker(info) ? markerSelection(markers, info.index) : null
      if (event.type === 'dblclick') {
        const target = selection?.type === 'cluster' ? selection : null
        onViewChange(zoomViewState(viewState, target, info.coordinate))
        return
      }
      if (selection?.type === 'cluster') onCluster(selection)
      else if (selection?.type === 'site') onSite(selection.rowIndex)
      else if (isSite(info) && info.index >= 0) onSite(data.rowIndices[info.index])
      else if (info.object?.properties) onRegion(info.object.properties)
    }}
    getTooltip={info => {
      if (isMarker(info) && info.index >= 0) {
        const selection = markerSelection(markers, info.index)
        return { text: selection?.type === 'cluster'
          ? `${format(selection.sites)} площадок · ${format(selection.points)} зарядных точек\nКлик — сводка; двойной клик — приблизить`
          : `${format(markers.pointCounts[info.index])} зарядных точек\nДо ${format(markers.powers[info.index])} kW\nНажми для подробностей` }
      }
      if (isSite(info) && info.index >= 0) return { text: `${format(data.pointCounts[info.index])} зарядных точек\nДо ${format(data.powers[info.index])} kW\nНажми для подробностей` }
      if (info.object?.properties) {
        const p = info.object.properties
        return { text: `${p.state_name || p.display_name || p.district_name}\n${METRICS[options.metric].title}: ${format(regionValue(info.object, options.metric))}` }
      }
      return null
    }}>
    <Map mapLib={maplibre} mapStyle={MAP_STYLES[options.style]} onError={event => onMapError(event.error?.message || 'Ошибка подложки')} />
  </DeckGL>
}
