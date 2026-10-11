// Read-only validation of completed pipeline exports before browser delivery.
// No PBF, road graph, checkpoint mutation or routing is performed.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { parseArgs } from 'node:util'
import { readParquet } from 'parquet-wasm/node'
import { tableFromIPC } from 'apache-arrow'
import { decodeMotorwayModel } from '../src/data/motorwayModel.js'
import { hasAccessConditions } from '../src/data/autobahnAccess.js'

const { values } = parseArgs({ options: { source: { type: 'string' }, route: { type: 'string', default: 'A2' }, report: { type: 'string' }, definition: { type: 'string' } } })
assert.ok(values.source && values.report, 'Usage: node scripts/check_motorway_package.mjs --source PATH --report PATH [--definition PATH]')
const source = path.resolve(values.source), route = values.route
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const read = file => tableFromIPC(readParquet(fs.readFileSync(file)).intoIPCStream())
const numeric = r => Object.fromEntries(Object.entries(r.toJSON()).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value]))
const exportReport = json(path.join(source, 'parquet-export.json'))
const audit = json(path.join(source, 'audit.json')), binding = json(path.join(source, '..', 'run-binding.json'))
assert.equal(audit.route, route); assert.equal(exportReport.route, route)
assert.equal(hash(path.join(source, '..', 'run-binding.json')), audit.binding)
const registryFiles = { sites_startup: 'charging_sites_startup_zstd10.parquet', site_details: 'charging_site_details_zstd10.parquet', runtime_catalog: 'charging_runtime_catalog_zstd10.parquet', point_groups_numeric: 'charging_point_groups_numeric_zstd10.parquet' }
const registryHashes = Object.fromEntries(Object.entries(registryFiles).map(([key, file]) => [key, hash(path.join('public/data', file))]))
assert.deepEqual(binding.registry, registryHashes)
const inputs = Object.fromEntries(Object.entries(exportReport.input_sha256).map(([file, digest]) => { assert.equal(hash(path.join(source, file)), digest); return [file, digest] }))
const tables = {}, fileReport = {}
for (const kind of ['sites', 'intervals', 'routes', 'paths']) {
  const name = `autobahn_${route.toLowerCase()}_${kind}_zstd10.parquet`, file = path.join(source, name)
  const table = read(file), expected = exportReport.files[name]
  assert.equal(hash(file), expected.sha256); assert.equal(table.numRows, expected.rows)
  assert.equal(table.schema.metadata.get('table_kind'), kind)
  assert.deepEqual(JSON.parse(table.schema.metadata.get('run_binding_json')), binding)
  assert.deepEqual(JSON.parse(table.schema.metadata.get('input_sha256_json')), inputs)
  if (kind !== 'paths') assert.equal(hash(path.join('public/data', name)), expected.sha256)
  tables[kind] = table
  fileReport[name] = { ...expected, browser_asset: kind !== 'paths' }
}
const originalSites = json(path.join(source, 'sites.json'))
assert.deepEqual(Array.from(tables.sites, r => JSON.parse(r.source_row_json)), originalSites)
const originalIntervals = json(path.join(source, 'intervals.json'))
assert.deepEqual(Array.from(tables.intervals, r => { const row = numeric(r); delete row.route; delete row.geometry_json; return row }), originalIntervals)
const originalPaths = json(path.join(source, 'paths.geojson')).features
assert.equal(originalPaths.length, tables.paths.numRows)
const siteKey = s => `${s.direction}:${s.section ?? ''}:${s.site_row}`
const pathKeys = new Set(), siteMap = new Map(originalSites.map(s => [siteKey(s), s]))
Array.from(tables.paths, numeric).forEach((r, i) => {
  const key = `${siteKey(r)}:${r.leg}`, s = siteMap.get(siteKey(r))
  assert.ok(!pathKeys.has(key)); pathKeys.add(key)
  assert.ok(s?.road_route_found && s.site_id === r.site_id && ['arrival', 'return'].includes(r.leg))
  assert.equal(r.entrance_verified, false)
  assert.deepEqual(JSON.parse(r.geometry_json), originalPaths[i].geometry.coordinates)
  const { route: routeName, geometry_json: geometry, ...properties } = r
  assert.equal(routeName, route); assert.ok(geometry)
  assert.deepEqual(properties, originalPaths[i].properties)
})
for (const s of originalSites.filter(s => s.road_route_found)) for (const leg of ['arrival', 'return']) assert.ok(pathKeys.has(`${siteKey(s)}:${leg}`))
const definitionChainRoundoffM = {}
if (values.definition) {
  assert.equal(hash(values.definition), binding.definitions[route])
  const definition = json(values.definition)
  for (const row of tables.routes) {
    const expected = definition.routes.find(r => r.direction === row.direction && r.section == row.section)
    assert.deepEqual(JSON.parse(row.geometry_json), expected.coordinates)
    const chain = JSON.parse(row.chain_json)
    assert.equal(chain.length, expected.chain.length)
    let roundoff = 0
    for (let i = 0; i < chain.length; i++) {
      assert.ok(Number.isFinite(chain[i]) && Number.isFinite(expected.chain[i]))
      const difference = Math.abs(chain[i] - expected.chain[i])
      assert.ok(difference < 1e-7, `Definition chain differs at ${route}/${row.direction}/${row.section}/${i}`)
      roundoff = Math.max(roundoff, difference)
    }
    definitionChainRoundoffM[`${row.direction}:${row.section ?? ''}`] = roundoff
    assert.ok(Number.isFinite(expected.length_m) && Math.abs(row.length_m - expected.length_m) < 1e-7)
  }
}
const registry = read(path.join('public/data', registryFiles.sites_startup))
const model = decodeMotorwayModel(tables, registry, route, registryHashes)
if (model.diagnostic) {
  const diagnostic = json(path.join(source, '..', 'diagnostic-binding.json'))
  assert.equal(diagnostic.original_run_binding_sha256, audit.binding)
  assert.deepEqual(JSON.parse(tables.sites.schema.metadata.get('diagnostic_binding_json')), diagnostic)
}
for (const s of model.sections || model.summary) {
  const expected = audit.sections.find(r => r.direction === s.direction && r.section == s.section)
  for (const key of ['candidates', 'routed', 'eligible_routed', 'max_gap_km']) assert.equal(s[key], expected[key])
  assert.equal(s.unknown_segments, expected.unknown_intervals)
  if (model.diagnostic) for (const key of ['active_candidates', 'distance_excluded', 'unresolved']) assert.equal(s[key], expected[key])
}
const report = { route, routing_performed: false, pbf_read: false, source_modified: false, definition_chain_roundoff_m: definitionChainRoundoffM, registry_hashes: registryHashes, run_binding_sha256: hash(path.join(source, '..', 'run-binding.json')), upstream_binding: audit.binding, input_hashes: inputs, tables: fileReport, known_intervals_checked: model.segments.filter(s => s.status !== 'unknown').length, sections: model.sections, summaries: model.summary.map(s => ({ ...s, access_condition_cases: model.sites.filter(r => r.direction === s.direction && hasAccessConditions(r)).length })), model_decoder_sha256: hash('src/data/motorwayModel.js'), validation_script_sha256: hash(new URL(import.meta.url)) }
fs.writeFileSync(values.report, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
