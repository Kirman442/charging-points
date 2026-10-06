import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import initWasm, { readParquet } from 'parquet-wasm/esm'
import { tableFromIPC } from 'apache-arrow'
import { decodeAutobahn } from '../src/data/autobahn.js'
await initWasm(fs.readFileSync('node_modules/parquet-wasm/esm/parquet_wasm_bg.wasm'))
const table = tableFromIPC(readParquet(fs.readFileSync('public/data/autobahn_a1_zstd10.parquet')).intoIPCStream())
const hash = createHash('sha256').update(fs.readFileSync('public/data/charging_sites_startup_zstd10.parquet')).digest('hex')
const pilot = decodeAutobahn(table,hash,67680,'A1')
test('A1 cannot be substituted for A9 and stale startup inputs fail', () => {
  assert.throws(() => decodeAutobahn(table,hash,67680,'A9'))
  assert.throws(() => decodeAutobahn(table,'stale',67680,'A1'))
  assert.equal(pilot.sections.length,4)
})
test('A1 intervals stop at section boundaries and never cross the real Eifel gap', () => {
  for (const section of ['northern','southern']) for (const direction of ['north','south']) {
    const segments = pilot.segments.filter(s => s.section === section && s.direction === direction)
    assert.ok(segments.length > 0)
    assert.equal(segments[0].chain_m,0)
    for(let i=1;i<segments.length;i++) assert.equal(segments[i].chain_m,segments[i-1].end_m)
    for (const segment of segments) {
      assert.ok(segment.path.every(p => section === 'northern' ? p[1] >= 50.45 : p[1] <= 50.28))
      if(segment.status !== 'unknown') {
        const starts = pilot.sites.filter(s => s.section === section && s.direction === direction && s.eligible_power && s.status === 'road_route_found_entrance_unverified').map(s => s.chain_m)
        assert.ok(starts.some(x => Math.abs(x-segment.chain_m)<0.01))
        assert.ok(starts.some(x => Math.abs(x-segment.end_m)<0.01))
      }
    }
  }
})
