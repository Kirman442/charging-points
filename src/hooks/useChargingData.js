import { useCallback, useEffect, useRef, useState } from 'react'
import { FILES } from '../config/map.js'

export function useChargingData(filters) {
  const workerRef = useRef(null), selectedIndex = useRef(-1), requestId = useRef(0)
  const [data, setData] = useState(null), [regions, setRegions] = useState(null)
  const [states, setStates] = useState([]), [detail, setDetail] = useState(null)
  const [status, setStatus] = useState('Загрузка данных…'), [error, setError] = useState('')
  const [ready, setReady] = useState(false), [retry, setRetry] = useState(0)
  useEffect(() => {
    const worker = new Worker(new URL('../workers/charging.worker.js', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.onmessage = ({ data: message }) => {
      if (message.type === 'progress') setStatus(message.message)
      if (message.type === 'catalog') setStates(message.states)
      if (message.type === 'ready') { setData(message); setReady(true); setStatus('Загрузка границ…') }
      if (message.type === 'filtered' && message.requestId === requestId.current) setData(message)
      if (message.type === 'regions') { setRegions(message); setStatus('Готово') }
      if (message.type === 'detail' && message.index === selectedIndex.current) setDetail(message.detail)
      if (message.type === 'error') setError(message.message)
    }
    worker.onerror = event => setError(event.message || 'Ошибка Worker')
    const urls = Object.fromEntries(Object.entries(FILES).map(([key, name]) => [key, new URL(`${import.meta.env.BASE_URL}data/${name}`, window.location.origin).href]))
    worker.postMessage({ type: 'load', urls })
    return () => { worker.terminate(); workerRef.current = null }
  }, [retry])
  useEffect(() => {
    if (ready) workerRef.current?.postMessage({ type: 'filter', filters, requestId: ++requestId.current })
  }, [filters, ready])
  const selectSite = useCallback(index => {
    selectedIndex.current = index; setDetail(null)
    if (index >= 0) workerRef.current?.postMessage({ type: 'detail', index })
  }, [])
  const reload = useCallback(() => {
    selectedIndex.current = -1; requestId.current++
    setData(null); setRegions(null); setReady(false); setDetail(null); setError(''); setStatus('Загрузка данных…'); setRetry(value => value + 1)
  }, [])
  return { data, regions, states, detail, status, error, selectSite, reload }
}
