import test from 'node:test'
import assert from 'node:assert/strict'
import { counted, siteSelectionText, sitePowerRows } from '../src/utils/siteSelection.js'

const forms = ['точка', 'точки', 'точек']
test('counts support compact labels and the genitive case after У', () => {
  for (const [value, point, site, afterU] of [[0,'точек','площадок','площадок'],[1,'точка','площадка','площадки'],[2,'точки','площадки','площадок'],[11,'точек','площадок','площадок'],[21,'точка','площадка','площадки'],[81,'точка','площадка','площадки'],[242,'точки','площадки','площадок']]) {
    assert.ok(counted(value, forms).endsWith(` ${point}`))
    assert.ok(counted(value, ['площадка','площадки','площадок']).endsWith(` ${site}`))
    assert.ok(counted(value, ['площадки','площадок','площадок']).endsWith(` ${afterU}`))
    assert.ok(counted(value, ['точки','точек','точек']).endsWith(` ${afterU === 'площадки' ? 'точки' : 'точек'}`))
  }
})
test('Russian counts cover all endings, teens, hundreds and thousands', () => {
  const groups = [
    ['точка', [1,21,31,101,121,1001]],
    ['точки', [2,3,4,22,23,24,102,103,104,122,1002]],
    ['точек', [0,5,6,7,8,9,10,11,12,13,14,15,19,20,25,100,110,111,112,113,114,115,125,1011,1014]],
  ]
  for (const [word, values] of groups) for (const value of values) {
    assert.ok(counted(value, forms).endsWith(` ${word}`), `${value}: ${word}`)
    const equipmentWord = { 'точка': 'установка', 'точки': 'установки', 'точек': 'установок' }[word]
    assert.ok(counted(value, ['установка','установки','установок']).endsWith(` ${equipmentWord}`))
  }
})
test('Equal selection omits comparison, including defaults and zero counts', () => {
  for (const [p,e] of [[2,1],[4,2],[0,0],[1,1],[5,5]]) {
    const site = { charging_point_count:p,equipment_count:e }
    assert.equal(siteSelectionText(site),null)
    assert.equal(siteSelectionText({...site,selected_point_count:p,selected_equipment_count:e}),null)
  }
})
test('Either differing counter preserves both selected and complete counts', () => {
  assert.equal(siteSelectionText({selected_point_count:2,selected_equipment_count:1,charging_point_count:4,equipment_count:2}), 'В выборке: 2 точки и 1 установка. Всего на площадке: 4 точки и 2 установки.')
  assert.equal(siteSelectionText({selected_point_count:1,selected_equipment_count:1,charging_point_count:5,equipment_count:1}), 'В выборке: 1 точка и 1 установка. Всего на площадке: 5 точек и 1 установка.')
  assert.equal(siteSelectionText({selected_point_count:4,selected_equipment_count:1,charging_point_count:4,equipment_count:2}), 'В выборке: 4 точки и 1 установка. Всего на площадке: 4 точки и 2 установки.')
  assert.equal(siteSelectionText({selected_point_count:0,selected_equipment_count:0,charging_point_count:11,equipment_count:5}), 'В выборке: 0 точек и 0 установок. Всего на площадке: 11 точек и 5 установок.')
})

test('Full equipment selection shows installed power once and retains separate point power', () => {
  for (const [equipment, points, installed, point] of [[1,2,22,22],[2,4,100,50],[3,6,900,300]]) {
    const site = { equipment_count:equipment, selected_equipment_count:equipment, charging_point_count:points, selected_point_count:points, installed_power_kw:installed, selected_power_kw:installed, available_power_kw:[point] }
    assert.deepEqual(sitePowerRows(site), [
      { label:'Номинальная мощность всей площадки',value:`${installed} кВт` },
      { label:'Мощность точек',value:`${point} кВт` },
    ])
    assert.equal(sitePowerRows({...site,selected_point_count:1}).length,2)
  }
})
test('Partial equipment selection remains distinct even with equal power sums', () => {
  const site = { equipment_count:2, selected_equipment_count:1, installed_power_kw:100, selected_power_kw:100, available_power_kw:[22,50] }
  assert.deepEqual(sitePowerRows(site), [
    {label:'Номинальная мощность всей площадки',value:'100 кВт'},
    {label:'Мощность установок в выборке',value:'100 кВт'},
    {label:'Мощность точек',value:'22, 50 кВт'},
  ])
  assert.equal(sitePowerRows({...site,selected_power_kw:50})[1].value,'50 кВт')
  assert.equal(sitePowerRows({...site,selected_equipment_count:0,selected_power_kw:0})[1].value,'0 кВт')
})
test('Without selection fields site power keeps the complete registry facts', () => {
  assert.equal(sitePowerRows({equipment_count:1,installed_power_kw:22,available_power_kw:[22]}).length,2)
})
