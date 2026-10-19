import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { transformWithOxc } from 'vite'
import { useI18n } from '../src/i18n/useI18n.js'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
async function provider(germanOnly) {
  let source = readFileSync(new URL('../src/i18n/LanguageProvider.jsx', import.meta.url), 'utf8')
  source = "import React from 'react'\n" + source.replaceAll('import.meta.env', JSON.stringify({ VITE_CHARGING_GERMAN_ONLY: germanOnly ? '1' : '0', VITE_CHARGING_REVIEW_HASH: '' }))
  source = source.replace(/from '([^']+)'/g, (_, specifier) => {
    const url = specifier.startsWith('.') ? new URL('../src/i18n/' + specifier, import.meta.url).href : pathToFileURL(require.resolve(specifier)).href
    return `from '${url}'`
  })
  const { code } = await transformWithOxc(source, 'LanguageProvider.jsx', { jsx: { runtime: 'classic' } })
  return (await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))).default
}
function LanguageProbe() {
  const { language, canSwitch, setLanguage } = useI18n()
  // Locked setter must be harmless even when another consumer calls it.
  if (!canSwitch) setLanguage('ru')
  return createElement('output', { lang: language, 'data-switch': String(canSwitch) }, language)
}

test('publication first render is DE and locked even with saved RU; it does not overwrite that preference', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  let writes = 0
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'ru', setItem() { writes++ } } })
  t.after(() => previous ? Object.defineProperty(globalThis, 'localStorage', previous) : delete globalThis.localStorage)
  const Provider = await provider(true)
  assert.equal(renderToStaticMarkup(createElement(Provider, null, createElement(LanguageProbe))), '<output lang="de" data-switch="false">de</output>')
  assert.equal(writes, 0)
})

test('development first render honours saved RU and permits switching', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'ru' } })
  t.after(() => previous ? Object.defineProperty(globalThis, 'localStorage', previous) : delete globalThis.localStorage)
  const Provider = await provider(false)
  assert.equal(renderToStaticMarkup(createElement(Provider, null, createElement(LanguageProbe))), '<output lang="ru" data-switch="true">ru</output>')
})

test('development falls back to DE when browser storage access throws', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked') } })
  t.after(() => previous ? Object.defineProperty(globalThis, 'localStorage', previous) : delete globalThis.localStorage)
  const Provider = await provider(false)
  assert.equal(renderToStaticMarkup(createElement(Provider, null, createElement(LanguageProbe))), '<output lang="de" data-switch="true">de</output>')
})
