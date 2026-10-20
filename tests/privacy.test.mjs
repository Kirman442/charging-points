import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { LocalStorage as LogMemory } from '../src/utils/log-memory-storage.js'

const html = readFileSync(new URL('../datenschutz.html', import.meta.url), 'utf8')
test('library logger retains levels without probing browser storage', () => {
  // No window or Storage API exists here: the adapter must work without either.
  const log = new LogMemory('__probe-deck__', {enabled:true,level:0})
  log.setConfiguration({level:2})
  assert.deepEqual(log.getConfiguration(), {enabled:true,level:2})
  assert.equal(log._loadConfiguration(), log)
  assert.equal(log.storage, null)
})
test('privacy page remains independent of map/data and uses only its local theme script', () => {
  assert.match(html, /<html lang="de">/)
  assert.match(html, /<h1>Datenschutzerklärung<\/h1>/)
  assert.doesNotMatch(html, /<iframe|<object|@import|url\(/i)
  assert.equal([...html.matchAll(/<script[^>]*src=/g)].length, 0)
  for (const tag of html.matchAll(/<(?:link|img|source)\b[^>]*>/gi)) {
    assert.doesNotMatch(tag[0], /(?:src|href)="https?:/)
  }
  assert.match(html, /mailto:k\.lisochenko@web\.de/)
  assert.doesNotMatch(html, /Entwurf zur lokalen Prüfung/)
})
test('legal theme executes before styles and restores the first-paint background without writes', () => {
  const bootstrap = readFileSync(new URL('../src/legal/theme.js', import.meta.url), 'utf8').trim()
  const imprint = readFileSync(new URL('../impressum.html', import.meta.url), 'utf8')
  for (const page of [html, imprint]) {
    const script = page.match(/<script>([\s\S]*?)<\/script>/)
    assert.equal(script[1].trim(), bootstrap)
    assert.ok(page.indexOf('<script>') < page.indexOf('rel="stylesheet"'))
  }
  for (const [value, theme, background] of [['light','light','#e8edf0'], ['dark','dark','#10181e'], [null,'dark','#10181e'], ['blocked','dark','#10181e']]) {
    const root = { dataset: {}, style: {} }
    runInNewContext(bootstrap, { document: { documentElement: root }, localStorage: {
      getItem() { if (value === 'blocked') throw Error('blocked'); return value },
      setItem() { throw Error('must not write') },
    } })
    assert.equal(root.dataset.theme, theme)
    assert.equal(root.style.colorScheme, theme)
    assert.equal(root.style.backgroundColor, background)
  }
})
test('all privacy contents links and the direct landing anchor have unique targets', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1])
  assert.equal(ids.length, new Set(ids).size)
  assert.ok(ids.includes('datenschutz'))
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id), id)
  assert.match(html, /href="%BASE_URL%">← Zur Karte/)
})
test('operator address is consistent and both static legal pages are linked', () => {
  const imprint = readFileSync(new URL('../impressum.html', import.meta.url), 'utf8')
  for (const text of [html, imprint]) {
    assert.match(text, /Kirill Lisochenko<br \/>Hauptstr\. 12<br \/>89438 Holzheim/)
    assert.match(text, /mailto:k\.lisochenko@web\.de/)
    assert.doesNotMatch(text, /<iframe/i)
  }
  assert.match(html, /href="%BASE_URL%impressum\.html"/)
  assert.match(imprint, /href="%BASE_URL%datenschutz\.html#datenschutz"/)
})
