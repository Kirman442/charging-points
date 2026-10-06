import { decodeAutobahn } from '../data/autobahn.js'
import { validateDetails, siteDetail } from '../data/siteDetails.js'
import { selectPoints } from '../data/pointSelection.js'
import { fingerprint, readRuntimeIndexes } from '../data/runtimeIndexes.js'
import { buildClusters, clusterMarkers, markerTransfers } from '../data/clusters.js'
import initWasm, { readParquet } from 'parquet-wasm/esm'
import wasmUrl from 'parquet-wasm/esm/parquet_wasm_bg.wasm?url'
import { tableFromIPC } from 'apache-arrow'
import { prepareSites } from '../data/prepareSites.js'
import { applyRegionStats, decodeRegions } from '../data/regions.js'

const autobahnLoads = new Map()
let detailsTable, detailsLoad, detailContext, pendingDetail = -1
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
function sendPendingDetail() {
  if (detailsTable && pendingDetail >= 0) {
    const index = pendingDetail
    pendingDetail = -1
    self.postMessage({ type: 'detail', index, detail: siteDetail(detailsTable, index, selection) })
  }
}
function loadDetails() {
  if (!detailContext || detailsLoad) return
  const started = performance.now(), trace = createTrace(started)
  detailsLoad = (async () => {
    const bytes = await readBytes(detailContext.url, trace, 'подробности площадок')
    const hashStarted = performance.now(), detailsHash = await fingerprint(bytes)
    trace.record('SHA-256: подробности площадок', hashStarted)
    const decoded = decodeTable(bytes, trace, 'подробности площадок')
    trace.measure('Проверка соответствия подробностей', () => validateDetails(decoded, table, detailContext.catalog, { sites: detailContext.sitesHash, details: detailsHash }))
    detailsTable = decoded
    trace.report('Подробности площадок готовы (фон)')
    sendPendingDetail()
  })().catch(error => {
    const index = pendingDetail
    pendingDetail = -1
    detailsLoad = null
    self.postMessage({ type: 'detail-error', index, message: `Карточки: ${error.message}` })
  })
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
        readBytes(message.urls.pointGroups, trace, 'числовые группы точек'),
        readBytes(message.urls.runtimeCatalog, trace, 'справочник индексов'),
      ])
      // Resolve errors into a value immediately: a failed region request must not
      // reject unhandled while the site pipeline is still running.
      const regionLoad = Promise.all([
        readBytes(message.urls.states, trace, 'земли'),
        readBytes(message.urls.districts, trace, 'районы KBA'),
        readLabels(message.urls.labels, trace),
      ]).then(value => ({ value }), error => ({ error }))
      const bytes = await sitesLoad
      const hashesReady = Promise.all([fingerprint(bytes[0]), fingerprint(bytes[1])])
        .then(value => ({ value }), error => ({ error }))
      await wasmReady
      table = decodeTable(bytes[0], trace, 'площадки (5 колонок)')
      const groupsTable = decodeTable(bytes[1], trace, 'числовые группы точек')
      const catalogTable = decodeTable(bytes[2], trace, 'справочник индексов')
      const hashWaitStarted = performance.now(), hashResult = await hashesReady
      trace.record('Ожидание SHA-256 после декодирования', hashWaitStarted)
      if (hashResult.error) throw hashResult.error
      const [sitesHash, groupsHash] = hashResult.value
      const indexes = trace.measure('Подключение числовых индексов', () => readRuntimeIndexes(table, groupsTable, catalogTable, { sites: sitesHash, groups: groupsHash }))
      detailContext = { url: message.urls.details, catalog: catalogTable, sitesHash }
      pointGroups = indexes.pointGroups
      operatorIndex = indexes.operatorIndex
      self.postMessage({ type: 'catalog', states: [...pointGroups.stateNames].sort() })
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
    if (message.type === 'load-a9') {
      if (!detailContext || !table) throw new Error('Сначала дождись загрузки площадок')
      const route = message.route || 'A9'
      if (!['A1','A9'].includes(route)) throw new Error('Неизвестный автобан')
      if (!autobahnLoads.has(route)) autobahnLoads.set(route, (async () => {
        const response = await fetch(message.url)
        if (!response.ok) throw new Error(`Загрузка ${route}: HTTP ${response.status}`)
        await wasmReady
        const decoded = tableFromIPC(readParquet(new Uint8Array(await response.arrayBuffer())).intoIPCStream())
        return decodeAutobahn(decoded, detailContext.sitesHash, table.numRows, route)
      })())
      try { self.postMessage({ type: 'a9-ready', route, pilot: await autobahnLoads.get(route) }) }
      catch (error) { autobahnLoads.delete(route); self.postMessage({ type: 'a9-error', route, message: error.message }) }
    }
    if (message.type === 'load-details') loadDetails()
    if (message.type === 'filter' && table && pointGroups) { sendSites('filtered', message.requestId, message.filters, performance.now()) }
    if (message.type === 'clusters') {
      currentZoom = message.zoom
      if (clusterIndex) {
        const markers = clusterMarkers(clusterIndex, currentZoom)
        self.postMessage({ type: 'clusters', requestId: selectionRequestId, zoom: currentZoom, markers }, markerTransfers(markers))
      }
    }
    if (message.type === 'detail' && table && Number.isInteger(message.index)) {
      if (message.index === -1) pendingDetail = -1
      else if (message.index >= 0 && message.index < table.numRows) {
        pendingDetail = message.index
        if (detailsTable) sendPendingDetail()
        else loadDetails()
      }
    }
  } catch (error) { self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }) }
}
