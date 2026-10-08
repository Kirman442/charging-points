import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import initWasm, { readParquet } from 'parquet-wasm/esm'
import { tableFromIPC } from 'apache-arrow'
import { decodeAutobahn, autobahnDisplayData, autobahnIntervalSite } from '../src/data/autobahn.js'

await initWasm(fs.readFileSync('node_modules/parquet-wasm/esm/parquet_wasm_bg.wasm'))
const hash = createHash('sha256').update(fs.readFileSync('public/data/charging_sites_startup_zstd10.parquet')).digest('hex')

for (const route of ['A1', 'A9']) {
  const table = tableFromIPC(readParquet(fs.readFileSync(`public/data/autobahn_${route.toLowerCase()}_zstd10.parquet`)).intoIPCStream())
  const pilot = decodeAutobahn(table, hash, 67680, route)
  test(`${route}: exit-zone totals match visibility and power subsets in each direction`, () => {
    assert.equal(pilot.candidateMethod, 'all-exits-road-zones-v1')
    const audit = JSON.parse(fs.readFileSync(`data_sources/${route.toLowerCase()}/pilot-3km-audit.json`))
    assert.deepEqual(pilot.summary, audit.directions)
    for (const summary of pilot.summary) {
      const sites = pilot.sites.filter(s => s.direction === summary.direction)
      const data = {count: sites.length, rowIndices: Uint32Array.from(sites, s => s.site_row), positions: new Float64Array(sites.length*2), colors: new Uint8Array(sites.length*4), powers: new Float32Array(sites.length), pointCounts: new Int32Array(sites.length)}
      const normal = autobahnDisplayData(data, pilot, summary.direction, true)
      const review = autobahnDisplayData(data, pilot, summary.direction, true, 'all')
      assert.equal(normal.count, summary.routed)
      assert.equal(review.count, summary.routed + summary.unresolved)
      assert.equal(review.count, summary.active_candidates)
      assert.equal(normal.autobahnEligible.reduce((a,b) => a+b, 0), summary.eligible_routed)
      assert.equal(review.autobahnEligible.reduce((a,b) => a+b, 0), summary.eligible_routed)
      assert.equal(sites.filter(s => s.status === 'road_route_found_entrance_unverified' && s.fast_points > 0).length, summary.fast_routed)
      const excluded = sites.find(s => s.status === 'distance_excluded')
      assert.ok(excluded)
      assert.ok(!autobahnDisplayData(data, pilot, summary.direction, true, 'all', excluded.site_row).rowIndices.includes(excluded.site_row))
    }
  })
  test(`${route}: known intervals use only eligible routed sites from the same section`, () => {
    for (const segment of pilot.segments.filter(s => s.status !== 'unknown')) {
      const eligible = pilot.sites.filter(s => s.direction === segment.direction && s.section === segment.section && autobahnIntervalSite(s))
      const first = eligible.filter(s => Math.abs(s.chain_m-segment.chain_m) < 0.001)
      const next = eligible.filter(s => Math.abs(s.chain_m-segment.end_m) < 0.001)
      const distances = first.flatMap(a => next.filter(b => a.entry_chain_m <= b.chain_m).map(b => (a.return_m + b.chain_m - a.entry_chain_m + b.access_m)/1000))
      assert.ok(distances.length)
      assert.ok(Math.abs(segment.gap_km-Math.min(...distances)) < 1e-8)
    }
  })
}
