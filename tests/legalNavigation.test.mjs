import test from 'node:test'
import assert from 'node:assert/strict'
import { legalLinkTarget, legalPageFromHash } from '../src/legal/navigation.js'
const base = 'https://example.org/charging-points/'
test('only local legal pages and return to this application are intercepted', () => {
  assert.equal(legalLinkTarget('datenschutz.html#datenschutz',base),'datenschutz')
  assert.equal(legalLinkTarget('/charging-points/impressum.html',base),'impressum')
  assert.equal(legalLinkTarget(base,base),'map')
  for (const link of ['#hosting','https://elsewhere.org/impressum.html','/other/impressum.html','mailto:a@example.org','']) {
    assert.equal(legalLinkTarget(link,base),null)
  }
})
test('legal history hashes distinguish map and legal screens', () => {
  assert.equal(legalPageFromHash('#datenschutz'),'datenschutz')
  assert.equal(legalPageFromHash('#impressum'),'impressum')
  assert.equal(legalPageFromHash(''),null)
  assert.equal(legalPageFromHash('#hosting'),null)
})
