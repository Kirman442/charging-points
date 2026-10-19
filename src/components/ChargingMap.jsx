import { useI18n } from "../i18n/useI18n.js";
import { PathLayer, GeoJsonLayer } from '@deck.gl/layers';
import { PathStyleExtension } from '@deck.gl/extensions';
import { A9_STATUS } from '../data/autobahn.js';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import Map from 'react-map-gl/maplibre';
import maplibre from '../map/maplibre.js';
import { createLayers, regionValue } from '../map/layers.js';
import { ChargingMapController, mapCursor, markerSelection, zoomViewState, CLICK_RECOGNIZER_OPTIONS } from '../map/interaction.js';
import { useClusters } from '../config/clustering.js';
import { MAP_STYLES } from '../config/map.js';
import { operatorConcentration } from '../data/concentration.js';
import { METRICS } from '../data/analytics.js';
import { format } from '../utils/format.js';
import { counted } from '../utils/siteSelection.js';
import 'maplibre-gl/dist/maplibre-gl.css';
import { siteOutlineLayer } from '../map/siteOutline.js';
import { paletteFor, rgba } from '../map/palette.js';
import { observeMapSize } from '../map/size.js';
import { observeMainThread } from '../utils/stallDiagnostics.js';
const basemapStyle = { position: 'absolute', inset: 0, width: '100%', height: '100%' };
export default function ChargingMap({
  data,
  autobahn,
  direction,
  markers,
  regions,
  options,
  viewState,
  onViewChange,
  onSite,
  onCluster,
  onRegion,
  onMapError,
  onDataRendered,
  selectedSite,
  selectedCluster,
  selectedSegment,
  onSegment,
  mobile
}) {
  const {
    language,
    t
  } = useI18n();
  const clustered = useClusters(options, viewState.zoom);
  const containerRef = useRef(null), deckRef = useRef(null);
  const [mapSize, setMapSize] = useState(null);
  useLayoutEffect(() => observeMapSize(containerRef.current, setMapSize), []);
  const diagnosticContext = useRef({});
  useEffect(() => {
    diagnosticContext.current = { sitesReceived: !!data, regionsReceived: !!regions, zoom: viewState.zoom };
  }, [data, regions, viewState.zoom]);
  useEffect(() => observeMainThread(
    entry => console.warn('[Charging stall]', JSON.stringify(entry)),
    () => diagnosticContext.current
  ), []);
  const markerHover = useRef(false);
  const routeHover = useRef(false);
  const [hovered, setHovered] = useState(null);
  const [hoverInfo, setHoverInfo] = useState(null);
  useEffect(() => {
    if (!hovered?.text || mobile || options.a9Mode) return;
    const timer = setTimeout(() => setHoverInfo(hovered), 350);
    return () => clearTimeout(timer);
  }, [hovered, mobile, options.a9Mode]);
  const timing = useRef({
    started: null,
    events: new Set(),
    packets: new WeakSet()
  });
  useEffect(() => {
    timing.current.started = performance.now();
  }, []);
  useEffect(() => {
    const dismiss = event => {
      if (event.key === 'Escape') {
        setHovered(null);
        setHoverInfo(null);
      }
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, []);
  const reportMapEvent = name => {
    const trace = timing.current;
    if (trace.started === null || trace.events.has(name)) return;
    trace.events.add(name);
    console.info(`[Charging render] ${name}: ${Math.round(performance.now() - trace.started)} ms с запуска карты`);
  };
  const reportFirstInput = event => {
    const name = `input:${event.type}`;
    if (timing.current.events.has(name)) return;
    timing.current.events.add(name);
    const deck = deckRef.current?.deck;
    const viewport = deck?.isInitialized ? deck.getViewports()[0] : null;
    console.info('[Charging input]', {
      event: event.type, elapsedMs: Math.round(performance.now() - timing.current.started),
      sitesReceived: !!data, regionsReceived: !!regions, deckReady: !!deck?.isInitialized,
      container: [containerRef.current.clientWidth, containerRef.current.clientHeight],
      viewport: viewport ? [viewport.width, viewport.height] : null,
    });
  };
  const routeZoom = autobahn ? viewState.zoom : 0;
  const routeSegments = useMemo(() => autobahn?.segments.filter(s => s.direction === direction), [autobahn, direction]);
  const {
    layers
  } = useMemo(() => {
    const result = createLayers(data, regions, options, markers, clustered);
    const palette = paletteFor(options.style);
    if (autobahn) result.layers.unshift(new PathLayer({
      id: 'a9-route-casing',
      data: routeSegments,
      getPath: s => s.path,
      getColor: rgba(palette.casing, 220),
      getWidth: routeZoom >= 10 ? 7 : 5,
      widthUnits: 'pixels',
      pickable: false
    }), new PathLayer({
      id: 'a9-route',
      data: routeSegments,
      getPath: s => s.path,
      getColor: s => rgba(palette.route[s.status]),
      getWidth: routeZoom >= 10 ? 5 : 3.5,
      widthUnits: 'pixels',
      pickable: true,
      getDashArray: s => A9_STATUS[s.status].dash,
      dashJustified: false,
      dashUnits: 'pixels',
      dashGapPickable: true,
      extensions: [new PathStyleExtension({
        dash: true,
        dashMode: 'path'
      })]
    }));
    return result;
  }, [data, regions, options, markers, clustered, autobahn, routeSegments, routeZoom]);
  const interactionLayers = useMemo(() => {
    const palette = paletteFor(options.style),
      overlays = [];
    const ring = (id, position, radius, color, width, square = false) => overlays.push(siteOutlineLayer({ id, position, radius, color: rgba(color), width, square }));
    if (hovered?.position && hovered.source === (hovered.clustered ? markers : data)) ring('hover-ring', hovered.position, hovered.radius + 2, palette.outline, 2, hovered.square);
    if (!options.a9Mode && hovered?.region && regions?.[options.territory]?.includes(hovered.region)) overlays.push(new GeoJsonLayer({
      id: 'hover-region',
      data: [hovered.region],
      filled: false,
      stroked: true,
      getLineColor: rgba(palette.territoryHover, 150),
      getLineWidth: 1,
      lineWidthUnits: 'pixels',
      pickable: false
    }));
    const index = selectedSite == null ? -1 : data?.rowIndices?.indexOf(selectedSite) ?? -1;
    if (index >= 0 && options.showSites) {
      const position = Array.from(data.positions.subarray(index * 2, index * 2 + 2));
      ring('selected-site-casing', position, options.a9Mode ? Math.max(3.5, Math.min(7, 0.8 + (viewState.zoom - 5) * .7)) + 4 : 10, palette.casing, 5, !!options.a9Mode && !!data.autobahnAccess?.[index]);
      ring('selected-site-ring', position, options.a9Mode ? Math.max(3.5, Math.min(7, 0.8 + (viewState.zoom - 5) * .7)) + 4 : 10, palette.selected, 3, !!options.a9Mode && !!data.autobahnAccess?.[index]);
    }
    const clusterIndex = selectedCluster && markers ? markers.clusterIds.indexOf(selectedCluster.id) : -1;
    if (clusterIndex >= 0) ring('selected-cluster-ring', [markers.positions[clusterIndex * 2], markers.positions[clusterIndex * 2 + 1]], markers.radii[clusterIndex] + 3, palette.selected, 3);
    const segment = selectedSegment || hovered?.segment;
    if (segment && autobahn?.segments.includes(segment) && segment.direction === direction) overlays.push(new PathLayer({
      id: 'selected-route-section',
      data: [segment],
      getPath: s => s.path,
      getColor: rgba(palette.outline),
      getWidth: viewState.zoom >= 10 ? 7 : 5,
      widthUnits: 'pixels',
      pickable: false,
      getDashArray: [2, 3],
      dashUnits: 'pixels',
      extensions: [new PathStyleExtension({
        dash: true
      })]
    }));
    return overlays;
  }, [hovered, data, markers, selectedSite, selectedCluster, selectedSegment, options.style, options.showSites, options.a9Mode, options.territory, viewState.zoom, regions, autobahn, direction]);
  const isSquare = info => info.layer?.id === 'charging-access-sites';
  const isSite = info => info.layer?.id === 'charging-sites' || isSquare(info);
  const isMarker = info => info.layer?.id === 'charging-markers';
  const hoverContext = `${viewState.longitude}:${viewState.latitude}:${viewState.zoom}:${options.metric}:${options.territory}:${language}`;
  const hoverCurrent = hovered?.region ? regions?.[options.territory]?.includes(hovered.region) : hovered?.source === (hovered?.clustered ? markers : data);
  const hoverText = info => {
    if (isMarker(info) && info.index >= 0) {
      const selection = markerSelection(markers, info.index);
      return selection?.type === 'cluster' ? t("{p0} · {p1}\nКлик — сводка; двойной клик — приблизить", {
        p0: counted(selection.sites, ['площадка', 'площадки', 'площадок'], language),
        p1: counted(selection.points, ['зарядная точка', 'зарядные точки', 'зарядных точек'], language)
      }) : t("{p0}\nДо {p1} кВт\nНажми для подробностей", {
        p0: counted(markers.pointCounts[info.index], ['зарядная точка', 'зарядные точки', 'зарядных точек'], language),
        p1: format(markers.powers[info.index])
      });
    }
    if (isSite(info) && info.index >= 0) return t("{p0}\nДо {p1} кВт\nНажми для подробностей", {
      p0: counted(data.pointCounts[info.index], ['зарядная точка', 'зарядные точки', 'зарядных точек'], language),
      p1: format(data.powers[info.index])
    });
    if (info.object?.properties) {
      const p = info.object.properties;
      const concentration = options.metric === 'concentration' ? operatorConcentration(p.operators, options.operatorBasis) : null;
      return `${p.display_name || p.district_name || p.state_name}\n${t(METRICS[options.metric].title)}: ${format(regionValue(info.object, options.metric, options.operatorBasis))}${options.metric === 'concentration' ? ' %' : ''}${concentration ? `\n${concentration.name}\n${options.operatorBasis === 'power' ? t("По номинальной мощности") : t("По числу точек")}` : ''}`;
    }
    return null;
  };
  return <div className="charging-map" ref={containerRef} onWheelCapture={reportFirstInput} onPointerDownCapture={reportFirstInput} onPointerLeave={() => {
    markerHover.current = false;
    setHovered(null);
    setHoverInfo(null);
  }}><Map mapLib={maplibre} mapStyle={MAP_STYLES[options.style]} style={basemapStyle}
    longitude={viewState.longitude} latitude={viewState.latitude} zoom={viewState.zoom}
    pitch={viewState.pitch || 0} bearing={viewState.bearing || 0} padding={viewState.padding}
    interactive={false} onLoad={() => reportMapEvent('Подложка: load')} onIdle={() => reportMapEvent('Подложка: первый idle')}
    onError={event => onMapError(event.error?.message || t("Ошибка подложки"))} />
    {mapSize && <DeckGL ref={deckRef} width={mapSize.width} height={mapSize.height} viewState={viewState} onViewStateChange={({
      viewState: next, interactionState
    }) => {
      if (!data && (interactionState?.isDragging || interactionState?.isZooming)) reportMapEvent('Камера реагирует до данных');
      onViewChange(next);
    }} controller={{
      type: ChargingMapController,
      doubleClickZoom: true
    }} layers={[...layers, ...interactionLayers]} eventRecognizerOptions={CLICK_RECOGNIZER_OPTIONS} pickingRadius={mobile ? 12 : 6} getCursor={state => mapCursor({
      ...state,
      markerHovered: markerHover.current,
      routeHovered: routeHover.current
    })} onAfterRender={() => {
      reportMapEvent('Первый кадр DeckGL');
      if (data) onDataRendered?.();
      if (!data?.count || !Number.isFinite(data.receivedAt) || timing.current.packets.has(data)) return;
      if (!layers.some(layer => layer.id === 'charging-sites' || layer.id === 'charging-markers')) return;
      timing.current.packets.add(data);
      console.info(`[Charging render] Первый кадр площадок после получения Worker: ${Math.round(performance.now() - data.receivedAt)} ms; выборка ${data.requestId}`);
    }} onHover={info => {
      routeHover.current = info.layer?.id === 'a9-route' && info.index >= 0;
      markerHover.current = (isSite(info) || isMarker(info)) && info.index >= 0;
      if (mobile) return;
      let next = null;
      if (markerHover.current) {
        const packet = isMarker(info) ? markers : data;
        const position = isSquare(info) ? info.object.position : Array.from(packet.positions.subarray(info.index * 2, info.index * 2 + 2));
        next = {
          position,
          radius: isMarker(info) ? markers.radii[info.index] : options.a9Mode ? Math.max(3.5, Math.min(7, 0.8 + (viewState.zoom - 5) * .7)) : 7,
          square: isSquare(info) || (!isMarker(info) && !!options.a9Mode && !!packet.autobahnAccess?.[info.index]),
          source: packet,
          clustered: isMarker(info),
          id: `${info.layer.id}:${info.index}`
        };
      } else if (!options.a9Mode && info.object?.properties) next = {
        region: info.object,
        id: info.object
      };else if (info.layer?.id === 'a9-route') next = {
        segment: info.object,
        id: info.object
      };
      if (next && !options.a9Mode) {
        next.text = hoverText(info);
        next.context = hoverContext;
      }
      if (!next) setHoverInfo(null);
      setHovered(previous => previous?.id === next?.id && previous?.source === next?.source && previous?.text === next?.text && previous?.context === next?.context ? previous : next);
    }} onClick={(info, event) => {
      const selection = isMarker(info) ? markerSelection(markers, info.index) : null;
      if (event.type === 'dblclick') {
        const target = selection?.type === 'cluster' ? selection : null;
        onViewChange(zoomViewState(viewState, target, info.coordinate));
        return;
      }
      if (info.layer?.id === 'a9-route') onSegment?.(info.object);else if (selection?.type === 'cluster') onCluster(selection);else if (selection?.type === 'site') onSite(selection.rowIndex);else if (isSite(info) && info.index >= 0) onSite(isSquare(info) ? info.object.rowIndex : data.rowIndices[info.index]);else if (!options.a9Mode && info.object?.properties) onRegion(info.object.properties);
    }} getTooltip={null} />}{!mobile && !options.a9Mode && hovered && hoverCurrent && hoverInfo?.context === hoverContext && hoverInfo?.id === hovered.id && hoverInfo?.source === hovered.source && <aside className="map-hover-info panel" aria-label={t("Информация при наведении")}>{t(hoverInfo.text)}</aside>}</div>;
}
