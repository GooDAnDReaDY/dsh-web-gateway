// Label-aware provider guards for dsh-web-gateway.
// Caps are per provider+mode; circuit breaker and telemetry are per label.

import { normalizeCapLabel } from './attempts.js'

export function makeGuards({ dailyCaps, circuitBreaker, telemetry, capsFromConfig }) {
  return {
    withGuards(attempt, cfg, run) {
      const label = attempt.label

      return async (overrideSignal) => {
        if (Number(cfg?.circuitBreakerThreshold) > 0) {
          const cbGate = circuitBreaker.check(label)
          if (!cbGate.ok) {
            return { ok: false, provider: label, reason: cbGate.reason }
          }
        }

        const caps = capsFromConfig(cfg)
        const capLabel = normalizeCapLabel(label)
        const gate = dailyCaps.check(capLabel, caps[capLabel])
        if (!gate.ok) {
          return { ok: false, provider: label, reason: gate.reason }
        }

        const startedAt = Date.now()
        try {
          const out = await run(overrideSignal)
          const elapsed = Date.now() - startedAt
          if (out?.ok) {
            circuitBreaker.recordSuccess(label)
            dailyCaps.record(capLabel)
            telemetry.record(label, elapsed, true)
            return { ...out, provider: label }
          }
          if (out?.reason) {
            circuitBreaker.recordFailure(label, out.reason)
            telemetry.record(label, elapsed, false)
          }
          return out ? { ...out, provider: label } : out
        } catch (err) {
          const elapsed = Date.now() - startedAt
          const aborted = err?.name === 'AbortError' || err?.name === 'TimeoutError'
          if (!aborted) {
            circuitBreaker.recordFailure(label, err?.message || String(err))
            telemetry.record(label, elapsed, false)
          }
          throw err
        }
      }
    },
  }
}
