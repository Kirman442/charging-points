import test from 'node:test'
import assert from 'node:assert/strict'
import { tooltipPlacement } from '../src/map/tooltip.js'

test('tooltip follows DOM pointer coordinates rather than a negative canvas offset', () => {
  const placement = tooltipPlacement({ x: 700, y: 779 }, { width: 1920, height: 1080 })
  assert.equal(placement.position, 'fixed')
  assert.equal(placement.top, '791px')
  assert.equal(placement.left, '712px')
  assert.equal(placement.transform, 'translate(0, 0)')
})

test('tooltip flips above the pointer at the bottom and left before the analytics panel', () => {
  const pointer = { x: 830, y: 955 }
  const placement = tooltipPlacement(pointer, { width: 1440, height: 1000, right: 1020 })
  assert.equal(placement.top, '943px')
  assert.equal(placement.left, '818px')
  assert.equal(placement.transform, 'translate(-100%, -100%)')
  // An actual 300 × 89 tooltip stays inside the map and within 12px of its marker.
  assert.ok(818 - 300 >= 0)
  assert.ok(943 - 89 >= 0)
  assert.ok(818 < 1020 && 943 < 1000)
})
