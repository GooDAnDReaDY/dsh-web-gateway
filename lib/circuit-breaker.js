// Circuit breaker for dsh-web-gateway providers.
// Temporarily suspends providers that suffer consecutive errors or rate limits.

export function isBreakerIgnoredReason(reason) {
  const r = String(reason ?? '').toLowerCase()
  return (
    (r.includes('no ') && r.includes('key')) ||
    r.includes('not configured') ||
    r.includes('disabled') ||
    r.includes('daily cap') ||
    r.includes('policy')
  )
}

export function makeCircuitBreaker(opts = {}) {
  const threshold = Number(opts.threshold) > 0 ? Number(opts.threshold) : 3
  const cooldownMs = Number(opts.cooldownMs) > 0 ? Number(opts.cooldownMs) : 5 * 60 * 1000
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()

  const state = new Map()

  function getEntry(provider) {
    let entry = state.get(provider)
    if (!entry) {
      entry = { failureCount: 0, cooldownUntil: 0, lastError: null }
      state.set(provider, entry)
    }
    return entry
  }

  function check(provider) {
    const entry = getEntry(provider)
    const currentTime = now()
    if (entry.cooldownUntil > currentTime) {
      const remainingSec = Math.ceil((entry.cooldownUntil - currentTime) / 1000)
      return {
        ok: false,
        reason: `circuit breaker open (cooling down for ${remainingSec}s; last error: ${entry.lastError || 'unknown'})`,
      }
    }
    return { ok: true }
  }

  function recordSuccess(provider) {
    const entry = getEntry(provider)
    entry.failureCount = 0
    entry.cooldownUntil = 0
    entry.lastError = null
  }

  function recordFailure(provider, reason) {
    if (isBreakerIgnoredReason(reason)) return
    const entry = getEntry(provider)
    entry.failureCount += 1
    entry.lastError = String(reason || 'error').slice(0, 150)
    if (entry.failureCount >= threshold) {
      entry.cooldownUntil = now() + cooldownMs
    }
  }

  function reset(provider) {
    if (provider) {
      state.delete(provider)
    } else {
      state.clear()
    }
  }

  function snapshot() {
    const currentTime = now()
    const out = {}
    for (const [provider, entry] of state.entries()) {
      const isOpen = entry.cooldownUntil > currentTime
      out[provider] = {
        state: isOpen ? 'open' : entry.failureCount > 0 ? 'degraded' : 'closed',
        failureCount: entry.failureCount,
        cooldownRemainingMs: isOpen ? Math.max(0, entry.cooldownUntil - currentTime) : 0,
        lastError: entry.lastError,
      }
    }
    return out
  }

  return {
    check,
    recordSuccess,
    recordFailure,
    reset,
    snapshot,
  }
}
