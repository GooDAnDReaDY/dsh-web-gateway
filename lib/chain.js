// Provider chain helpers for dsh-web-gateway.

export const SEARCH_PROVIDER_IDS = Object.freeze(['tavily', 'brave', 'firecrawl', 'exa', 'searxng', 'duckduckgo'])
export const EXTRACT_PROVIDER_IDS = Object.freeze(['firecrawl', 'tavily', 'crawl4ai', 'jina', 'readability'])
export const SEARCH_STRATEGIES = Object.freeze(['fallback', 'race', 'aggregate'])

export const DEFAULT_SEARCH_ORDER = SEARCH_PROVIDER_IDS.join(',')
export const DEFAULT_EXTRACT_ORDER = 'firecrawl,tavily,crawl4ai,jina,readability'

/**
 * Parse a comma/space-separated provider order string against an allow-list.
 * Empty/invalid input falls back to the full default allow-list order.
 */
export function parseProviderOrder(raw, allowed) {
  const allow = [...allowed]
  const parts = String(raw ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  const out = []
  for (const p of parts) {
    if (allow.includes(p) && !out.includes(p)) out.push(p)
  }
  return out.length ? out : allow
}

export function normalizeStrategy(raw) {
  const v = String(raw ?? 'fallback').trim().toLowerCase()
  return SEARCH_STRATEGIES.includes(v) ? v : 'fallback'
}

/**
 * Run ordered attempts sequentially. Each attempt returns { ok, provider, reason?, ...payload }.
 * Collects skipped providers with reasons; returns first success.
 */
export async function runProviderChain(attempts) {
  const skipped = []
  for (const attempt of attempts) {
    const name = attempt.name
    try {
      const out = await attempt.run()
      if (out && out.ok) {
        return { ok: true, provider: out.provider, skipped, payload: out }
      }
      skipped.push({
        provider: out?.provider || name,
        reason: String(out?.reason || 'failed').slice(0, 200),
      })
    } catch (err) {
      const cause = err?.cause?.message || err?.message || String(err)
      skipped.push({ provider: name, reason: String(cause).slice(0, 200) })
    }
  }
  return { ok: false, skipped }
}

/**
 * Normalize URL for deduplication in aggregate mode.
 */
export function normalizeDedupeUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || '').trim())
    u.hash = ''
    let href = u.href.toLowerCase()
    if (href.endsWith('/') && u.pathname !== '/') {
      href = href.slice(0, -1)
    } else if (u.pathname === '/' && href.endsWith('/')) {
      href = href.slice(0, -1)
    }
    return href
  } catch (_err) {
    return String(rawUrl || '').trim().toLowerCase().replace(/\/+$/, '')
  }
}

/**
 * Run top N attempts in parallel and return the first successful result (fastest-wins),
 * aborting slower competitors via internal AbortController.
 * @param {Array<{ name: string, run: (signal?: AbortSignal) => Promise<any> }>} attempts
 * @param {{ concurrency?: number, signal?: AbortSignal }} [opts]
 */
export async function runProviderRace(attempts, opts = {}) {
  const concurrency = Math.max(1, Number(opts.concurrency) || 2)
  const racers = attempts.slice(0, concurrency)
  const rest = attempts.slice(concurrency)
  const skipped = []

  if (!racers.length) return { ok: false, skipped }

  const controllers = racers.map(() => new AbortController())
  const onParentAbort = () => {
    for (const c of controllers) c.abort()
  }
  if (opts.signal) {
    if (opts.signal.aborted) onParentAbort()
    else opts.signal.addEventListener('abort', onParentAbort, { once: true })
  }

  try {
    const winner = await new Promise((resolve) => {
      let pending = racers.length
      let resolved = false

      racers.forEach((attempt, idx) => {
        const ctrl = controllers[idx]
        Promise.resolve()
          .then(() => attempt.run(ctrl.signal))
          .then((out) => {
            if (resolved) return
            if (out && out.ok) {
              resolved = true
              // Abort other racers
              controllers.forEach((c, i) => {
                if (i !== idx) c.abort()
              })
              resolve({ ok: true, provider: out.provider || attempt.name, payload: out })
              return
            }
            skipped.push({
              provider: out?.provider || attempt.name,
              reason: String(out?.reason || 'failed').slice(0, 200),
            })
            pending -= 1
            if (pending === 0 && !resolved) resolve(null)
          })
          .catch((err) => {
            if (resolved) return
            const cause = err?.cause?.message || err?.message || String(err)
            skipped.push({ provider: attempt.name, reason: String(cause).slice(0, 200) })
            pending -= 1
            if (pending === 0 && !resolved) resolve(null)
          })
      })
    })

    if (winner && winner.ok) {
      return { ok: true, provider: winner.provider, skipped, payload: winner.payload }
    }
  } finally {
    if (opts.signal) opts.signal.removeEventListener('abort', onParentAbort)
  }

  // If all racers failed and there are remaining fallback providers, try them sequentially
  if (rest.length) {
    const fb = await runProviderChain(rest.map((r) => ({ name: r.name, run: () => r.run(opts.signal) })))
    skipped.push(...fb.skipped)
    if (fb.ok) {
      return { ok: true, provider: fb.provider, skipped, payload: fb.payload }
    }
  }

  return { ok: false, skipped }
}

/**
 * Run top N attempts in parallel, merge and deduplicate results by URL.
 * @param {Array<{ name: string, run: (signal?: AbortSignal) => Promise<any> }>} attempts
 * @param {{ concurrency?: number, limit?: number, signal?: AbortSignal }} [opts]
 */
export async function runProviderAggregate(attempts, opts = {}) {
  const concurrency = Math.max(1, Number(opts.concurrency) || 2)
  const targets = attempts.slice(0, concurrency)
  const rest = attempts.slice(concurrency)
  const skipped = []

  if (!targets.length) return { ok: false, skipped }

  const settled = await Promise.all(
    targets.map(async (attempt) => {
      try {
        const out = await attempt.run(opts.signal)
        if (out && out.ok && Array.isArray(out.results)) {
          return { ok: true, provider: out.provider || attempt.name, results: out.results }
        }
        skipped.push({
          provider: out?.provider || attempt.name,
          reason: String(out?.reason || 'failed').slice(0, 200),
        })
        return { ok: false }
      } catch (err) {
        const cause = err?.cause?.message || err?.message || String(err)
        skipped.push({ provider: attempt.name, reason: String(cause).slice(0, 200) })
        return { ok: false }
      }
    })
  )

  const successes = settled.filter((s) => s.ok)
  if (successes.length > 0) {
    const seen = new Set()
    const merged = []
    const providers = []
    for (const s of successes) {
      providers.push(s.provider)
      for (const item of s.results) {
        if (!item || !item.url) continue
        const key = normalizeDedupeUrl(item.url)
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(item)
      }
    }
    const maxItems = Number(opts.limit) > 0 ? Number(opts.limit) : merged.length
    const finalResults = merged.slice(0, maxItems)
    if (finalResults.length > 0) {
      return {
        ok: true,
        provider: providers.join('+'),
        skipped,
        payload: { ok: true, provider: providers.join('+'), results: finalResults },
      }
    }
  }

  // Fallback to remaining providers if aggregate batch yielded nothing
  if (rest.length) {
    const fb = await runProviderChain(rest.map((r) => ({ name: r.name, run: () => r.run(opts.signal) })))
    skipped.push(...fb.skipped)
    if (fb.ok) {
      return { ok: true, provider: fb.provider, skipped, payload: fb.payload }
    }
  }

  return { ok: false, skipped }
}
