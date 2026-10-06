import { useCallback, useEffect, useRef, useState } from 'react'
import { applyRegionStats } from '../data/regions.js'
import { CLUSTER_MAX_ZOOM, clusterZoom, markersForView } from '../config/clustering.js'
import { filterKey } from '../data/filterKey.js'
import { FILES } from '../config/map.js'

export function useChargingData(filters, zoom, clusterSites, autobahnRoute = 'A9') {
  const zoomLevel = clusterSites ? Math.min(CLUSTER_MAX_ZOOM, clusterZoom(zoom)) : CLUSTER_MAX_ZOOM, zoomRef = useRef(zoomLevel)
  useEffect(() => { zoomRef.current = zoomLevel }, [zoomLevel])
  const [autobahnPackets, setAutobahnPackets] = useState({})
  const activePacket = autobahnPackets[autobahnRoute]
  const a9 = activePacket?.pilot || null, a9Pending = activePacket?.pending || false, a9Error = activePacket?.error || ''
  const [markerPacket, setMarkerPacket] = useState(null)
  const filtersRef = useRef(filters), sentFilters = useRef(null)
  useEffect(() => { filtersRef.current = filters }, [filters])
  const workerRef = useRef(null), selectedIndex = useRef(-1), requestId = useRef(0), detailsStarted = useRef(false), detailFrame = useRef(null)
  const [data, setData] = useState(null), [regions, setRegions] = useState(null)
  const [states, setStates] = useState([]), [detail, setDetail] = useState(null)
  const [detailPending, setDetailPending] = useState(false)
  const [status, setStatus] = useState('Загрузка данных…'), [error, setError] = useState('')
  const [ready, setReady] = useState(false), [retry, setRetry] = useState(0)
  useEffect(() => {
    const worker = new Worker(new URL('../workers/charging.worker.js', import.meta.url), { type: 'module' })
    workerRef.current = worker
    requestId.current = 0
    detailsStarted.current = false
    const started = performance.now()
    worker.onmessage = ({ data: message }) => {
      if (message.type === 'a9-ready') { setAutobahnPackets(previous => ({ ...previous, [message.route || 'A9']: { pilot: message.pilot, pending: false, error: '' } })) }
      if (message.type === 'a9-error') { setAutobahnPackets(previous => ({ ...previous, [message.route || 'A9']: { pending: false, error: message.message } })) }
      if (message.type === 'performance') {
        console.info(`[Charging performance] ${message.phase}: Worker ${Math.round(message.elapsedMs)} ms; с запуска загрузки ${Math.round(performance.now() - started)} ms`)
        console.table(message.stages.map(stage => ({ 'Этап': stage.stage, 'Начало, мс': Math.round(stage.startMs), 'Время, мс': Math.round(stage.durationMs) })))
      }
      if (message.type === 'progress') setStatus(message.message)
      if (message.type === 'catalog') setStates(message.states)
      if (message.type === 'ready') { setData({ ...message, receivedAt: performance.now() }); setMarkerPacket({ requestId: 0, zoom: message.markers?.zoom, markers: message.markers }); setReady(true); setStatus('Загрузка границ…') }
      if (message.type === 'filtered' && message.requestId === requestId.current) { setData({ ...message, receivedAt: performance.now() }); setMarkerPacket({ requestId: message.requestId, zoom: message.markers?.zoom, markers: message.markers }); setRegions(previous => previous ? applyRegionStats(previous, message.regionStats) : previous) }
      if (message.type === 'clusters' && message.requestId === requestId.current && message.zoom === zoomRef.current && message.markers) setMarkerPacket(message)
      if (message.type === 'regions') { setRegions(message); setStatus('Готово') }
      if (message.type === 'detail' && message.index === selectedIndex.current) { setDetail(message.detail); setDetailPending(false); setError(previous => previous.startsWith('Карточки:') ? '' : previous) }
      if (message.type === 'detail-error') { setError(message.message); if (message.index === selectedIndex.current) setDetailPending(false) }
      if (message.type === 'error') { setError(message.message); if (!message.message.startsWith('Границы:')) setDetailPending(false) }
    }
    worker.onerror = event => { setError(event.message || 'Ошибка Worker'); setDetailPending(false) }
    const urls = Object.fromEntries(Object.entries(FILES).map(([key, name]) => [key, new URL(`${import.meta.env.BASE_URL}data/${name}`, window.location.origin).href]))
    const initialFilters = filtersRef.current
    sentFilters.current = filterKey(initialFilters)
    worker.postMessage({ type: 'load', urls, zoom: zoomRef.current, filters: initialFilters })
    return () => { cancelAnimationFrame(detailFrame.current); worker.terminate(); workerRef.current = null }
  }, [retry])
  useEffect(() => {
    const key = filterKey(filters)
    if (ready && key !== sentFilters.current) {
      sentFilters.current = key
      workerRef.current?.postMessage({ type: 'filter', filters, requestId: ++requestId.current })
    }
  }, [filters, ready])
  useEffect(() => {
    if (ready) workerRef.current?.postMessage({ type: 'clusters', zoom: zoomLevel })
  }, [zoomLevel, ready])
  const markers = markersForView(markerPacket, data, zoomLevel)
  const selectSite = useCallback(index => {
    selectedIndex.current = index
    if (index >= 0) { setDetailPending(true); workerRef.current?.postMessage({ type: 'detail', index }) }
    else { setDetail(null); setDetailPending(false); workerRef.current?.postMessage({ type: 'detail', index: -1 }) }
  }, [])
  const onDataRendered = useCallback(() => {
    if (detailsStarted.current || !workerRef.current) return
    detailsStarted.current = true
    const worker = workerRef.current
    // Send after the frame containing ready data has had a paint opportunity.
    detailFrame.current = requestAnimationFrame(() => {
      if (workerRef.current === worker) worker.postMessage({ type: 'load-details' })
    })
  }, [])
  const loadAutobahn = useCallback(route => {
    if (!workerRef.current) return
    setAutobahnPackets(previous => ({ ...previous, [route]: { ...previous[route], pending: true, error: '' } }))
    workerRef.current.postMessage({ type: 'load-a9', route, url: new URL(`${import.meta.env.BASE_URL}data/autobahn_${route.toLowerCase()}_zstd10.parquet`, window.location.origin).href })
  }, [])
  const loadA9 = useCallback(() => loadAutobahn(autobahnRoute), [loadAutobahn, autobahnRoute])
  const reload = useCallback(() => {
    selectedIndex.current = -1; requestId.current++
    setAutobahnPackets({}); setData(null); setMarkerPacket(null); setRegions(null); setReady(false); setDetail(null); setDetailPending(false); setError(''); setStatus('Загрузка данных…'); setRetry(value => value + 1)
  }, [])
  return { a9, a9Pending, a9Error, loadA9, loadAutobahn, data, markers, regions, states, detail, detailPending, status, error, selectSite, reload, onDataRendered }
}
