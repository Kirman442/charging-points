import fs from 'node:fs'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import test from 'node:test'
import { tableFromIPC } from 'apache-arrow'
import { prepareSites, matchingIndices } from '../src/data/prepareSites.js'
import { buildClusters, clusterMarkers, markerTransfers } from '../src/data/clusters.js'
import { createLayers } from '../src/map/layers.js'
import { markersForView } from '../src/config/clustering.js'
import { DEFAULT_OPTIONS } from '../src/map/settings.js'
import { markerSelection, mapCursor, ChargingMapController } from '../src/map/interaction.js'
const { readParquet } = createRequire(import.meta.url)('parquet-wasm/node')
const table = tableFromIPC(readParquet(new Uint8Array(fs.readFileSync(new URL('../public/data/charging_sites_zstd10.parquet', import.meta.url)))).intoIPCStream())
const sum = array => array.reduce((total, n) => total + n, 0)

test('clusters preserve all sites and charging points at every clustered zoom', () => {
  const sites = prepareSites(table), index = buildClusters(sites)
  for (let zoom = 0; zoom < 12; zoom++) {
    const markers = clusterMarkers(index, zoom)
    assert.equal(sum(markers.siteCounts), sites.count)
    assert.equal(sum(markers.pointCounts), sites.totalPoints)
    for (let i = 0; i < markers.count; i++) {
      if (markers.siteCounts[i] > 1) {
        assert.ok(markers.expansionZooms[i] > zoom && markers.expansionZooms[i] <= 12)
        const leaves = index.getLeaves(markers.clusterIds[i], Infinity)
        assert.equal(leaves.length, markers.siteCounts[i])
        assert.equal(Math.max(...leaves.map(f => f.properties.maxPower)), markers.powers[i])
      } else assert.equal(table.getChild('charging_point_count').get(markers.rowIndices[i]), markers.pointCounts[i])
    }
  }
  assert.equal(clusterMarkers(index, 12), null)
  assert.ok(clusterMarkers(index, 5).count < sites.count / 10)
})
test('filtered and empty selections have their own cluster counts and original row IDs', () => {
  for (const filters of [{ state: 'Nordrhein-Westfalen', minPower: 150, dcOnly: true, alwaysOpen: true }, { minPower: 1e9 }]) {
    const rows = matchingIndices(table, filters), sites = prepareSites(table, rows), index = buildClusters(sites)
    const markers = clusterMarkers(index, 11)
    assert.equal(sum(markers.siteCounts), rows.length)
    assert.equal(sum(markers.pointCounts), sites.totalPoints)
    for (let i = 0; i < markers.count; i++) {
      if (markers.siteCounts[i] === 1) assert.ok(rows.includes(markerSelection(markers, i).rowIndex))
    }
  }
})
test('cluster buffers survive transfer and map layers switch at the threshold without duplicated sites', () => {
  const sites = prepareSites(table), index = buildClusters(sites)
  const source = clusterMarkers(index, 5)
  const markers = structuredClone(source, { transfer: markerTransfers(source) })
  assert.equal(source.positions.byteLength, 0)
  assert.equal(sum(markers.pointCounts), 208570)
  const low = createLayers(sites, null, { ...DEFAULT_OPTIONS, showBoundaries: false }, markers, true).layers
  assert.deepEqual(low.map(layer => layer.id), ['charging-markers', 'cluster-labels'])
  assert.equal(low[0].props.data.length, markers.count)
  assert.equal(low[1].props.pickable, false)
  assert.deepEqual(createLayers(sites, null, { ...DEFAULT_OPTIONS, showBoundaries: false }, null, false).layers.map(layer => layer.id), ['charging-sites'])
  assert.equal(createLayers(sites, null, { ...DEFAULT_OPTIONS, showBoundaries: false, showSites: false }, markers, true).layers.length, 0)
})
test('clicks distinguish clusters from individual sites; cursor and double-click controller behave correctly', () => {
  const sites = prepareSites(table), markers = clusterMarkers(buildClusters(sites), 8)
  const cluster = Array.from(markers.siteCounts).findIndex(n => n > 1)
  const picked = markerSelection(markers, cluster)
  assert.equal(picked.type, 'cluster')
  assert.equal(picked.sites, markers.siteCounts[cluster])
  assert.equal(picked.points, markers.pointCounts[cluster])
  assert.equal(markerSelection(markers, -1), null)
  assert.equal(mapCursor({ isHovering: true }), 'pointer')
  assert.equal(mapCursor({ isDragging: true, isHovering: true }), 'grabbing')
  assert.equal(mapCursor({}), 'grab')
  assert.equal(ChargingMapController.prototype.handleEvent({ type: 'dblclick' }), false)
})

test('obsolete marker packets cannot replace a newer filter selection or zoom', () => {
  const markers = { count: 1 }, packet = { requestId: 7, zoom: 5, markers }
  assert.equal(markersForView(packet, { requestId: 7 }, 5.9), markers)
  assert.equal(markersForView(packet, { requestId: 8 }, 5), null)
  assert.equal(markersForView(packet, { requestId: 7 }, 6), null)
  assert.equal(markersForView(null, null, 5), null)
})
test('coincident sites aggregate power and charging points and ungroup at zoom 12', () => {
  const sites = { count: 2, positions: new Float64Array([10,51,10,51]), powers: new Float32Array([22,400]), pointCounts: new Int32Array([2,8]), rowIndices: new Uint32Array([0,60000]) }
  const index = buildClusters(sites), markers = clusterMarkers(index, 11)
  assert.equal(markers.count, 1)
  assert.equal(markers.siteCounts[0], 2)
  assert.equal(markers.pointCounts[0], 10)
  assert.equal(markers.powers[0], 400)
  assert.equal(markers.expansionZooms[0], 12)
  assert.equal(clusterMarkers(index, 12), null)
  assert.deepEqual(index.getClusters([-180,-85,180,85], 12).map(f => f.properties.rowIndex).sort((a,b) => a-b), [0,60000])
})
