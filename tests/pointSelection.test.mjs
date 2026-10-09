import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { tableFromArrays, tableFromIPC } from 'apache-arrow'
import { buildPointGroups, selectPoints, powerBand } from '../src/data/pointSelection.js'
import { buildOperatorIndex } from '../src/data/operators.js'
import { prepareSites } from '../src/data/prepareSites.js'
import { createLayers } from '../src/map/layers.js'
const { readParquet } = createRequire(import.meta.url)('parquet-wasm/node')
const read = name => tableFromIPC(readParquet(new Uint8Array(fs.readFileSync(new URL(`../public/data/${name}_zstd10.parquet`, import.meta.url)))).intoIPCStream())
const sites = read('charging_sites'), raw = read('charging_points'), groups = buildPointGroups(sites, read('charging_point_groups')), operators = buildOperatorIndex(sites)
const close = (a,b) => assert.ok(Math.abs(a-b)<0.001,`${a} != ${b}`)
test('band edges are exclusive and exactly cover 22, 50 and 150', () => {
  assert.deepEqual([0,22,22.1,49.9,50,149.9,150,400].map(powerBand),[0,0,1,1,2,2,3,3])
})
test('point/DC conjunction retains sites, counts matching points and whole equipment once', () => {
  const s=tableFromArrays({site_id:['S'],state_name:['A'],max_power_kw:[300],dc_point_count:[1],opening_hours_type:['24_7'],operator:['O']})
  const make=(powers,dc)=>buildPointGroups(s,tableFromArrays({site_id:['S','S'],equipment_id:['E','E'],district_code:['01','01'],max_power_kw:powers,has_dc:dc,point_count:[1,1],equipment_power_kw:[300,300]}))
  const op=buildOperatorIndex(s)
  const chosen=selectPoints(s,make([22,150],[false,true]),{minPower:150},op)
  assert.deepEqual(chosen.indices,[0])
  assert.equal(chosen.points[0],1)
  assert.equal(chosen.nominal[0],300)
  assert.equal(chosen.equipmentCounts[0],1)
  assert.deepEqual(chosen.stats.states.A.powerBands,[0,0,0,1])
  assert.equal(selectPoints(s,make([300,22],[false,true]),{minPower:150,dcOnly:true},op).indices.length,0)
})
test('compact selection reconciles with independent raw-point and distinct-equipment counting', () => {
  const siteById=new Map(Array.from(sites.getChild('site_id'),(id,row)=>[id,row]))
  const c=Object.fromEntries(['site_id','equipment_id','max_power_kw','has_dc','equipment_power_kw'].map(n=>[n,raw.getChild(n)]))
  const state=sites.getChild('state_name'),hours=sites.getChild('opening_hours_type')
  for(const filters of [{},{minPower:150},{minPower:300,dcOnly:true},{dcOnly:true},{state:'Bayern',minPower:50,alwaysOpen:true},{minPower:1e9}]) {
    let expectedPoints=0,expectedPower=0
    const equipment=new Set(),expectedSites=new Set(),bands=[0,0,0,0]
    for(let i=0;i<raw.numRows;i++) {
      const row=siteById.get(c.site_id.get(i)),power=c.max_power_kw.get(i)
      if(filters.state && state.get(row)!==filters.state)continue
      if(filters.alwaysOpen && hours.get(row)!=='24_7')continue
      if(power<(filters.minPower||0) || (filters.dcOnly && !c.has_dc.get(i)))continue
      expectedPoints++;expectedSites.add(row);bands[powerBand(power)]++
      const eid=c.equipment_id.get(i)
      if(!equipment.has(eid)){equipment.add(eid);expectedPower+=c.equipment_power_kw.get(i)}
    }
    const result=selectPoints(sites,groups,filters,operators),render=prepareSites(sites,result.indices,result)
    assert.equal(render.totalPoints,expectedPoints)
    assert.equal(render.count,expectedSites.size)
    for(const level of ['states','districts']) {
      const totals=Object.values(result.stats[level])
      assert.equal(totals.reduce((n,v)=>n+v.points,0),expectedPoints)
      assert.equal(totals.reduce((n,v)=>n+v.equipment,0),equipment.size)
      close(totals.reduce((n,v)=>n+v.installed_power_kw,0),expectedPower)
      assert.deepEqual([0,1,2,3].map(b=>totals.reduce((n,v)=>n+v.powerBands[b],0)),bands)
      for(const total of totals) {assert.equal(total.operators.points.total,total.points);close(total.operators.power.total,total.installed_power_kw)}
    }
    assert.equal(result.stats.nationalOperators.points.total,expectedPoints)
    close(result.stats.nationalOperators.power.total,expectedPower)
    if(filters.minPower>=150)assert.equal(bands[0]+bands[1]+bands[2],0)
  }
})
test('selected territory retains its non-pickable outline when general boundaries are hidden', () => {
  const region={level:'districts',district_code:'01',state_code:'01'},feature={type:'Feature',properties:region,geometry:{type:'Polygon',coordinates:[]}}
  const regions={states:[],districts:[feature]},options={metric:'sites',territory:'districts',showSites:false,selectedRegion:region,showBoundaries:true}
  const selected=createLayers(null,regions,options).layers.find(l=>l.id==='selected-territory')
  assert.equal(selected.props.pickable,false)
  assert.equal(selected.props.getLineWidth,3)
  assert.equal(selected.props.data[0],feature)
  assert.deepEqual(createLayers(null,regions,{...options,showBoundaries:false}).layers.map(layer => layer.id),['selected-territory'])
})
