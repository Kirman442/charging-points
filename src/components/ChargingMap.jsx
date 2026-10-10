import { PathLayer, ScatterplotLayer, GeoJsonLayer } from '@deck.gl/layers'
import { PathStyleExtension } from '@deck.gl/extensions'
import { A9_STATUS } from '../data/autobahn.js'
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
import { counted } from '../utils/siteSelection.js'
import 'maplibre-gl/dist/maplibre-gl.css'
import { paletteFor, rgba } from '../map/palette.js'

export default function ChargingMap({ data, autobahn, direction, markers, regions, options, viewState, onViewChange, onSite, onCluster, onRegion, onMapError, onDataRendered, selectedSite, selectedCluster, selectedSegment, onSegment, mobile }) {
  const clustered = useClusters(options, viewState.zoom)
  const markerHover = useRef(false)
  const [hovered, setHovered] = useState(null)
  const [hoverInfo, setHoverInfo] = useState(null)
  useEffect(() => {
    if (!hovered?.text || mobile || options.a9Mode) return
    const timer = setTimeout(() => setHoverInfo(hovered), 350)
    return () => clearTimeout(timer)
  }, [hovered, mobile, options.a9Mode])
  const timing = useRef({ started: null, events: new Set(), packets: new WeakSet() })
  useEffect(() => { timing.current.started = performance.now() }, [])
  useEffect(() => {
    const dismiss = event => { if (event.key === 'Escape') { setHovered(null); setHoverInfo(null) } }
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
    if (!options.a9Mode && hovered?.region && regions?.[options.territory]?.includes(hovered.region)) overlays.push(new GeoJsonLayer({ id: 'hover-region', data: [hovered.region], filled: false, stroked: true, getLineColor: rgba(palette.territoryHover, 150), getLineWidth: 1, lineWidthUnits: 'pixels', pickable: false }))
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
  const hoverContext = `${viewState.longitude}:${viewState.latitude}:${viewState.zoom}:${options.metric}:${options.territory}`
  const hoverCurrent = hovered?.region
    ? regions?.[options.territory]?.includes(hovered.region)
    : hovered?.source === (hovered?.clustered ? markers : data)
  const hoverText = info => {
    if (isMarker(info) && info.index >= 0) {
      const selection = markerSelection(markers, info.index)
      return selection?.type === 'cluster'
        ? `${counted(selection.sites, ['площадка', 'площадки', 'площадок'])} · ${counted(selection.points, ['зарядная точка', 'зарядные точки', 'зарядных точек'])}\nКлик — сводка; двойной клик — приблизить`
        : `${counted(markers.pointCounts[info.index], ['зарядная точка', 'зарядные точки', 'зарядных точек'])}\nДо ${format(markers.powers[info.index])} кВт\nНажми для подробностей`
    }
    if (isSite(info) && info.index >= 0) return `${counted(data.pointCounts[info.index], ['зарядная точка', 'зарядные точки', 'зарядных точек'])}\nДо ${format(data.powers[info.index])} кВт\nНажми для подробностей`
    if (info.object?.properties) {
      const p = info.object.properties
      const concentration = options.metric === 'concentration' ? operatorConcentration(p.operators, options.operatorBasis) : null
      return `${p.display_name || p.district_name || p.state_name}\n${METRICS[options.metric].title}: ${format(regionValue(info.object, options.metric, options.operatorBasis))}${options.metric === 'concentration' ? ' %' : ''}${concentration ? `\n${concentration.name}\n${options.operatorBasis === 'power' ? 'По номинальной мощности' : 'По числу точек'}` : ''}`
    }
    return null
  }
  return <div className="charging-map" onPointerLeave={() => { markerHover.current = false; setHovered(null); setHoverInfo(null) }}><DeckGL viewState={viewState} onViewStateChange={({ viewState: next }) => onViewChange(next)}
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
      let next = null
      if (markerHover.current) {
        const packet = isMarker(info) ? markers : data
        const position = isSquare(info) ? info.object.position : Array.from(packet.positions.subarray(info.index * 2, info.index * 2 + 2))
        next = { position, radius: isMarker(info) ? markers.radii[info.index] : options.a9Mode ? Math.max(3.5, Math.min(7, 0.8 + (viewState.zoom - 5) * .7)) : 7, source: packet, clustered: isMarker(info), id: `${info.layer.id}:${info.index}` }
      } else if (!options.a9Mode && info.object?.properties) next = { region: info.object, id: info.object }
      else if (info.layer?.id === 'a9-route') next = { segment: info.object, id: info.object }
      if (next && !options.a9Mode) { next.text = hoverText(info); next.context = hoverContext }
      if (!next) setHoverInfo(null)
      setHovered(previous => previous?.id === next?.id && previous?.source === next?.source && previous?.text === next?.text && previous?.context === next?.context ? previous : next)
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
      else if (!options.a9Mode && info.object?.properties) onRegion(info.object.properties)
    }}
    getTooltip={null}>
    <Map mapLib={maplibre} mapStyle={MAP_STYLES[options.style]}
      onLoad={() => reportMapEvent('Подложка: load')}
      onIdle={() => reportMapEvent('Подложка: первый idle')}
      onError={event => onMapError(event.error?.message || 'Ошибка подложки')} />
  </DeckGL>{!mobile && !options.a9Mode && hovered && hoverCurrent && hoverInfo?.context === hoverContext && hoverInfo?.id === hovered.id && hoverInfo?.source === hovered.source && <aside className="map-hover-info panel" aria-label="Информация при наведении">{hoverInfo.text}</aside>}</div>
}
