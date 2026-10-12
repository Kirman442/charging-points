import test from 'node:test'
import assert from 'node:assert/strict'
import { tooltipPosition } from '../src/utils/tooltipPosition.js'

test('Tooltip stays inside every viewport edge and above a label near the bottom', () => {
  const popup = { width: 260, height: 160 }
  for (const viewport of [{width:1440,height:900},{width:320,height:568},{width:844,height:390}]) {
    for (const anchor of [
      {left:0,top:0,bottom:20},
      {left:viewport.width-50,top:100,bottom:120},
      {left:100,top:viewport.height-30,bottom:viewport.height-10},
    ]) {
      const p = tooltipPosition(anchor,popup,viewport)
      assert.ok(p.left>=12 && p.top>=12)
      assert.ok(p.left+popup.width<=viewport.width-12)
      assert.ok(p.top+popup.height<=viewport.height-12)
      if (anchor.top === viewport.height-30) assert.ok(p.top+popup.height<anchor.top)
    }
  }
})

test('Tall and narrow tooltips use bounded dimensions and do not get negative placement', () => {
  assert.deepEqual(tooltipPosition({left:100,top:10,bottom:30},{width:260,height:800},{width:240,height:200}),{left:12,top:12})
  assert.deepEqual(tooltipPosition({left:30,top:50,bottom:70},{width:200,height:40},{width:320,height:568}),{left:30,top:76})
})
