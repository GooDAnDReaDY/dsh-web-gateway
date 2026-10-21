// Provider chain helpers for dsh-web-gateway.

export const SEARCH_PROVIDER_IDS = Object.freeze(['firecrawl', 'keenable', 'searxng', 'duckduckgo', 'tavily', 'brave', 'exa'])
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

function anySignal(signals) {
  const list = signals.filter(Boolean)
  if (!list.length) return undefined
  if (list.length === 1) return list[0]
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(list)
  const controller = new AbortController()
  for (const signal of list) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }
  return controller.signal
}

/**
 * One attempt's signal: the parent signal plus the smaller of the per-attempt
 * timeout and the time left on the run deadline. `expired` means no attempt
 * should start at all.
 */
export function attemptSignal(parent, timeoutMs, deadlineAt) {
  const signals = []
  if (parent) signals.push(parent)
  let ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : 0
  if (deadlineAt) {
    const remaining = deadlineAt - Date.now()
    if (remaining <= 0) return { signal: parent, expired: true }
    ms = ms > 0 ? Math.min(ms, remaining) : remaining
  }
  if (ms > 0) signals.push(AbortSignal.timeout(ms))
  return { signal: anySignal(signals), expired: false }
}

function inferKind(reason, error) {
  if (error?.kind) return error.kind
  if (error?.name === 'UrlPolicyError' || String(error?.code || '').startsWith('WEB_GATEWAY_')) {
    return 'policy'
  }
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'network'
  const text = String(reason || error?.message || '')
  if (/^empty$/i.test(text) || /\bempty\b/i.test(text)) return 'empty'
  if (/\b401\b|\b403\b/.test(text)) return 'auth'
  if (/\b402\b|\b432\b|\b433\b|quota|out of credit/i.test(text)) return 'quota'
  if (/\b429\b|rate.?limit/i.test(text)) return 'rate'
  if (/\b5\d\d\b/.test(text)) return 'server'
  if (/^no |not configured|disabled/i.test(text)) return 'config'
  return undefined
}

/**
 * Run ordered attempts sequentially. Each attempt returns { ok, provider, reason?, ...payload }.
 * Collects skipped providers with reasons; returns first success.
 * opts: { deadlineAt?: number, signal?: AbortSignal, timeoutMs?: number }
 */
export async function runProviderChain(attempts, opts = {}) {
  const skipped = []
  if (!attempts.length) {
    return {
      ok: false,
      skipped: [{ provider: 'filters', reason: 'no provider in the order can honor the request filters' }],
    }
  }

  const skippedKeyProviders = new Set()
  let skipKeyProvider = null

  for (const attempt of attempts) {
    const name = attempt.name
    const provider = attempt.provider || name
    const mode = attempt.mode

    const gate = attemptSignal(opts.signal, opts.timeoutMs, opts.deadlineAt)
    if (gate.expired) {
      skipped.push({ provider: name, reason: 'run deadline spent before this attempt' })
      continue
    }

    if (skipKeyProvider && mode === 'key' && provider === skipKeyProvider) {
      if (!skippedKeyProviders.has(provider)) {
        skippedKeyProviders.add(provider)
        skipped.push({
          provider: `${provider}:key`,
          reason: 'remaining keys not tried after server/network/empty failure',
        })
      }
      continue
    }

    try {
      const out = await attempt.run(gate.signal)
      if (out && out.ok) {
        return { ok: true, provider: out.provider, skipped, payload: out }
      }
      const kind = out?.kind || inferKind(out?.reason)
      skipped.push({
        provider: out?.provider || name,
        reason: String(out?.reason || 'failed').slice(0, 200),
      })
      if (kind === 'policy') break
      if (mode === 'key' && ['server', 'network', 'empty'].includes(kind)) {
        skipKeyProvider = provider
      }
    } catch (err) {
      const cause = err?.cause?.message || err?.message || String(err)
      const kind = err?.kind || inferKind(undefined, err)
      const reason = err?.name === 'TimeoutError'
        ? `attempt timed out after ${Number(opts.timeoutMs) || 0}ms`
        : String(cause).slice(0, 200)
      skipped.push({ provider: name, reason })
      if (kind === 'policy') break
      if (mode === 'key' && ['server', 'network', 'empty'].includes(kind)) {
        skipKeyProvider = provider
      }
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
  if (opts.deadlineAt && Date.now() >= opts.deadlineAt) {
    return {
      ok: false,
      skipped: racers.map((attempt) => ({
        provider: attempt.name,
        reason: 'run deadline spent before this attempt',
      })),
    }
  }

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
          .then(() => {
            const gate = attemptSignal(ctrl.signal, opts.timeoutMs, opts.deadlineAt)
            if (gate.expired) throw new Error('run deadline spent before this attempt')
            return attempt.run(gate.signal)
          })
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
    const fb = await runProviderChain(
      rest.map((r) => ({
        name: r.name,
        provider: r.provider,
        mode: r.mode,
        run: (signal) => r.run(signal ?? opts.signal),
      })),
      { deadlineAt: opts.deadlineAt, signal: opts.signal, timeoutMs: opts.timeoutMs },
    )
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
  if (opts.deadlineAt && Date.now() >= opts.deadlineAt) {
    return {
      ok: false,
      skipped: targets.map((attempt) => ({
        provider: attempt.name,
        reason: 'run deadline spent before this attempt',
      })),
    }
  }

  const settled = await Promise.all(
    targets.map(async (attempt) => {
      const gate = attemptSignal(opts.signal, opts.timeoutMs, opts.deadlineAt)
      if (gate.expired) {
        skipped.push({ provider: attempt.name, reason: 'run deadline spent before this attempt' })
        return { ok: false }
      }
      try {
        const out = await attempt.run(gate.signal)
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
    const fb = await runProviderChain(
      rest.map((r) => ({
        name: r.name,
        provider: r.provider,
        mode: r.mode,
        run: (signal) => r.run(signal ?? opts.signal),
      })),
      { deadlineAt: opts.deadlineAt, signal: opts.signal, timeoutMs: opts.timeoutMs },
    )
    skipped.push(...fb.skipped)
    if (fb.ok) {
      return { ok: true, provider: fb.provider, skipped, payload: fb.payload }
    }
  }

  return { ok: false, skipped }
}
