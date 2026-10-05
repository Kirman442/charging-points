import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { tableFromIPC, tableFromArrays } from 'apache-arrow'
import { fingerprint, readRuntimeIndexes } from '../src/data/runtimeIndexes.js'
import { buildPointGroups, selectPoints } from '../src/data/pointSelection.js'
import { buildOperatorIndex } from '../src/data/operators.js'
import { prepareSites } from '../src/data/prepareSites.js'
const { readParquet } = createRequire(import.meta.url)('parquet-wasm/node')
const read = name => {
  const bytes = fs.readFileSync(new URL(`../public/data/${name}_zstd10.parquet`, import.meta.url))
  return { bytes, table: tableFromIPC(readParquet(bytes, { batchSize: 16384 }).intoIPCStream()) }
}
const sites = read('charging_sites_browser'), raw = read('charging_point_groups')
const numeric = read('charging_point_groups_numeric'), catalog = read('charging_runtime_catalog')
const hashes = { sites: await fingerprint(sites.bytes), groups: await fingerprint(numeric.bytes) }
const indexes = readRuntimeIndexes(sites.table, numeric.table, catalog.table, hashes)
const referenceGroups = buildPointGroups(sites.table, raw.table), referenceOperators = buildOperatorIndex(sites.table)

test('offline joins, operator normalization and source row identity equal the original string-based indexes', () => {
  for (const key of Object.keys(referenceGroups)) assert.deepEqual(indexes.pointGroups[key], referenceGroups[key], key)
  assert.deepEqual(indexes.operatorIndex, referenceOperators)
  const states = sites.table.getChild('state_name'), hours = sites.table.getChild('opening_hours_type')
  for (let row = 0; row < sites.table.numRows; row++) {
    assert.equal(indexes.pointGroups.stateNames[indexes.pointGroups.siteStates[row]], states.get(row))
    assert.equal(indexes.pointGroups.alwaysOpen[row], Number(hours.get(row) === '24_7'))
  }
  assert.ok(numeric.bytes.byteLength + catalog.bytes.byteLength < raw.bytes.byteLength)
})
test('precomputed numeric indexes preserve all analytics and rendering under every state and power/DC/hours filters', () => {
  const filters = [ {}, ...indexes.pointGroups.stateNames.map(state => ({state})),
    ...[0,11,22,50,100,150,300,500,1e9].map(minPower => ({minPower})),
    {dcOnly:true}, {alwaysOpen:true}, {state:'Bayern',minPower:150,dcOnly:true,alwaysOpen:true},
    {state:'Nordrhein-Westfalen',minPower:50,alwaysOpen:true}, {state:'absent'}, {minPower:'150',dcOnly:true},
  ]
  for (const filter of filters) {
    const a = selectPoints(sites.table, referenceGroups, filter, referenceOperators)
    const b = selectPoints(sites.table, indexes.pointGroups, filter, indexes.operatorIndex)
    assert.deepEqual(b, a, JSON.stringify(filter))
    assert.deepEqual(prepareSites(sites.table,b.indices,b),prepareSites(sites.table,a.indices,a))
  }
})
test('mixed dataset generations and invalid numeric links fail explicitly', () => {
  assert.throws(() => readRuntimeIndexes(sites.table,numeric.table,catalog.table,{...hashes,sites:'stale'}),/не соответствуют/)
  assert.throws(() => readRuntimeIndexes(sites.table,numeric.table,catalog.table,{...hashes,groups:'stale'}),/не соответствуют/)
  const modified = (name, row, value) => {
    const columns = Object.fromEntries(numeric.table.schema.fields.map(field => [field.name, numeric.table.getChild(field.name).toArray().slice()]))
    columns[name][row] = value
    const result = tableFromArrays(columns)
    for (const [key,value] of numeric.table.schema.metadata) result.schema.metadata.set(key,value)
    return result
  }
  for (const [name,value] of [['site_row',sites.table.numRows],['equipment_index',referenceGroups.equipmentCount],
    ['district_index',referenceGroups.codes.length],['operator_index',referenceOperators.names.length],
    ['state_index',indexes.pointGroups.stateNames.length],['point_count',0],['has_dc',2],['max_power_kw',NaN]]) {
    assert.throws(() => readRuntimeIndexes(sites.table,modified(name,0,value),catalog.table,hashes),/не соответствуют/,name)
  }
  const duplicate = indexes.pointGroups.rows.findIndex((row, i, rows) => i > 0 && row === rows[i - 1])
  const firstRow = indexes.pointGroups.rows[duplicate]
  assert.ok(duplicate > 0)
  const wrongOperator = (indexes.operatorIndex.ids[firstRow]+1)%referenceOperators.names.length
  assert.throws(() => readRuntimeIndexes(sites.table,modified('operator_index',duplicate,wrongOperator),catalog.table,hashes),/не соответствуют/)
})
