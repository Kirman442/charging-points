import test from 'node:test';
import assert from 'node:assert/strict';
import {createPropertyExpression,latest} from '@maplibre/maplibre-gl-style-spec';
import {germanTextField,localizeBasemap} from '../src/map/basemap-language.js';
const evaluate=(field,properties,zoom=10)=>{
 const compiled=createPropertyExpression(germanTextField(field),'text-field',latest.layout_symbol['text-field']);
 assert.equal(compiled.result,'success',JSON.stringify(compiled.value));
 return compiled.value.evaluate({zoom},{properties}).toString();
};
test('German name expressions compile and skip missing or empty fields in fallback order',()=>{
 const names={name_de:'München','name:de':'Muenchen',name:'Local',name_en:'Munich'};
 assert.equal(evaluate('{name_en}',names),'München');
 assert.equal(evaluate('{name_en}',{...names,name_de:''}),'Muenchen');
 assert.equal(evaluate('{name}',{name:'Local',name_en:'English'}),'Local');
 assert.equal(evaluate('{name}',{name:'',name_en:'English'}),'English');
 assert.equal(evaluate('{name}',{}),'');
 assert.equal(evaluate('Ort: {name_en}',names),'Ort: München');
 assert.equal(evaluate(['get','name_en'],names),'München');
});
test('zoom text functions retain thresholds, unrelated labels and remain idempotent',()=>{
 const field={stops:[[8,'{name_en}'],[13,'{name}']]},before=JSON.stringify(field);
 for(const z of [5,8,12,13,18])assert.equal(evaluate(field,{name_de:'Bayern',name_en:'Bavaria'},z),'Bayern');
 assert.equal(JSON.stringify(field),before);
 assert.deepEqual(germanTextField(germanTextField(field)),germanTextField(field));
 assert.equal(germanTextField('{housenumber}'),'{housenumber}');
 assert.deepEqual(germanTextField(['get','ref']),['get','ref']);
});


test('German place labels prefer native fields while preserving road references and house numbers',()=>{
 for(const [de,en] of [['München','Munich'],['Bayern','Bavaria'],['Hessen','Hesse']]){
  assert.equal(evaluate('{name_en}',{name:de,name_en:en}),de);
  assert.equal(evaluate(['get','name:en'],{'name:de':de,name_en:en}),de);
 }
 assert.equal(evaluate('{name}',{name_de:'', 'name:de':'',name:'Hessen',name_en:'Hesse'}),'Hessen');
 const road=['concat','A ',['get','ref']];
 assert.deepEqual(germanTextField(road),road);
 assert.equal(evaluate(road,{ref:'9'}),'A 9');
 assert.equal(germanTextField('{housenumber}'),'{housenumber}');
 const zoomLabels={stops:[[5,'Land: {name_en}'],[10,'Stadt: {name}']]};
 assert.equal(evaluate(zoomLabels,{name:'München',name_en:'Munich'},9),'Land: München');
 assert.equal(evaluate(zoomLabels,{name:'München',name_en:'Munich'},10),'Stadt: München');
});

test('style lifecycle localizes only text fields, survives theme changes and remounts without repeat writes',()=>{
 const makeStyle=theme=>({version:8,metadata:{theme},sources:{carto:{type:'vector',attribution:'CARTO / OpenStreetMap'}},layers:[
  {id:'place',type:'symbol',layout:{'text-field':'{name_en}','text-size':14},paint:{'text-color':theme==='dark'?'#fff':'#000'}},
  {id:'road',type:'symbol',layout:{'text-field':'{ref}'}},
  {id:'house',type:'symbol',layout:{'text-field':'{housenumber}'}},
 ]});
 let style=makeStyle('dark'),ready=false;
 const updates=[];
 const map={isStyleLoaded:()=>ready,getStyle:()=>structuredClone(style),setLayoutProperty(id,key,value){
  assert.equal(key,'text-field');updates.push(id);style.layers.find(layer=>layer.id===id).layout[key]=value;
 }};
 localizeBasemap(map);assert.equal(updates.length,0);
 ready=true;
 for(const theme of ['dark','light','dark']){
  style=makeStyle(theme);const before=structuredClone(style),count=updates.length;
  localizeBasemap(map);
  assert.equal(updates.length,count+1);
  assert.equal(evaluate(style.layers[0].layout['text-field'],{name:'München',name_en:'Munich'}),'München');
  const expected=structuredClone(before);expected.layers[0].layout['text-field']=germanTextField('{name_en}');
  assert.deepEqual(style,expected);
  localizeBasemap(map);localizeBasemap(map);
  assert.equal(updates.length,count+1);
 }
 style=makeStyle('light');
 localizeBasemap({...map});
 assert.equal(evaluate(style.layers[0].layout['text-field'],{name:'Hessen',name_en:'Hesse'}),'Hessen');
 localizeBasemap(null);
});
