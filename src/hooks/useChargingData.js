import { useCallback, useEffect, useRef, useState } from 'react'
import { applyRegionStats } from '../data/regions.js'
import { CLUSTER_MAX_ZOOM, clusterZoom, markersForView } from '../config/clustering.js'
import { FILES } from '../config/map.js'

export function useChargingData(filters, zoom, clusterSites) {
  const zoomLevel = clusterSites ? Math.min(CLUSTER_MAX_ZOOM, clusterZoom(zoom)) : CLUSTER_MAX_ZOOM, zoomRef = useRef(zoomLevel)
  useEffect(() => { zoomRef.current = zoomLevel }, [zoomLevel])
  const [markerPacket, setMarkerPacket] = useState(null)
  const workerRef = useRef(null), selectedIndex = useRef(-1), requestId = useRef(0)
  const [data, setData] = useState(null), [regions, setRegions] = useState(null)
  const [states, setStates] = useState([]), [detail, setDetail] = useState(null)
  const [detailPending, setDetailPending] = useState(false)
  const [status, setStatus] = useState('Загрузка данных…'), [error, setError] = useState('')
  const [ready, setReady] = useState(false), [retry, setRetry] = useState(0)
  useEffect(() => {
    const worker = new Worker(new URL('../workers/charging.worker.js', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.onmessage = ({ data: message }) => {
      if (message.type === 'progress') setStatus(message.message)
      if (message.type === 'catalog') setStates(message.states)
      if (message.type === 'ready') { setData(message); setMarkerPacket({ requestId: 0, zoom: message.markers?.zoom, markers: message.markers }); setReady(true); setStatus('Загрузка границ…') }
      if (message.type === 'filtered' && message.requestId === requestId.current) { setData(message); setMarkerPacket({ requestId: message.requestId, zoom: message.markers?.zoom, markers: message.markers }); setRegions(previous => previous ? applyRegionStats(previous, message.regionStats) : previous) }
      if (message.type === 'clusters' && message.requestId === requestId.current && message.zoom === zoomRef.current && message.markers) setMarkerPacket(message)
      if (message.type === 'regions') { setRegions(message); setStatus('Готово') }
      if (message.type === 'detail' && message.index === selectedIndex.current) { setDetail(message.detail); setDetailPending(false) }
      if (message.type === 'error') { setError(message.message); setDetailPending(false) }
    }
    worker.onerror = event => { setError(event.message || 'Ошибка Worker'); setDetailPending(false) }
    const urls = Object.fromEntries(Object.entries(FILES).map(([key, name]) => [key, new URL(`${import.meta.env.BASE_URL}data/${name}`, window.location.origin).href]))
    worker.postMessage({ type: 'load', urls, zoom: zoomRef.current })
    return () => { worker.terminate(); workerRef.current = null }
  }, [retry])
  useEffect(() => {
    if (ready) workerRef.current?.postMessage({ type: 'filter', filters, requestId: ++requestId.current })
  }, [filters, ready])
  useEffect(() => {
    if (ready) workerRef.current?.postMessage({ type: 'clusters', zoom: zoomLevel })
  }, [zoomLevel, ready])
  const markers = markersForView(markerPacket, data, zoomLevel)
  const selectSite = useCallback(index => {
    selectedIndex.current = index
    if (index >= 0) { setDetailPending(true); workerRef.current?.postMessage({ type: 'detail', index }) }
    else { setDetail(null); setDetailPending(false) }
  }, [])
  const reload = useCallback(() => {
    selectedIndex.current = -1; requestId.current++
    setData(null); setMarkerPacket(null); setRegions(null); setReady(false); setDetail(null); setDetailPending(false); setError(''); setStatus('Загрузка данных…'); setRetry(value => value + 1)
  }, [])
  return { data, markers, regions, states, detail, detailPending, status, error, selectSite, reload }
}
