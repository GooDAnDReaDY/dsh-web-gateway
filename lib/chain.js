// Provider chain helpers for dsh-web-gateway.

export const SEARCH_PROVIDER_IDS = Object.freeze(['tavily', 'firecrawl', 'exa', 'searxng'])
export const EXTRACT_PROVIDER_IDS = Object.freeze(['firecrawl', 'tavily', 'crawl4ai', 'jina', 'readability'])

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

/**
 * Run ordered attempts. Each attempt returns { ok, provider, reason?, ...payload }.
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
