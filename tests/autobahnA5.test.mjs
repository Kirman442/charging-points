import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import initWasm, { readParquet } from 'parquet-wasm/esm'
import { tableFromIPC } from 'apache-arrow'
import { AUTOBAHNS,decodeAutobahn } from '../src/data/autobahn.js'
await initWasm(fs.readFileSync('node_modules/parquet-wasm/esm/parquet_wasm_bg.wasm'))
const table=tableFromIPC(readParquet(fs.readFileSync('public/data/autobahn_a5_zstd10.parquet')).intoIPCStream())
const hash=createHash('sha256').update(fs.readFileSync('public/data/charging_sites_startup_zstd10.parquet')).digest('hex')
const pilot=decodeAutobahn(table,hash,67680,'A5')
test('A5 exports both directions, with the shared 3/3 km policy',()=>{
  assert.ok(AUTOBAHNS.A5)
  assert.deepEqual(pilot.summary.map(s=>[s.direction,s.routed,s.eligible_routed,s.max_gap_km]),[['north',408,75,70.2],['south',375,74,41.3]])
  assert.ok(pilot.sites.some(s=>s.review_reason==='return_exceeds_pilot_3km'))
  assert.ok(pilot.sites.some(s=>s.status==='unconfirmed' && s.review_detail))
  assert.throws(()=>decodeAutobahn(table,hash,67680,'A9'))
  for(const s of pilot.sites.filter(s=>s.status==='road_route_found_entrance_unverified')) {
    assert.ok(s.access_m<=3000 && s.return_m<=3000 && s.snap_m<=60)
  }
})
test('decoder rejects a stale shared routing policy',()=>{
  const metadata=new Map(table.schema.metadata);metadata.set('routing_policy','old-10km')
  assert.throws(()=>decodeAutobahn({schema:{metadata},*[Symbol.iterator](){yield* table}},hash,67680,'A5'))
})
