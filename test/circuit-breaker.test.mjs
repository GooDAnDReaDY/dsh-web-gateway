import test from 'node:test'
import assert from 'node:assert/strict'
import { makeCircuitBreaker, isBreakerIgnoredReason } from '../lib/circuit-breaker.js'

test('circuit breaker stays closed initially', () => {
  const cb = makeCircuitBreaker({ threshold: 3, cooldownMs: 1000 })
  assert.equal(cb.check('tavily').ok, true)
})

test('circuit breaker trips after threshold failures', () => {
  let currentTime = 1000
  const cb = makeCircuitBreaker({
    threshold: 3,
    cooldownMs: 5000,
    now: () => currentTime,
  })

  cb.recordFailure('tavily', 'HTTP 500')
  assert.equal(cb.check('tavily').ok, true)
  cb.recordFailure('tavily', 'HTTP 503')
  assert.equal(cb.check('tavily').ok, true)
  cb.recordFailure('tavily', 'HTTP 429')

  const gate = cb.check('tavily')
  assert.equal(gate.ok, false)
  assert.match(gate.reason, /circuit breaker open/)
  assert.match(gate.reason, /HTTP 429/)
})

test('ignored reasons do not trip circuit breaker', () => {
  const cb = makeCircuitBreaker({ threshold: 2 })
  cb.recordFailure('tavily', 'no TAVILY_API_KEY')
  cb.recordFailure('searxng', 'searxng not configured')
  cb.recordFailure('firecrawl', 'daily cap exceeded')
  assert.equal(cb.check('tavily').ok, true)
  assert.equal(cb.check('searxng').ok, true)
  assert.equal(cb.check('firecrawl').ok, true)
})

test('circuit breaker recovers after cooldown passes', () => {
  let currentTime = 1000
  const cb = makeCircuitBreaker({
    threshold: 2,
    cooldownMs: 5000,
    now: () => currentTime,
  })

  cb.recordFailure('tavily', 'timeout')
  cb.recordFailure('tavily', 'timeout')
  assert.equal(cb.check('tavily').ok, false)

  currentTime += 5001
  assert.equal(cb.check('tavily').ok, true)

  cb.recordSuccess('tavily')
  const snap = cb.snapshot()
  assert.equal(snap.tavily.state, 'closed')
  assert.equal(snap.tavily.failureCount, 0)
})

test('snapshot reports state and remaining cooldown', () => {
  let currentTime = 1000
  const cb = makeCircuitBreaker({
    threshold: 1,
    cooldownMs: 10000,
    now: () => currentTime,
  })
  cb.recordFailure('firecrawl', 'HTTP 500 Server Error')
  const snap = cb.snapshot()
  assert.equal(snap.firecrawl.state, 'open')
  assert.equal(snap.firecrawl.failureCount, 1)
  assert.equal(snap.firecrawl.cooldownRemainingMs, 10000)
  assert.equal(snap.firecrawl.lastError, 'HTTP 500 Server Error')
})
