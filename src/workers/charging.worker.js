import initWasm, { readParquet } from 'parquet-wasm/esm'
import wasmUrl from 'parquet-wasm/esm/parquet_wasm_bg.wasm?url'
import { tableFromIPC } from 'apache-arrow'
import { matchingIndices, prepareSites } from '../data/prepareSites.js'
import { aggregateSelection, applyRegionStats, buildDistrictIndex, decodeRegions } from '../data/regions.js'

let table, wasmReady, districtLinks = [], currentFilters = {}
function sendSites(type, requestId, filters, started) {
  const indices = matchingIndices(table, filters)
  const result = prepareSites(table, indices)
  result.regionStats = aggregateSelection(table, indices, districtLinks)
  self.postMessage({ type, requestId, ...result, elapsedMs: performance.now() - started }, [result.positions.buffer, result.colors.buffer, result.powers.buffer, result.pointCounts.buffer, result.rowIndices.buffer])
}
async function readTable(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Загрузка ${url}: HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  wasmReady ||= initWasm(wasmUrl)
  await wasmReady
  return tableFromIPC(readParquet(bytes).intoIPCStream())
}
self.onmessage = async ({ data: message }) => {
  try {
    if (message.type === 'load') {
      const started = performance.now()
      self.postMessage({ type: 'progress', message: 'Загрузка площадок…' })
      table = await readTable(message.urls.sites)
      self.postMessage({ type: 'catalog', states: [...new Set(table.getChild('state_name'))].sort() })
      sendSites('ready', 0, {}, started)
      try {
        const [states, districts, index, labels] = await Promise.all([
          readTable(message.urls.states), readTable(message.urls.districts), readTable(message.urls.districtIndex),
          fetch(message.urls.labels).then(response => { if (!response.ok) throw new Error('Не загрузились названия районов'); return response.json() }),
        ])
        districtLinks = buildDistrictIndex(table, index)
        const base = { states: decodeRegions(states, 'states'), districts: decodeRegions(districts, 'districts').map(feature => ({ ...feature, properties: { ...feature.properties, ...labels[feature.properties.district_code] } })) }
        const regions = applyRegionStats(base, aggregateSelection(table, matchingIndices(table, currentFilters), districtLinks))
        self.postMessage({ type: 'regions', ...regions })
      } catch (error) { self.postMessage({ type: 'error', message: `Границы: ${error.message}` }) }
    }
    if (message.type === 'filter' && table) { currentFilters = message.filters; sendSites('filtered', message.requestId, message.filters, performance.now()) }
    if (message.type === 'detail' && table && Number.isInteger(message.index) && message.index >= 0 && message.index < table.numRows) {
      const fields = ['city', 'street', 'house_number', 'postal_code', 'state_name', 'operator', 'district_name', 'equipment_count', 'charging_point_count', 'opening_hours_label', 'operating_point_count', 'maintenance_point_count']
      const detail = Object.fromEntries(fields.map(name => [name, table.getChild(name)?.get(message.index)]))
      detail.available_power_kw = Array.from(table.getChild('available_power_kw')?.get(message.index) || [])
      self.postMessage({ type: 'detail', index: message.index, detail })
    }
  } catch (error) { self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }) }
}
