import { SITE_COLUMNS, SITE_DETAIL_COLUMNS } from '../config/siteColumns.js'
import { readProjectedTable } from '../data/readProjectedTable.js'
import { buildPointGroups, selectPoints } from '../data/pointSelection.js'
import { buildOperatorIndex } from '../data/operators.js'
import { buildClusters, clusterMarkers, markerTransfers } from '../data/clusters.js'
import initWasm, { readParquet, ParquetFile, readSchema } from 'parquet-wasm/esm'
import wasmUrl from 'parquet-wasm/esm/parquet_wasm_bg.wasm?url'
import { tableFromIPC } from 'apache-arrow'
import { prepareSites } from '../data/prepareSites.js'
import { applyRegionStats, decodeRegions } from '../data/regions.js'

let table, operatorIndex, pointGroups, selection, wasmReady, clusterIndex, currentZoom = 5, selectionRequestId = 0
function sendSites(type, requestId, filters, started, trace = null) {
  const measure = (name, operation) => trace ? trace.measure(name, operation) : operation()
  selection = measure('Расчёт выборки и аналитики', () => selectPoints(table, pointGroups, filters, operatorIndex))
  const result = measure('Буферы площадок', () => prepareSites(table, selection.indices, selection))
  clusterIndex = measure('Кластерный индекс', () => buildClusters(result))
  selectionRequestId = requestId
  const markers = clusterMarkers(clusterIndex, currentZoom)
  result.markers = markers
  result.regionStats = selection.stats
  self.postMessage({ type, requestId, ...result, filters, elapsedMs: performance.now() - started }, [result.positions.buffer, result.colors.buffer, result.powers.buffer, result.pointCounts.buffer, result.rowIndices.buffer, ...markerTransfers(markers)])
}
function createTrace(started) {
  const stages = []
  const record = (name, start) => stages.push({ stage: name, startMs: start - started, durationMs: performance.now() - start })
  return {
    record,
    measure(name, operation) { const start = performance.now(); const result = operation(); record(name, start); return result },
    report(phase) { self.postMessage({ type: 'performance', phase, elapsedMs: performance.now() - started, stages: stages.splice(0) }) },
  }
}
async function readBytes(url, trace, label) {
  const start = performance.now()
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Загрузка ${url}: HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  trace.record(`Получение байтов (с ожиданием Worker): ${label}`, start)
  return bytes
}
function decodeTable(bytes, trace, label) {
  return trace.measure(`Декодирование: ${label}`, () => tableFromIPC(readParquet(bytes, { batchSize: 16384 }).intoIPCStream()))
}
async function readLabels(url, trace) {
  const start = performance.now()
  const response = await fetch(url)
  if (!response.ok) throw new Error('Не загрузились названия районов')
  const labels = await response.json()
  trace.record('Получение названий районов (с ожиданием Worker)', start)
  return labels
}
self.onmessage = async ({ data: message }) => {
  try {
    if (message.type === 'load') {
      currentZoom = message.zoom
      const started = performance.now(), trace = createTrace(started)
      self.postMessage({ type: 'progress', message: 'Загрузка площадок…' })
      const wasmStarted = performance.now()
      wasmReady ||= initWasm(wasmUrl).then(() => trace.record('Загрузка и инициализация WASM', wasmStarted))
      // Fetch every file now; defer all territory decoding until sites are ready.
      const sitesLoad = Promise.all([
        readBytes(message.urls.sites, trace, 'площадки'),
        readBytes(message.urls.pointGroups, trace, 'группы точек'),
      ])
      // Resolve errors into a value immediately: a failed region request must not
      // reject unhandled while the site pipeline is still running.
      const regionLoad = Promise.all([
        readBytes(message.urls.states, trace, 'земли'),
        readBytes(message.urls.districts, trace, 'районы KBA'),
        readLabels(message.urls.labels, trace),
      ]).then(value => ({ value }), error => ({ error }))
      const bytes = await sitesLoad
      await wasmReady
      const sitesStarted = performance.now()
      table = await readProjectedTable(bytes[0], SITE_COLUMNS, { ParquetFile, readSchema })
      trace.record('Декодирование выбранных колонок: площадки', sitesStarted)
      const groupsTable = decodeTable(bytes[1], trace, 'группы точек')
      pointGroups = trace.measure('Индекс групп точек', () => buildPointGroups(table, groupsTable))
      operatorIndex = trace.measure('Индекс операторов', () => buildOperatorIndex(table))
      self.postMessage({ type: 'catalog', states: [...new Set(table.getChild('state_name'))].sort() })
      sendSites('ready', 0, message.filters || {}, started, trace)
      trace.report('Площадки готовы')
      try {
        const result = await regionLoad
        if (result.error) throw result.error
        const [stateBytes, districtBytes, labels] = result.value
        const states = decodeTable(stateBytes, trace, 'земли')
        const districts = decodeTable(districtBytes, trace, 'районы KBA')
        const base = trace.measure('Геометрия территорий', () => ({ states: decodeRegions(states, 'states'), districts: decodeRegions(districts, 'districts').map(feature => ({ ...feature, properties: { ...feature.properties, ...labels[feature.properties.district_code] } })) }))
        const regions = trace.measure('Привязка региональной аналитики', () => applyRegionStats(base, selection.stats))
        self.postMessage({ type: 'regions', ...regions })
        trace.report('Территории и аналитика готовы')
      } catch (error) { self.postMessage({ type: 'error', message: `Границы: ${error.message}` }) }
    }
    if (message.type === 'filter' && table && pointGroups) { sendSites('filtered', message.requestId, message.filters, performance.now()) }
    if (message.type === 'clusters') {
      currentZoom = message.zoom
      if (clusterIndex) {
        const markers = clusterMarkers(clusterIndex, currentZoom)
        self.postMessage({ type: 'clusters', requestId: selectionRequestId, zoom: currentZoom, markers }, markerTransfers(markers))
      }
    }
    if (message.type === 'detail' && table && Number.isInteger(message.index) && message.index >= 0 && message.index < table.numRows) {
      const detail = Object.fromEntries(SITE_DETAIL_COLUMNS.map(name => [name, table.getChild(name)?.get(message.index)]))
      detail.available_power_kw = Array.from(table.getChild('available_power_kw')?.get(message.index) || [])
      detail.selected_point_count = selection.points[message.index]
      detail.selected_equipment_count = selection.equipmentCounts[message.index]
      detail.selected_power_kw = selection.nominal[message.index]
      self.postMessage({ type: 'detail', index: message.index, detail })
    }
  } catch (error) { self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }) }
}
