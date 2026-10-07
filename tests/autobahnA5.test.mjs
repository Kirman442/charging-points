import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import initWasm, { readParquet } from 'parquet-wasm/esm'
import { tableFromIPC } from 'apache-arrow'
import { AUTOBAHNS,decodeAutobahn,autobahnDisplayData } from '../src/data/autobahn.js'
await initWasm(fs.readFileSync('node_modules/parquet-wasm/esm/parquet_wasm_bg.wasm'))
const table=tableFromIPC(readParquet(fs.readFileSync('public/data/autobahn_a5_zstd10.parquet')).intoIPCStream())
const hash=createHash('sha256').update(fs.readFileSync('public/data/charging_sites_startup_zstd10.parquet')).digest('hex')
const pilot=decodeAutobahn(table,hash,67680,'A5')
test('A5 exports both directions, with the shared 3/3 km policy',()=>{
  assert.ok(AUTOBAHNS.A5)
  assert.deepEqual(pilot.summary.map(s=>[s.direction,s.routed,s.eligible_routed,s.max_gap_km]),[['north',432,81,49.8],['south',389,80,41.3]])
  assert.ok(pilot.sites.some(s=>s.status==='distance_excluded'))
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


test('A5 hides distant sites even with the review checkbox, while preserving unresolved sites',()=>{
  for(const direction of ['north','south']) {
    const sites=pilot.sites.filter(s=>s.direction===direction)
    const data={count:sites.length,rowIndices:Uint32Array.from(sites,s=>s.site_row),positions:new Float64Array(sites.length*2),colors:new Uint8Array(sites.length*4),powers:new Float32Array(sites.length),pointCounts:new Int32Array(sites.length)}
    const summary=pilot.summary.find(s=>s.direction===direction)
    const before=JSON.stringify(pilot)
    const routed=autobahnDisplayData(data,pilot,direction,true,'routed')
    const all=autobahnDisplayData(data,pilot,direction,true,'all')
    assert.equal(routed.count,summary.routed)
    assert.equal(all.count,summary.active_candidates)
    assert.equal(all.autobahnEligible.reduce((a,b)=>a+b,0),summary.eligible_routed)
    const excluded=new Set(sites.filter(s=>s.status==='distance_excluded').map(s=>s.site_row))
    assert.ok([...all.rowIndices].every(row=>!excluded.has(row)))
    const focus=[...excluded][0]
    assert.ok(![...autobahnDisplayData(data,pilot,direction,false,'all',focus).rowIndices].includes(focus))
    assert.equal(JSON.stringify(pilot),before)
  }
})
test('Intermediate rest-area branches remain in both directional searches',()=>{
  for(const direction of ['north','south']) {
    const exits=pilot.exits.filter(e=>e.direction===direction)
    assert.equal(exits.length,130)
    assert.ok(exits.some(e=>e.kind==='rest_area'))
  }
  assert.ok(pilot.exits.some(e=>e.direction==='south' && e.node===60013734 && e.kind==='rest_area'))
  for(const row of [31830,31833,31839]) assert.equal(pilot.sites.find(s=>s.direction==='south' && s.site_row===row).status,'distance_excluded')
})
