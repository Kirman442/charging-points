import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allowReview, savedLanguage } from '../src/i18n/languageAccess.js'
import { prepareReviewAccess, languageAccessDefines } from '../scripts/languageAccess.mjs'

const key = 'test-editorial-key-1234567890'
const hash = createHash('sha256').update(key).digest('hex')
function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'charging-language-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('review access requires the exact key and Web Crypto SHA-256', async () => {
  assert.equal(await allowReview(`?other=1&review=${key}`, hash, webcrypto.subtle), true)
  for (const search of ['', '?review=', '?review=wrong', `?review=${key}x`, '?review=' + 'a'.repeat(129)]) {
    assert.equal(await allowReview(search, hash, webcrypto.subtle), false)
  }
  assert.equal(await allowReview(`?review=${key}`, ''), false)
  assert.equal(await allowReview(`?review=${key}`, hash, { digest() { throw new Error('unavailable') } }), false)
})

test('development preferences retain RU/DE and tolerate blocked storage', () => {
  for (const [stored, expected] of [['ru','ru'], ['de','de'], [null,'de'], ['fr','de']]) {
    assert.equal(savedLanguage({ getItem: () => stored }), expected)
  }
  assert.equal(savedLanguage({ getItem() { throw new Error('blocked') } }), 'de')
  assert.deepEqual(languageAccessDefines('serve'), {
    'import.meta.env.VITE_CHARGING_GERMAN_ONLY': '"0"',
    'import.meta.env.VITE_CHARGING_REVIEW_HASH': '""',
  })
})

test('local build creates a reusable private key, personal links and a hash-only build record', t => {
  const root = workspace(t)
  const firstHash = prepareReviewAccess(root, {})
  const access = JSON.parse(readFileSync(join(root, '.review/review-access.json')))
  assert.match(access.key, /^[a-f0-9]{48}$/)
  assert.equal(firstHash, createHash('sha256').update(access.key).digest('hex'))
  assert.equal(prepareReviewAccess(root, {}), firstHash)
  const record = readFileSync(join(root, '.review/build-language.json'), 'utf8')
  assert.deepEqual(JSON.parse(record), { germanOnly: true, reviewHash: firstHash })
  assert.ok(!record.includes(access.key))
  assert.ok(readFileSync(join(root, '.review/README-review-access.md'), 'utf8').includes('?review=' + access.key))
})

test('explicit key rotates the build hash; CI can compile from the hash without receiving the key', t => {
  const root = workspace(t)
  const original = prepareReviewAccess(root, {})
  assert.equal(prepareReviewAccess(root, { CHARGING_REVIEW_KEY: key }), hash)
  assert.notEqual(original, hash)
  const ciRoot = workspace(t)
  assert.equal(prepareReviewAccess(ciRoot, { CI: 'true', CHARGING_REVIEW_HASH: hash }), hash)
  assert.equal(existsSync(join(ciRoot, '.review/review-access.json')), false)
  assert.equal(existsSync(join(ciRoot, '.review/README-review-access.md')), false)
})

test('bad CI configuration fails before generating an inaccessible key or exposing supplied values', t => {
  const root = workspace(t)
  assert.throws(() => prepareReviewAccess(root, { CI: 'true' }), /Set CHARGING_REVIEW_KEY or CHARGING_REVIEW_HASH/)
  assert.throws(() => prepareReviewAccess(root, { CHARGING_REVIEW_KEY: 'short' }), /24-128/)
  assert.throws(() => prepareReviewAccess(root, { CHARGING_REVIEW_HASH: 'bad' }), /lowercase SHA-256/)
  assert.throws(() => prepareReviewAccess(root, { CHARGING_REVIEW_KEY: key, CHARGING_REVIEW_HASH: '0'.repeat(64) }), /does not match/)
  assert.equal(existsSync(join(root, '.review')), false)
})
