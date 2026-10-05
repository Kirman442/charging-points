// Processing-only comparison: no network, browser initialization or GPU work.
import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'
import { tableFromIPC } from 'apache-arrow'
const {readParquet}=createRequire(import.meta.url)('parquet-wasm/node')
const files=Object.fromEntries(['browser','startup'].map(name=>[name,fs.readFileSync(new URL(`../public/data/charging_sites_${name}_zstd10.parquet`,import.meta.url))]))
function decode(name) {
  const start=performance.now()
  const ipc=readParquet(files[name],{batchSize:16384}).intoIPCStream()
  const table=tableFromIPC(ipc)
  return {ms:Math.round(performance.now()-start),ipcBytes:ipc.byteLength,rows:table.numRows}
}
// Warm both paths, then alternate execution order.
decode('browser');decode('startup')
const rows=[]
for(let round=0;round<3;round++) {
  const row={round:round+1}
  for(const name of round%2 ? ['startup','browser'] : ['browser','startup']) {
    const result=decode(name)
    row[`${name}Ms`]=result.ms;row[`${name}IPCBytes`]=result.ipcBytes
    if(result.rows!==67680) throw new Error('Unexpected row count')
  }
  rows.push(row)
}
console.table(rows)
