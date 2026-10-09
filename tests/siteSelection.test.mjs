import test from 'node:test'
import assert from 'node:assert/strict'
import { counted, siteSelectionText } from '../src/utils/siteSelection.js'

const forms = ['точка', 'точки', 'точек']
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
