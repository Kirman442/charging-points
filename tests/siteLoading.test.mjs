import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { tableFromIPC } from 'apache-arrow'
import { STARTUP_SITE_COLUMNS, BACKGROUND_DETAIL_COLUMNS, SITE_DETAIL_COLUMNS } from '../src/config/siteColumns.js'
import { fingerprint, readRuntimeIndexes } from '../src/data/runtimeIndexes.js'
import { validateDetails, siteDetail } from '../src/data/siteDetails.js'
import { selectPoints } from '../src/data/pointSelection.js'
import { prepareSites } from '../src/data/prepareSites.js'
const { readParquet } = createRequire(import.meta.url)('parquet-wasm/node')
const read = name => {
  const bytes = fs.readFileSync(new URL(`../public/data/${name}_zstd10.parquet`, import.meta.url))
  return { bytes, table: tableFromIPC(readParquet(bytes,{batchSize:16384}).intoIPCStream()) }
}
const source=read('charging_sites_browser'), startup=read('charging_sites_startup'), details=read('charging_site_details')
const groups=read('charging_point_groups_numeric'), catalog=read('charging_runtime_catalog')
const hashes={sites:await fingerprint(startup.bytes),details:await fingerprint(details.bytes),groups:await fingerprint(groups.bytes)}
const indexes=readRuntimeIndexes(startup.table,groups.table,catalog.table,hashes)
const selected=selectPoints(startup.table,indexes.pointGroups,{},indexes.operatorIndex)

test('split files preserve every field type/value, exact source row order and final batch', () => {
  for (const [file,names] of [[startup,STARTUP_SITE_COLUMNS],[details,BACKGROUND_DETAIL_COLUMNS]]) {
    assert.equal(file.table.numRows,67680)
    assert.deepEqual(file.table.schema.fields.map(field=>field.name),names)
    for (const name of names) {
      const original=source.table.getChild(name), actual=file.table.getChild(name)
      assert.equal(actual.type.toString(),original.type.toString(),name)
      for (let row=0;row<source.table.numRows;row++) {
        const a=actual.get(row), b=original.get(row)
        assert.deepEqual(a?.toArray ? Array.from(a) : a,b?.toArray ? Array.from(b) : b,`${name} row ${row}`)
      }
    }
  }
  assert.ok(startup.bytes.length < source.bytes.length/2)
  assert.deepEqual(prepareSites(startup.table,selected.indices,selected),prepareSites(source.table,selected.indices,selected))
})
test('background cards preserve all original fields including final row and selected counters', () => {
  validateDetails(details.table,startup.table,catalog.table,hashes)
  for (let row=0;row<source.table.numRows;row++) {
    const actual=siteDetail(details.table,row,selected)
    for (const name of SITE_DETAIL_COLUMNS) assert.deepEqual(actual[name],source.table.getChild(name).get(row))
    assert.deepEqual(actual.available_power_kw,Array.from(source.table.getChild('available_power_kw').get(row)))
    assert.equal(actual.selected_point_count,selected.points[row])
  }
})
test('background file generation mismatch fails before a card can be attached', () => {
  assert.throws(()=>validateDetails(details.table,startup.table,catalog.table,{...hashes,details:'stale'}),/не соответствуют/)
  assert.throws(()=>validateDetails(details.table,startup.table,catalog.table,{...hashes,sites:'stale'}),/не соответствуют/)
  assert.throws(()=>validateDetails(details.table.slice(1),startup.table,catalog.table,hashes),/не соответствуют/)
  assert.throws(()=>readRuntimeIndexes(startup.table,groups.table,catalog.table,{...hashes,sites:catalog.table.schema.metadata.get('sites_sha256')}),/не соответствуют/)
})
