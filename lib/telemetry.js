// Cost estimation and latency telemetry tracker for dsh-web-gateway.

/**
 * Estimated per-call USD rates for API providers.
 * Local/keyless providers (searxng, duckduckgo, crawl4ai, jina, readability) are $0.
 */
export const PROVIDER_COST_USD = Object.freeze({
  tavily: 0.005,
  brave: 0.003,
  firecrawl: 0.005,
  exa: 0.005,
  searxng: 0,
  duckduckgo: 0,
  crawl4ai: 0,
  jina: 0,
  readability: 0,
})

function computePercentile(sorted, p) {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return Math.round(sorted[idx])
}

function rateForLabel(label, rates) {
  const name = String(label)
  if (name.endsWith(':free')) return 0
  const provider = name.replace(/:(?:key(?:#\d+)?|free)$/, '')
  return Number(rates[provider] ?? PROVIDER_COST_USD[provider] ?? 0)
}

/**
 * Create a lightweight in-memory telemetry tracker with rolling latency window and cost estimation.
 */
export function makeTelemetry({ windowSize = 50, rates = PROVIDER_COST_USD } = {}) {
  const maxSamples = Math.max(5, Number(windowSize) || 50)
  let stats = {}

  function ensureProvider(provider) {
    if (!stats[provider]) {
      stats[provider] = {
        calls: 0,
        errors: 0,
        samples: [],
      }
    }
    return stats[provider]
  }

  return {
    record(provider, latencyMs, ok = true) {
      if (!provider) return
      const entry = ensureProvider(provider)
      if (ok) {
        entry.calls += 1
        const ms = Math.max(0, Number(latencyMs) || 0)
        entry.samples.push(ms)
        if (entry.samples.length > maxSamples) {
          entry.samples.shift()
        }
      } else {
        entry.errors += 1
      }
    },

    reset() {
      stats = {}
    },

    snapshot(dailyCapsSnapshot = null) {
      const providers = {}
      let totalEstimatedUsd = 0

      const allNames = new Set([
        ...Object.keys(PROVIDER_COST_USD),
        ...Object.keys(stats),
        ...(dailyCapsSnapshot?.providers ? Object.keys(dailyCapsSnapshot.providers) : []),
      ])

      for (const name of allNames) {
        const st = stats[name] || { calls: 0, errors: 0, samples: [] }
        const sorted = [...st.samples].sort((a, b) => a - b)
        const p50Ms = computePercentile(sorted, 50)
        const p95Ms = computePercentile(sorted, 95)
        const rate = rateForLabel(name, rates)
        // Use the larger of session calls or today's persisted dailyCap count for cost accuracy
        const dailyUsed = Number(dailyCapsSnapshot?.providers?.[name]?.used || 0)
        const billableCalls = Math.max(st.calls, dailyUsed)
        const estimatedUsd = Number((billableCalls * rate).toFixed(4))
        totalEstimatedUsd += estimatedUsd

        providers[name] = {
          calls: billableCalls,
          sessionCalls: st.calls,
          errors: st.errors,
          p50Ms,
          p95Ms,
          rateUsd: rate,
          estimatedUsd,
        }
      }

      return {
        totalEstimatedUsd: Number(totalEstimatedUsd.toFixed(4)),
        providers,
      }
    },
  }
}
