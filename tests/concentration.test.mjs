import test from 'node:test'
import assert from 'node:assert/strict'
import { operatorConcentration } from '../src/data/concentration.js'
import { summarizeOperators } from '../src/data/operators.js'
import { metricValue, rankStates } from '../src/data/analytics.js'
import { createLayers } from '../src/map/layers.js'
import { DEFAULT_OPTIONS, territoryForSelection } from '../src/map/settings.js'
const ops = (points, power) => summarizeOperators(new Map([[0,{points:points[0],power:power[0]}],[1,{points:points[1],power:power[1]}]]),['A','B'])
const feature = (name, operators) => ({type:'Feature',geometry:{type:'Polygon',coordinates:[]},properties:{state_name:name,state_code:name,operators}})
test('concentration is strictly above 60%, uses the selected basis and remains descriptive for small samples', () => {
  const operators = ops([60,40],[10,90])
  assert.equal(operatorConcentration(operators,'points').high,false)
  assert.equal(operatorConcentration(operators,'power').high,true)
  assert.equal(operatorConcentration(operators,'power').name,'B')
  assert.equal(operatorConcentration(ops([61,39],[61,39])).high,true)
  const single = summarizeOperators(new Map([[0,{points:2,power:0}]]),['Single'])
  assert.equal(operatorConcentration(single).share,100)
  assert.equal(operatorConcentration(single).total,2)
  assert.equal(operatorConcentration(single,'power'),null)
  assert.equal(operatorConcentration(summarizeOperators(new Map(),[])),null)
  assert.equal(operatorConcentration(null),null)
})
test('map, ranking and territory defaults use the same operator basis and threshold', () => {
  const a=feature('A',ops([60,40],[10,90])),b=feature('B',ops([70,30],[50,50])),missing=feature('C',summarizeOperators(new Map(),[]))
  const regions={states:[a,b,missing],districts:[]}
  const options={...DEFAULT_OPTIONS,metric:'concentration',showSites:false,showBoundaries:false}
  for(const basis of ['points','power']) {
    const result=createLayers(null,regions,{...options,operatorBasis:basis})
    assert.equal(result.maximum,100)
    assert.equal(result.layers.length,1)
    const fill=result.layers[0].props.getFillColor
    assert.deepEqual(fill(missing),[154,168,178,200])
    assert.equal(result.layers[0].props.getFillPattern(missing),'missing')
    assert.equal(result.layers[0].props.getFillPattern(a),null)
    assert.deepEqual(fill(a),basis==='points'?[101,127,153,220]:[233,164,93,220])
    assert.equal(metricValue(a.properties,'concentration',basis),basis==='points'?60:90)
    assert.equal(rankStates(regions.states,'concentration',basis)[0].state_name,basis==='points'?'B':'A')
  }
  assert.equal(territoryForSelection(options,'Hessen').territory,'districts')
  assert.equal(territoryForSelection(options,'').territory,'states')
})
