export const DEVELOPMENT_DIAGNOSTICS = import.meta.env?.DEV === true

// Epoch-based monotonic timestamps are comparable between Window and Worker.
export function workerTiming(message, createdAt, receivedAt) {
  const round = value => Math.round(value)
  if (![message.moduleReadyAt, message.startedAt, message.sentAt, createdAt, receivedAt].every(Number.isFinite)) return null
  return {
    phase: message.phase,
    moduleStartupMs: round(message.moduleReadyAt - createdAt),
    phaseStartedAfterCreationMs: round(message.startedAt - createdAt),
    workerMs: round(message.elapsedMs),
    messageDeliveryMs: round(receivedAt - message.sentAt),
  }
}

// Bounded, local console diagnostics. Frame gaps also include rendering/GPU waits;
// a Long Task is separate evidence of main-thread work, not a cause attribution.
export function observeMainThread(report, context, env = window) {
  const doc = env.document, clock = env.performance
  let previous = null, visibleSince = clock.now(), frame, count = 0, stopped = false
  let observer
  const emit = entry => {
    if (stopped || count >= 12 || doc.visibilityState !== 'visible') return
    count++
    report({ ...entry, ...context() })
  }
  const tick = now => {
    if (stopped) return
    if (doc.visibilityState === 'visible') {
      if (previous !== null && now - previous >= 250) emit({ kind: 'frame-gap', startMs: Math.round(previous), durationMs: Math.round(now - previous) })
      previous = now
    } else previous = null
    frame = env.requestAnimationFrame(tick)
  }
  const visibility = () => { previous = null; visibleSince = clock.now() }
  doc.addEventListener('visibilitychange', visibility)
  if (env.PerformanceObserver?.supportedEntryTypes?.includes('longtask')) {
    observer = new env.PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (entry.duration >= 200 && entry.startTime >= visibleSince) emit({ kind: 'long-task', startMs: Math.round(entry.startTime), durationMs: Math.round(entry.duration) })
      }
    })
    observer.observe({ type: 'longtask' })
  }
  frame = env.requestAnimationFrame(tick)
  return () => {
    stopped = true
    env.cancelAnimationFrame(frame)
    observer?.disconnect()
    doc.removeEventListener('visibilitychange', visibility)
  }
}
