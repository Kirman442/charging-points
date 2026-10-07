import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import initWasm, { readParquet } from 'parquet-wasm/esm'
import { tableFromIPC } from 'apache-arrow'
import { createHash } from 'node:crypto'
import { decodeAutobahn, autobahnDisplayData, autobahnSiteRadius, autobahnIntervalSite } from '../src/data/autobahn.js'
await initWasm(fs.readFileSync('node_modules/parquet-wasm/esm/parquet_wasm_bg.wasm'))
const parquet = path => tableFromIPC(readParquet(fs.readFileSync(path)).intoIPCStream())
const startup = fs.readFileSync('public/data/charging_sites_startup_zstd10.parquet')
const hash = createHash('sha256').update(startup).digest('hex')
const table = parquet('public/data/autobahn_a9_zstd10.parquet')
const pilot = decodeAutobahn(table, hash, 67680)
test('A9 numeric links are bound to the exact startup file and row count', () => {
  assert.throws(() => decodeAutobahn(table, 'stale-file',67680))
  assert.throws(() => decodeAutobahn(table, hash,67679))
  assert.equal(pilot.summary.length,2)
  for (const route of pilot.summary) assert.ok(route.length_km > 500 && route.length_km < 550)
})
test('Without the access network the pilot makes no green/red gap claims', () => {
  if (!pilot.accessNetwork) {
    assert.ok(pilot.segments.every(s => s.status === 'unknown'))
    assert.ok(pilot.sites.every(s => s.status === 'unconfirmed'))
    assert.ok(pilot.summary.every(s => s.max_gap_km === null && s.routed === 0))
  }
})
test('Direction dimming/hiding preserves numeric click indices and original buffers', () => {
  const data = { count:3, rowIndices:new Uint32Array([10,20,30]), positions:new Float64Array([1,2,3,4,5,6]), colors:new Uint8Array(12).fill(255), powers:new Float32Array([22,150,350]), pointCounts:new Int32Array([1,2,3]) }
  const p = { sites:[{direction:'north',site_row:20,status:'unconfirmed'},{direction:'south',site_row:30,status:'road_route_found_entrance_unverified'}] }
  const north = autobahnDisplayData(data,p,'north',true,'all')
  assert.deepEqual([...north.rowIndices],[20]);assert.deepEqual([...north.positions],[3,4])
  assert.deepEqual([...north.pointCounts],[2]);assert.equal(north.colors[3],235)
  const south = autobahnDisplayData(data,p,'south',false,'all')
  assert.deepEqual([...south.rowIndices],[10,20,30]);assert.equal(south.colors[3],12);assert.equal(south.colors[11],255)
  assert.ok(data.colors.every(v => v === 255));assert.equal(data.count,3)
})
test('Checked A9 snapshot keeps directional links and preliminary gaps separate from unknown endpoints', () => {
  assert.equal(pilot.accessNetwork, true)
  assert.deepEqual(pilot.summary.map(s => [s.direction,s.routed,s.fast_routed,s.eligible_routed]), [['north',282,127,83],['south',302,137,85]])
  const north = new Set(pilot.sites.filter(s => s.direction === 'north' && s.status === 'road_route_found_entrance_unverified').map(s => s.site_row))
  const south = new Set(pilot.sites.filter(s => s.direction === 'south' && s.status === 'road_route_found_entrance_unverified').map(s => s.site_row))
  assert.equal([...north].filter(row => south.has(row)).length,241)
  for (const direction of ['north','south']) {
    const segments = pilot.segments.filter(s => s.direction === direction)
    assert.equal(segments[0].status,'unknown')
    const endHasCandidate = pilot.sites.some(s => s.direction === direction && s.eligible_power && s.status === 'road_route_found_entrance_unverified' && Math.abs(s.chain_m-segments.at(-1).end_m) < 0.01)
    if (!endHasCandidate) assert.equal(segments.at(-1).status,'unknown')
    assert.ok(segments.some(s => s.status === 'within'))
    for(let i=1;i<segments.length;i++) assert.equal(segments[i].chain_m,segments[i-1].end_m)
  }
})
test('Decoder rejects route distances beyond limits and summary/link mismatches', () => {
  const rows = [...table].map(r => r.toJSON())
  const checked = rows.findIndex(r => r.status === 'road_route_found_entrance_unverified')
  const fake = records => ({schema: table.schema, *[Symbol.iterator]() { for (const row of records) yield {toJSON: () => row} }})
  const changed = rows.map((r,i) => i === checked ? {...r,return_m:3001} : r)
  assert.throws(() => decodeAutobahn(fake(changed),hash,67680))
  assert.throws(() => decodeAutobahn(fake(rows.filter((_,i) => i!==checked)),hash,67680))
})
test('Autobahn shows every routed site by default and optionally adds unrouted candidates', () => {
  const data={count:3,rowIndices:new Uint32Array([10,20,30]),positions:new Float64Array([1,2,3,4,5,6]),colors:new Uint8Array(12),powers:new Float32Array([22,150,300]),pointCounts:new Int32Array([1,2,3])}
  const pilot={sites:[{direction:'north',site_row:10,status:'road_route_found_entrance_unverified',fast_points:0,power_kw:22},{direction:'north',site_row:20,status:'unconfirmed',fast_points:1,power_kw:600},{direction:'north',site_row:30,status:'road_route_found_entrance_unverified',fast_points:2,power_kw:400}]}
  assert.equal(autobahnDisplayData(data,pilot,'north',false,'none').count,0)
  assert.deepEqual([...autobahnDisplayData(data,pilot,'north',true,'routed').rowIndices],[10,30])
  assert.deepEqual([...autobahnDisplayData(data,pilot,'north',true,'all').rowIndices],[10,20,30])
  assert.deepEqual([...autobahnDisplayData(data,pilot,'north',true,'none',20).rowIndices],[20])
  assert.equal(data.count,3)
})

test('Display toggle preserves interval results and marks only eligible routed sites', () => {
  const sites = pilot.sites.filter(s => s.direction === 'north')
  const data = {count:sites.length,rowIndices:Uint32Array.from(sites,s=>s.site_row),positions:new Float64Array(sites.length*2),colors:new Uint8Array(sites.length*4),powers:new Float32Array(sites.length),pointCounts:new Int32Array(sites.length)}
  const before = JSON.stringify(pilot)
  const routed = autobahnDisplayData(data,pilot,'north',true)
  const all = autobahnDisplayData(data,pilot,'north',true,'all')
  assert.equal(routed.count,282)
  assert.equal(all.count,974)
  assert.equal(routed.autobahnEligible.reduce((a,b)=>a+b,0),83)
  assert.equal(all.autobahnEligible.reduce((a,b)=>a+b,0),83)
  assert.equal(JSON.stringify(pilot),before)
  assert.equal(autobahnIntervalSite({status:'unconfirmed',power_kw:1000,fast_points:2}),false)
  assert.equal(autobahnIntervalSite({status:'road_route_found_entrance_unverified',power_kw:399,fast_points:2}),false)
})
test('Autobahn marker radii increase smoothly with zoom and stay bounded', () => {
  assert.ok(autobahnSiteRadius(5.7) < autobahnSiteRadius(8))
  assert.ok(autobahnSiteRadius(8) < autobahnSiteRadius(12))
  assert.ok(autobahnSiteRadius(12) < autobahnSiteRadius(14))
  assert.equal(autobahnSiteRadius(0),0.8)
  assert.equal(autobahnSiteRadius(24),7)
})
