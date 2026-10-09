import { PathLayer } from '@deck.gl/layers'
import { PathStyleExtension } from '@deck.gl/extensions'
import { AUTOBAHNS, A9_STATUS } from '../data/autobahn.js'
import { useEffect, useMemo, useRef } from 'react'
import DeckGL from '@deck.gl/react'
import Map from 'react-map-gl/maplibre'
import maplibre from '../map/maplibre.js'
import { createLayers, regionValue } from '../map/layers.js'
import { ChargingMapController, mapCursor, markerSelection, zoomViewState, CLICK_RECOGNIZER_OPTIONS } from '../map/interaction.js'
import { useClusters } from '../config/clustering.js'
import { MAP_STYLES } from '../config/map.js'
import { operatorConcentration } from '../data/concentration.js'
import { METRICS } from '../data/analytics.js'
import { format } from '../utils/format.js'
import 'maplibre-gl/dist/maplibre-gl.css'

export default function ChargingMap({ data, autobahn, direction, markers, regions, options, viewState, onViewChange, onSite, onCluster, onRegion, onMapError, onDataRendered }) {
  const clustered = useClusters(options, viewState.zoom)
  const markerHover = useRef(false)
  const timing = useRef({ started: null, events: new Set(), packets: new WeakSet() })
  useEffect(() => { timing.current.started = performance.now() }, [])
  const reportMapEvent = name => {
    const trace = timing.current
    if (trace.started === null || trace.events.has(name)) return
    trace.events.add(name)
    console.info(`[Charging render] ${name}: ${Math.round(performance.now() - trace.started)} ms с запуска карты`)
  }
  const { layers } = useMemo(() => {
    const result = createLayers(data, regions, options, markers, clustered)
    if (autobahn) result.layers.unshift(new PathLayer({
      id: 'a9-route', data: autobahn.segments.filter(s => s.direction === direction),
      getPath: s => s.path, getColor: s => A9_STATUS[s.status].color,
      getWidth: 4, widthUnits: 'pixels', pickable: true,
      getDashArray: s => A9_STATUS[s.status].dash, dashJustified: false, dashUnits: 'pixels', dashGapPickable: true,
      extensions: [new PathStyleExtension({ dash: true, dashMode: 'path' })],
    }))
    return result
  }, [data, regions, options, markers, clustered, autobahn, direction])
  const isSquare = info => info.layer?.id === 'charging-access-sites'
  const isSite = info => info.layer?.id === 'charging-sites' || isSquare(info)
  const isMarker = info => info.layer?.id === 'charging-markers'
  return <DeckGL viewState={viewState} onViewStateChange={({ viewState: next }) => onViewChange(next)}
    controller={{ type: ChargingMapController, doubleClickZoom: true }} layers={layers} eventRecognizerOptions={CLICK_RECOGNIZER_OPTIONS} pickingRadius={6} getCursor={state => mapCursor({ ...state, markerHovered: markerHover.current })}
    onAfterRender={() => {
      reportMapEvent('Первый кадр DeckGL')
      if (data) onDataRendered?.()
      if (!data?.count || !Number.isFinite(data.receivedAt) || timing.current.packets.has(data)) return
      if (!layers.some(layer => layer.id === 'charging-sites' || layer.id === 'charging-markers')) return
      timing.current.packets.add(data)
      console.info(`[Charging render] Первый кадр площадок после получения Worker: ${Math.round(performance.now() - data.receivedAt)} ms; выборка ${data.requestId}`)
    }}
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
      else if (isSite(info) && info.index >= 0) onSite(isSquare(info) ? info.object.rowIndex : data.rowIndices[info.index])
      else if (info.object?.properties) onRegion(info.object.properties)
    }}
    getTooltip={info => {
      if (info.layer?.id === 'a9-route') return { text: `${autobahn.route} · ${AUTOBAHNS[autobahn.route][direction]}\n${A9_STATUS[info.object.status].label}${info.object.status === 'unknown' ? '' : `\n${info.object.gap_km.toFixed(1)} км — предварительный интервал`}` }
      if (isMarker(info) && info.index >= 0) {
        const selection = markerSelection(markers, info.index)
        return { text: selection?.type === 'cluster'
          ? `${format(selection.sites)} площадок · ${format(selection.points)} зарядных точек\nКлик — сводка; двойной клик — приблизить`
          : `${format(markers.pointCounts[info.index])} зарядных точек\nДо ${format(markers.powers[info.index])} kW\nНажми для подробностей` }
      }
      if (isSquare(info) && info.index >= 0) return { text: 'Маршрут найден · есть условия доступа\nНажми для подробностей' }
      if (isSite(info) && info.index >= 0) return { text: `${format(data.pointCounts[info.index])} зарядных точек\nДо ${format(data.powers[info.index])} kW\nНажми для подробностей` }
      if (info.object?.properties) {
        const p = info.object.properties
        const concentration = options.metric === 'concentration' ? operatorConcentration(p.operators, options.operatorBasis) : null
        return { text: `${p.state_name || p.display_name || p.district_name}\n${METRICS[options.metric].title}: ${format(regionValue(info.object, options.metric, options.operatorBasis))}${options.metric === 'concentration' ? ' %' : ''}${concentration ? `\n${concentration.name}\n${options.operatorBasis === 'power' ? 'По номинальной мощности' : 'По числу точек'}` : ''}` }
      }
      return null
    }}>
    <Map mapLib={maplibre} mapStyle={MAP_STYLES[options.style]}
      onLoad={() => reportMapEvent('Подложка: load')}
      onIdle={() => reportMapEvent('Подложка: первый idle')}
      onError={event => onMapError(event.error?.message || 'Ошибка подложки')} />
  </DeckGL>
}
