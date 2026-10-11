import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import de from '../src/i18n/de.json' with { type: 'json' }
import { translate, messageParts } from '../src/i18n/translate.js'
import { errorText } from '../src/i18n/errors.js'
import { countWord, siteSelectionText, sitePowerRows } from '../src/utils/siteSelection.js'
import { accessConditionLabels } from '../src/data/autobahnAccess.js'
import { AUTOBAHNS } from '../src/data/autobahn.js'
import { MOTORWAY_REVIEW_REASONS } from '../src/data/motorwayDiagnostics.js'

test('German resources cover active messages, route directions and all diagnostic reasons without changing placeholders', () => {
  for (const [key, value] of Object.entries(de)) {
    assert.equal(typeof value, 'string', key)
    assert.ok(value.length > 0, key)
    assert.ok(!/[А-Яа-яЁё]/.test(value), key)
    const contracts = { 'selection-composition': ['{equipment}','{points}','{totalEquipment}','{totalPoints}'], 'osm-route-source': ['{route}'] }
    assert.deepEqual(contracts[key] || [...key.matchAll(/\{\w+\}/g)].map(m=>m[0]).sort(), [...value.matchAll(/\{\w+\}/g)].map(m=>m[0]).sort(), key)
  }
  const traverse = traverseModule.default
  const files = ['src/App.jsx', ...fs.readdirSync('src/components').filter(n=>n.endsWith('.jsx') && !['DetailPanel.jsx','MapStats.jsx'].includes(n)).map(n=>'src/components/'+n)]
  for (const file of files) traverse(parse(fs.readFileSync(file,'utf8'), {sourceType:'module', plugins:['jsx']}), {
    CallExpression(p) {
      if (!['t','message'].includes(p.node.callee?.name) || p.node.arguments[0]?.type !== 'StringLiteral') return
      assert.ok(Object.hasOwn(de, p.node.arguments[0].value), `${file}: ${p.node.arguments[0].value}`)
    },
    JSXText(p) { assert.ok(!/[А-Яа-яЁё]/.test(p.node.value), file) },
  })
  for (const route of Object.values(AUTOBAHNS)) for (const key of ['north','south','east','west']) if (route[key]) assert.ok(Object.hasOwn(de, route[key]))
  for (const value of Object.values(MOTORWAY_REVIEW_REASONS)) assert.ok(Object.hasOwn(de, value))
})

test('German counts distinguish one from zero and Russian 21/101, retaining Russian plural rules', () => {
  for (const value of [0,1,2,5,11,21,101]) {
    assert.equal(countWord(value, ['площадка','площадки','площадок'], 'de'), value===1?'Standort':'Standorte')
    assert.equal(countWord(value, ['установка','установки','установок'], 'de'), value===1?'Station':'Stationen')
    assert.equal(countWord(value, ['точка','точки','точек'], 'de'), value===1?'Ladepunkt':'Ladepunkte')
  }
  assert.equal(countWord(21, ['точка','точки','точек']), 'точка')
  assert.equal(countWord(11, ['точка','точки','точек']), 'точек')
})

test('Selection texts and power rows localize presentation while preserving selected/full composition', () => {
  const site={selected_point_count:1,charging_point_count:5,selected_equipment_count:1,equipment_count:2,installed_power_kw:44,selected_power_kw:22,available_power_kw:[22]}
  assert.equal(siteSelectionText(site, 'de'), 'In der Auswahl: 1 Ladepunkt und 1 Station. Am gesamten Standort: 5 Ladepunkte und 2 Stationen.')
  assert.equal(siteSelectionText({...site,selected_point_count:5,selected_equipment_count:2},'de'),null)
  assert.deepEqual(sitePowerRows(site,'de').map(row=>row.value), ['44 kW','22 kW','22 kW'])
  assert.match(siteSelectionText(site),/1 точка и 1 установка/)
  assert.equal(site.installed_power_kw,44)
})

test('Translated rich messages preserve parameter identity, unknown names, and nonbreaking units', () => {
  const marker={kind:'strong',text:'665'}
  const parts=messageParts('de','{p0} {p1} с DC-точкой ≥150 кВт;', {p0:marker,p1:'Standorte'})
  assert.equal(parts[1],marker)
  assert.match(parts.filter(p=>typeof p==='string').join(''),/150\u00a0kW/)
  assert.equal(translate('de','TEAG Mobil GmbH'),'TEAG Mobil GmbH')
  assert.equal(translate('de','Условие {key}: {value}', {key:'motorcar:conditional',value:'yes @ (Mo-Fr)'}),'Bedingung motorcar:conditional: yes @ (Mo-Fr)')
})

test('Access tags retain their values and never double units; error categories work independently of Russian wording', () => {
  const tags={access:'customers',maxheight:'4.5 m',maxweight:'3.5',opening_hours:'Mo-Fr 08:00-18:00'}
  const before=JSON.stringify(tags)
  assert.deepEqual(accessConditionLabels([{tags}],'de'), ['Zugang für Kunden','Maximale Höhe: 4.5 m','Maximales Gewicht: 3.5 t','Zugangszeiten auf dem Weg: Mo-Fr 08:00-18:00'])
  assert.equal(JSON.stringify(tags),before)
  assert.equal(errorText('de','boundary provider failed','boundaries'),'Gebietsgrenzen konnten nicht geladen werden.')
  assert.equal(errorText('de','A7: HTTP 503','motorway'),'Laden der Route A7 fehlgeschlagen (HTTP 503).')
  assert.equal(errorText('de','arbitrary load error','motorway-load'), 'Die Route konnte nicht geladen werden.')
  assert.equal(errorText('de','arbitrary validation error','motorway-data-mismatch'), de['Неверная версия данных автобана'])
  assert.equal(errorText('ru','boundary provider failed','boundaries'),'boundary provider failed')
})
