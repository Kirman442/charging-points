// Compare index attachment and analytics after decoding; no network, WASM init or file decoding included.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { tableFromIPC } from 'apache-arrow'
import { buildPointGroups, selectPoints } from '../src/data/pointSelection.js'
import { buildOperatorIndex } from '../src/data/operators.js'
import { readRuntimeIndexes, fingerprint } from '../src/data/runtimeIndexes.js'
const { readParquet } = createRequire(import.meta.url)('parquet-wasm/node')
const read = name => {
  const bytes = fs.readFileSync(new URL(`../public/data/${name}_zstd10.parquet`, import.meta.url))
  return { bytes, table: tableFromIPC(readParquet(bytes, { batchSize: 16384 }).intoIPCStream()) }
}
const s = read('charging_sites_browser'), a = read('charging_point_groups')
const n = read('charging_point_groups_numeric'), c = read('charging_runtime_catalog')
const hashes = { sites: await fingerprint(s.bytes), groups: await fingerprint(n.bytes) }
const run = numeric => {
  const start = performance.now()
  const indexes = numeric ? readRuntimeIndexes(s.table,n.table,c.table,hashes)
    : { pointGroups: buildPointGroups(s.table,a.table), operatorIndex: buildOperatorIndex(s.table) }
  const attached = performance.now()
  selectPoints(s.table,indexes.pointGroups,{},indexes.operatorIndex)
  return { indexesMs: Math.round(attached-start), analyticsMs: Math.round(performance.now()-attached) }
}
const results = []
for (let round=0;round<3;round++) {
  const order = round%2 ? [true,false] : [false,true], row = { round:round+1 }
  for (const numeric of order) { const result = run(numeric); row[numeric?'numericIndexMs':'originalIndexMs']=result.indexesMs; row[numeric?'numericAnalyticsMs':'originalAnalyticsMs']=result.analyticsMs }
  results.push(row)
}
console.table(results)
