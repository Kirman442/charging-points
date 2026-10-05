import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { tableFromIPC, tableFromArrays, tableToIPC } from 'apache-arrow'
import { readProjectedTable } from '../src/data/readProjectedTable.js'
import { SITE_COLUMNS } from '../src/config/siteColumns.js'
import { buildOperatorIndex } from '../src/data/operators.js'
import { buildPointGroups, selectPoints } from '../src/data/pointSelection.js'
import { prepareSites } from '../src/data/prepareSites.js'
const { readParquet, ParquetFile, readSchema, writeParquet, Table: WasmTable } = createRequire(import.meta.url)('parquet-wasm/node')
const bytes = fs.readFileSync(new URL('../public/data/charging_sites_zstd10.parquet', import.meta.url))
const full = tableFromIPC(readParquet(bytes, {batchSize:16384}).intoIPCStream())
const projected = await readProjectedTable(bytes, SITE_COLUMNS, {ParquetFile,readSchema})
const values = column => Array.from(column, value => value?.toArray ? Array.from(value.toArray()) : value)

test('projection preserves every value, type, ID and final partial batch in the 21 consumed columns', () => {
  assert.equal(full.numCols,30); assert.equal(projected.numCols,21)
  assert.equal(projected.numRows,full.numRows)
  assert.deepEqual(projected.schema.fields.map(field => field.name).sort(), [...SITE_COLUMNS].sort())
  assert.equal(projected.batches.at(-1).numRows,2144)
  for (const name of SITE_COLUMNS) {
    assert.equal(String(projected.getChild(name).type),String(full.getChild(name).type))
    assert.deepEqual(values(projected.getChild(name)),values(full.getChild(name)),name)
  }
})
test('projected tables preserve map buffers and all analytics through combined and empty filters', () => {
  const groupBytes = fs.readFileSync(new URL('../public/data/charging_point_groups_zstd10.parquet', import.meta.url))
  const cohorts = tableFromIPC(readParquet(groupBytes,{batchSize:16384}).intoIPCStream())
  const a = buildPointGroups(full,cohorts), b = buildPointGroups(projected,cohorts)
  const oa = buildOperatorIndex(full), ob = buildOperatorIndex(projected)
  assert.deepEqual(b,a); assert.deepEqual(ob,oa)
  for (const filters of [{},{state:'Bayern'},{minPower:150,dcOnly:true},{state:'Nordrhein-Westfalen',minPower:50,alwaysOpen:true},{minPower:1e9}]) {
    const sa=selectPoints(full,a,filters,oa),sb=selectPoints(projected,b,filters,ob)
    assert.deepEqual(sb,sa)
    assert.deepEqual(prepareSites(projected,sb.indices,sb),prepareSites(full,sa.indices,sa))
  }
})
test('projection retains the schema of an empty file and rejects missing requested columns', async () => {
  const empty = tableFromArrays({id:[]})
  const emptyBytes = writeParquet(WasmTable.fromIPCStream(tableToIPC(empty)))
  const result = await readProjectedTable(emptyBytes,['id'],{ParquetFile,readSchema})
  assert.equal(result.numRows,0); assert.ok(result.getChild('id'))
  await assert.rejects(readProjectedTable(bytes,['site_id','absent_column'],{ParquetFile,readSchema}),/Отсутствует колонка absent_column/)
})
