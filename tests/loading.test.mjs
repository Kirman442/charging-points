import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { Worker } from 'node:worker_threads'
import { filterKey } from '../src/data/filterKey.js'

// Run the real browser Worker pipeline with Node's equivalent Parquet decoder.
// The transport is mocked to control response order and regional failures.
function startWorker({ filters = {}, failRegions = false } = {}) {
  const sourceURL = new URL('../src/workers/charging.worker.js', import.meta.url)
  let source = fs.readFileSync(sourceURL, 'utf8')
    .replace(/from '(\.\.\/[^']+)'/g, (_, relative) => `from '${new URL(relative, sourceURL).href}'`)
    .replace("import initWasm, { readParquet } from 'parquet-wasm/esm'", "import { createRequire } from 'node:module'; const { readParquet } = createRequire(ROOT)('parquet-wasm/node'); const initWasm = async () => {}")
    .replace("import wasmUrl from 'parquet-wasm/esm/parquet_wasm_bg.wasm?url'", "const wasmUrl = 'mock-wasm'")
  source = source.replace("from 'apache-arrow'", `from '${import.meta.resolve('apache-arrow')}'`)
  const root = new URL('../package.json', import.meta.url).href
  source = source.replace('createRequire(ROOT)', `createRequire(${JSON.stringify(root)})`)
  const preamble = `
    import { parentPort } from 'node:worker_threads';
    import fs from 'node:fs';
    globalThis.self = { postMessage: (message, transfers) => parentPort.postMessage(message, transfers) };
    globalThis.fetch = async url => {
      parentPort.postMessage({type:'fetch', url});
      if (url.includes('districts_')) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (${failRegions}) return {ok:false, status:503};
      }
      const bytes = fs.readFileSync(new URL(url, ${JSON.stringify(new URL('../public/data/', import.meta.url).href)}));
      return {ok:true, arrayBuffer:async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength), json:async () => JSON.parse(bytes.toString())};
    };
  `
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(preamble + source + '\nparentPort.on("message", data => self.onmessage({data}));')}`))
  const messages = [], waiters = []
  worker.on('message', message => { messages.push(message); for (const check of [...waiters]) check() })
  const waitFor = (type, predicate = () => true) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), 15000)
    const check = () => {
      const found = messages.find(message => message.type === type && predicate(message))
      if (!found) return
      clearTimeout(timer); waiters.splice(waiters.indexOf(check), 1); resolve(found)
    }
    waiters.push(check); check()
    worker.once('error', error => { clearTimeout(timer); reject(error) })
  })
  worker.postMessage({type:'load', zoom:5, filters, urls:{sites:'charging_sites_browser_zstd10.parquet', pointGroups:'charging_point_groups_zstd10.parquet', states:'states_bev_display_100m_string.parquet', districts:'districts_bev_display_100m_string.parquet', labels:'district_labels.json'}})
  return {worker, messages, waitFor}
}

test('initial selection keys ignore identity and normalize default values', () => {
  assert.equal(filterKey({}), filterKey({state:'', minPower:'0', dcOnly:false, alwaysOpen:false}))
  for (const filters of [{state:'Bayern'}, {minPower:150}, {dcOnly:true}, {alwaysOpen:true}]) assert.notEqual(filterKey(filters), filterKey({}))
})
test('initial loading starts all requests before ready, preserves counts and then supports filtering', async () => {
  const {worker,messages,waitFor} = startWorker()
  try {
    const ready = await waitFor('ready')
    assert.equal(ready.count,67680); assert.equal(ready.totalPoints,208570)
    assert.equal(messages.slice(0,messages.indexOf(ready)).filter(message => message.type === 'fetch').length,5)
    worker.postMessage({type:'detail',index:ready.rowIndices.at(-1)})
    const detail = (await waitFor('detail')).detail
    for (const field of ['city','operator','district_name','opening_hours_label','installed_power_kw','equipment_count']) assert.notEqual(detail[field], undefined)
    assert.ok(detail.available_power_kw.length > 0)
    const regions = await waitFor('regions')
    assert.equal(regions.states.length,16); assert.equal(regions.districts.length,400)
    await waitFor('performance', message => message.phase === 'Территории и аналитика готовы')
    const reports = messages.filter(message => message.type === 'performance')
    const sitesReport = reports.find(message => message.phase === 'Площадки готовы')
    assert.ok(!sitesReport.stages.some(stage => /^Декодирование: (земли|районы KBA)$/.test(stage.stage)))
    const regionsReport = reports.find(message => message.phase === 'Территории и аналитика готовы')
    assert.ok(regionsReport.stages.some(stage => stage.stage === 'Декодирование: земли'))
    assert.ok(regionsReport.stages.some(stage => stage.stage === 'Декодирование: районы KBA'))
    for (const level of [regions.states, regions.districts]) {
      assert.equal(level.reduce((sum, feature) => sum + feature.properties.points, 0), 208570)
      assert.equal(level.reduce((sum, feature) => sum + feature.properties.equipment, 0), 116108)
      assert.ok(Math.abs(level.reduce((sum, feature) => sum + feature.properties.installed_power_kw, 0) - 9067843.9) < 0.01)
    }
    assert.equal(reports.flatMap(message => message.stages).filter(stage => stage.stage === 'Расчёт выборки и аналитики').length,1)
    worker.postMessage({type:'filter',requestId:1,filters:{state:'Bayern',minPower:150,dcOnly:true}})
    const filtered = await waitFor('filtered')
    assert.equal(filtered.requestId,1); assert.ok(filtered.totalPoints > 0 && filtered.totalPoints < ready.totalPoints)
    assert.deepEqual(Object.keys(filtered.regionStats.states),['Bayern'])
  } finally { await worker.terminate() }
})
test('initial filters apply on first ready and regions failing do not discard sites', async () => {
  const filters = {state:'Brandenburg',minPower:150}
  const {worker,waitFor} = startWorker({filters,failRegions:true})
  try {
    const ready = await waitFor('ready')
    assert.deepEqual(ready.filters,filters); assert.deepEqual(Object.keys(ready.regionStats.states),['Brandenburg'])
    assert.ok(ready.count > 0 && ready.count < 1600)
    const error = await waitFor('error')
    assert.match(error.message,/Границы:.*503/)
  } finally { await worker.terminate() }
})
