import test from 'node:test'
import assert from 'node:assert/strict'
import { workerTiming, observeMainThread } from '../src/utils/stallDiagnostics.js'

test('cross-realm timing distinguishes slow Worker startup from late main-thread delivery', () => {
  const createdAt = 1700000000000
  const phase = { phase: 'sites', moduleReadyAt: createdAt + 11600, startedAt: createdAt + 11620,
    sentAt: createdAt + 16369, elapsedMs: 4749 }
  assert.deepEqual(workerTiming(phase, createdAt, createdAt + 16421), {
    phase: 'sites', moduleStartupMs: 11600, phaseStartedAfterCreationMs: 11620, workerMs: 4749, messageDeliveryMs: 52,
  })
  const queued = { ...phase, moduleReadyAt: createdAt + 400, startedAt: createdAt + 420, sentAt: createdAt + 5169 }
  const result = workerTiming(queued, createdAt, createdAt + 16421)
  assert.equal(result.moduleStartupMs, 400)
  assert.equal(result.messageDeliveryMs, 11252)
  assert.equal(workerTiming({ elapsedMs: 10 }, createdAt, createdAt + 10), null)
})

function environment(withObserver = true) {
  let frame, notify, visibility, now = 0, cancelled, disconnected = false
  const env = {
    document: { visibilityState: 'visible', addEventListener(type, callback) { visibility = callback },
      removeEventListener(type, callback) { assert.equal(callback, visibility); visibility = null } },
    performance: { now: () => now },
    requestAnimationFrame(callback) { frame = callback; return 42 },
    cancelAnimationFrame(id) { cancelled = id },
  }
  if (withObserver) env.PerformanceObserver = class {
    static supportedEntryTypes = ['longtask']
    constructor(callback) { notify = entries => callback({ getEntries: () => entries }) }
    observe(options) { assert.deepEqual(options, { type: 'longtask' }) }
    disconnect() { disconnected = true }
  }
  return { env, tick(value) { now = value; frame(value) }, tasks(entries) { notify(entries) },
    visibility(value, at) { now = at; env.document.visibilityState = value; visibility() },
    state: () => ({ cancelled, disconnected, visibility }) }
}

test('frame stalls and long tasks remain distinct, carry phase context and skip ordinary frame intervals', () => {
  const fake = environment(), reports = []
  let sitesReceived = false
  const stop = observeMainThread(value => reports.push(value), () => ({ sitesReceived }), fake.env)
  fake.tick(10); fake.tick(26); fake.tick(270)
  assert.deepEqual(reports, [])
  fake.tick(1270)
  assert.deepEqual(reports[0], { kind: 'frame-gap', startMs: 270, durationMs: 1000, sitesReceived: false })
  sitesReceived = true
  fake.tasks([{ startTime: 300, duration: 999 }, { startTime: 1400, duration: 60 }])
  assert.deepEqual(reports[1], { kind: 'long-task', startMs: 300, durationMs: 999, sitesReceived: true })
  stop()
  assert.deepEqual(fake.state(), { cancelled: 42, disconnected: true, visibility: null })
  fake.tick(5000); fake.tasks([{ startTime: 4000, duration: 1000 }])
  assert.equal(reports.length, 2)
})

test('background-tab suspension is not reported as a freeze and diagnostics are bounded', () => {
  const fake = environment(), reports = []
  const stop = observeMainThread(value => reports.push(value), () => ({}), fake.env)
  fake.tick(10)
  fake.visibility('hidden', 20); fake.tick(40000)
  fake.tasks([{ startTime: 30, duration: 30000 }])
  fake.visibility('visible', 40001); fake.tick(40002)
  fake.tasks([{ startTime: 30, duration: 30000 }])
  assert.deepEqual(reports, [])
  for (let i = 0; i < 30; i++) fake.tasks([{ startTime: 40002 + i * 300, duration: 250 }])
  assert.equal(reports.length, 12)
  stop()
})

test('frame-gap diagnostics still work when Long Tasks API is unavailable', () => {
  const fake = environment(false), reports = []
  const stop = observeMainThread(value => reports.push(value), () => ({}), fake.env)
  fake.tick(1); fake.tick(501)
  assert.equal(reports[0].kind, 'frame-gap')
  stop()
})
