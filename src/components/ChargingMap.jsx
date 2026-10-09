import { PathLayer, ScatterplotLayer, GeoJsonLayer } from '@deck.gl/layers'
import { PathStyleExtension } from '@deck.gl/extensions'
import { AUTOBAHNS, A9_STATUS } from '../data/autobahn.js'
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { paletteFor, rgba } from '../map/palette.js'
import { tooltipPlacement } from '../map/tooltip.js'

export default function ChargingMap({ data, autobahn, direction, markers, regions, options, viewState, onViewChange, onSite, onCluster, onRegion, onMapError, onDataRendered, selectedSite, selectedCluster, selectedSegment, onSegment, mobile }) {
  const clustered = useClusters(options, viewState.zoom)
  const markerHover = useRef(false), pointer = useRef(null), mapRoot = useRef(null)
  const [hovered, setHovered] = useState(null)
  const [tooltipHidden, setTooltipHidden] = useState(false)
  const timing = useRef({ started: null, events: new Set(), packets: new WeakSet() })
  useEffect(() => { timing.current.started = performance.now() }, [])
  useEffect(() => {
    const dismiss = event => { if (event.key === 'Escape') { setHovered(null); setTooltipHidden(true) } }
    window.addEventListener('keydown', dismiss)
    return () => window.removeEventListener('keydown', dismiss)
  }, [])
  const reportMapEvent = name => {
    const trace = timing.current
    if (trace.started === null || trace.events.has(name)) return
    trace.events.add(name)
    console.info(`[Charging render] ${name}: ${Math.round(performance.now() - trace.started)} ms с запуска карты`)
  }
  const { layers } = useMemo(() => {
    const result = createLayers(data, regions, options, markers, clustered)
    const palette = paletteFor(options.style)
    if (autobahn) result.layers.unshift(new PathLayer({
      id: 'a9-route-casing', data: autobahn.segments.filter(s => s.direction === direction),
      getPath: s => s.path, getColor: rgba(palette.casing, 220),
      getWidth: viewState.zoom >= 10 ? 7 : 5, widthUnits: 'pixels', pickable: false,
    }), new PathLayer({
      id: 'a9-route', data: autobahn.segments.filter(s => s.direction === direction),
      getPath: s => s.path, getColor: s => rgba(palette.route[s.status]),
      getWidth: viewState.zoom >= 10 ? 5 : 3.5, widthUnits: 'pixels', pickable: true,
      getDashArray: s => A9_STATUS[s.status].dash, dashJustified: false, dashUnits: 'pixels', dashGapPickable: true,
      extensions: [new PathStyleExtension({ dash: true, dashMode: 'path' })],
    }))
    return result
  }, [data, regions, options, markers, clustered, autobahn, direction, viewState.zoom])
  const interactionLayers = useMemo(() => {
    const palette = paletteFor(options.style), overlays = []
    const ring = (id, position, radius, color, width) => overlays.push(new ScatterplotLayer({ id, data: [{ position }], getPosition: d => d.position, radiusUnits: 'pixels', getRadius: radius, stroked: true, filled: false, getLineColor: rgba(color), getLineWidth: width, lineWidthUnits: 'pixels', pickable: false }))
    if (hovered?.position && hovered.source === (hovered.clustered ? markers : data)) ring('hover-ring', hovered.position, hovered.radius + 2, palette.outline, 2)
    if (hovered?.region && regions?.[options.territory]?.includes(hovered.region)) overlays.push(new GeoJsonLayer({ id: 'hover-region', data: [hovered.region], filled: false, stroked: true, getLineColor: rgba(palette.outline, 210), getLineWidth: 2, lineWidthUnits: 'pixels', pickable: false }))
    const index = selectedSite == null ? -1 : data?.rowIndices?.indexOf(selectedSite) ?? -1
    if (index >= 0 && options.showSites) {
      const position = Array.from(data.positions.subarray(index * 2, index * 2 + 2))
      ring('selected-site-casing', position, options.a9Mode ? Math.max(3.5, Math.min(7, 0.8 + (viewState.zoom - 5) * .7)) + 4 : 10, palette.casing, 5)
      ring('selected-site-ring', position, options.a9Mode ? Math.max(3.5, Math.min(7, 0.8 + (viewState.zoom - 5) * .7)) + 4 : 10, palette.selected, 3)
    }
    const clusterIndex = selectedCluster && markers ? markers.clusterIds.indexOf(selectedCluster.id) : -1
    if (clusterIndex >= 0) ring('selected-cluster-ring', [markers.positions[clusterIndex * 2], markers.positions[clusterIndex * 2 + 1]], markers.radii[clusterIndex] + 3, palette.selected, 3)
    const segment = selectedSegment || hovered?.segment
    if (segment && autobahn?.segments.includes(segment) && segment.direction === direction) overlays.push(new PathLayer({ id: 'selected-route-section', data: [segment], getPath: s => s.path, getColor: rgba(palette.outline), getWidth: viewState.zoom >= 10 ? 7 : 5, widthUnits: 'pixels', pickable: false, getDashArray: [2,3], dashUnits: 'pixels', extensions: [new PathStyleExtension({ dash: true })] }))
    return overlays
  }, [hovered, data, markers, selectedSite, selectedCluster, selectedSegment, options.style, options.showSites, options.a9Mode, options.territory, viewState.zoom, regions, autobahn, direction])
  const isSquare = info => info.layer?.id === 'charging-access-sites'
  const isSite = info => info.layer?.id === 'charging-sites' || isSquare(info)
  const isMarker = info => info.layer?.id === 'charging-markers'
  const trackPointer = event => { pointer.current = { x: event.clientX, y: event.clientY } }
  return <div ref={mapRoot} className={`charging-map${tooltipHidden ? ' hide-tooltip' : ''}`} onPointerMoveCapture={trackPointer} onPointerDownCapture={trackPointer} onPointerLeave={() => { pointer.current = null; setHovered(null); setTooltipHidden(true) }}><DeckGL viewState={viewState} onViewStateChange={({ viewState: next }) => onViewChange(next)}
    controller={{ type: ChargingMapController, doubleClickZoom: true }} layers={[...layers, ...interactionLayers]} eventRecognizerOptions={CLICK_RECOGNIZER_OPTIONS} pickingRadius={mobile ? 12 : 6} getCursor={state => mapCursor({ ...state, markerHovered: markerHover.current })}
    onAfterRender={() => {
      reportMapEvent('Первый кадр DeckGL')
      if (data) onDataRendered?.()
      if (!data?.count || !Number.isFinite(data.receivedAt) || timing.current.packets.has(data)) return
      if (!layers.some(layer => layer.id === 'charging-sites' || layer.id === 'charging-markers')) return
      timing.current.packets.add(data)
      console.info(`[Charging render] Первый кадр площадок после получения Worker: ${Math.round(performance.now() - data.receivedAt)} ms; выборка ${data.requestId}`)
    }}
    onHover={info => {
      markerHover.current = (isSite(info) || isMarker(info)) && info.index >= 0
      if (mobile) return
      setTooltipHidden(false)
      let next = null
      if (markerHover.current) {
        const packet = isMarker(info) ? markers : data
        const position = isSquare(info) ? info.object.position : Array.from(packet.positions.subarray(info.index * 2, info.index * 2 + 2))
        next = { position, radius: isMarker(info) ? markers.radii[info.index] : options.a9Mode ? Math.max(3.5, Math.min(7, 0.8 + (viewState.zoom - 5) * .7)) : 7, source: packet, clustered: isMarker(info), id: `${info.layer.id}:${info.index}` }
      } else if (info.object?.properties) next = { region: info.object, id: info.object }
      else if (info.layer?.id === 'a9-route') next = { segment: info.object, id: info.object }
      setHovered(previous => previous?.id === next?.id && previous?.source === next?.source ? previous : next)
    }}
    onClick={(info, event) => {
      const selection = isMarker(info) ? markerSelection(markers, info.index) : null
      if (event.type === 'dblclick') {
        const target = selection?.type === 'cluster' ? selection : null
        onViewChange(zoomViewState(viewState, target, info.coordinate))
        return
      }
      if (info.layer?.id === 'a9-route') onSegment?.(info.object)
      else if (selection?.type === 'cluster') onCluster(selection)
      else if (selection?.type === 'site') onSite(selection.rowIndex)
      else if (isSite(info) && info.index >= 0) onSite(isSquare(info) ? info.object.rowIndex : data.rowIndices[info.index])
      else if (info.object?.properties) onRegion(info.object.properties)
    }}
    getTooltip={info => {
      if (mobile || tooltipHidden || !pointer.current) return null
      const analytics = mapRoot.current?.closest('.map-app')?.querySelector('.analytics-shell:not([hidden])')?.getBoundingClientRect()
      const styled = text => ({ text, style: { ...tooltipPlacement(pointer.current, { width: window.innerWidth, height: window.innerHeight, right: analytics?.left }), backgroundColor: options.style === 'light' ? '#ffffff' : '#182229', color: options.style === 'light' ? '#182b34' : '#f2f6f7', fontSize: '14px', padding: '12px 16px', borderRadius: '12px', border: `1px solid ${options.style === 'light' ? '#b2c1c9' : '#708087'}`, maxWidth: '300px', lineHeight: '1.5' } })
      if (info.layer?.id === 'a9-route') return styled(`${autobahn.route} · ${AUTOBAHNS[autobahn.route][direction]}\n${A9_STATUS[info.object.status].label}${info.object.status === 'unknown' ? '' : `\n${info.object.gap_km.toFixed(1)} км — предварительный интервал`}`)
      if (isMarker(info) && info.index >= 0) {
        const selection = markerSelection(markers, info.index)
        return styled(selection?.type === 'cluster'
          ? `${format(selection.sites)} площадок · ${format(selection.points)} зарядных точек\nКлик — сводка; двойной клик — приблизить`
          : `${format(markers.pointCounts[info.index])} зарядных точек\nДо ${format(markers.powers[info.index])} кВт\nНажми для подробностей`)
      }
      if (isSquare(info) && info.index >= 0) return styled('Маршрут найден · есть условия доступа\nНажми для подробностей')
      if (isSite(info) && info.index >= 0) return styled(`${format(data.pointCounts[info.index])} зарядных точек\nДо ${format(data.powers[info.index])} кВт\nНажми для подробностей`)
      if (info.object?.properties) {
        const p = info.object.properties
        const concentration = options.metric === 'concentration' ? operatorConcentration(p.operators, options.operatorBasis) : null
        return styled(`${p.display_name || p.district_name || p.state_name}\n${METRICS[options.metric].title}: ${format(regionValue(info.object, options.metric, options.operatorBasis))}${options.metric === 'concentration' ? ' %' : ''}${concentration ? `\n${concentration.name}\n${options.operatorBasis === 'power' ? 'По номинальной мощности' : 'По числу точек'}` : ''}`)
      }
      return null
    }}>
    <Map mapLib={maplibre} mapStyle={MAP_STYLES[options.style]}
      onLoad={() => reportMapEvent('Подложка: load')}
      onIdle={() => reportMapEvent('Подложка: первый idle')}
      onError={event => onMapError(event.error?.message || 'Ошибка подложки')} />
  </DeckGL></div>
}
