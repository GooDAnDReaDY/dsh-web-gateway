/** Search filter helpers (domains + freshness). */

export const FRESHNESS_VALUES = Object.freeze(['any', 'day', 'week', 'month'])

export function parseDomainList(raw) {
  return String(raw ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((d) => d.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
}

export function normalizeFreshness(raw) {
  const v = String(raw ?? 'any').trim().toLowerCase()
  return FRESHNESS_VALUES.includes(v) ? v : 'any'
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function domainMatches(host, domain) {
  if (!host || !domain) return false
  return host === domain || host.endsWith(`.${domain}`)
}

/**
 * Filter search results by include/exclude domain lists (client-side safety net).
 */
export function filterSearchResults(results, includeDomains, excludeDomains) {
  const include = parseDomainList(includeDomains)
  const exclude = parseDomainList(excludeDomains)
  return (results || []).filter((r) => {
    const host = hostOf(r.url)
    if (!host) return false
    if (exclude.some((d) => domainMatches(host, d))) return false
    if (include.length && !include.some((d) => domainMatches(host, d))) return false
    return true
  })
}

/** Map freshness to Tavily `days` (approximate). */
export function freshnessToTavilyDays(freshness) {
  switch (normalizeFreshness(freshness)) {
    case 'day': return 1
    case 'week': return 7
    case 'month': return 30
    default: return undefined
  }
}

/** Map freshness to SearXNG time_range. */
export function freshnessToSearxngRange(freshness) {
  switch (normalizeFreshness(freshness)) {
    case 'day': return 'day'
    case 'week': return 'week'
    case 'month': return 'month'
    default: return undefined
  }
}

/** ISO date lower bound for Exa startPublishedDate. */
export function freshnessToExaStart(freshness, now = new Date()) {
  const f = normalizeFreshness(freshness)
  if (f === 'any') return undefined
  const d = new Date(now)
  if (f === 'day') d.setUTCDate(d.getUTCDate() - 1)
  else if (f === 'week') d.setUTCDate(d.getUTCDate() - 7)
  else if (f === 'month') d.setUTCDate(d.getUTCDate() - 30)
  return d.toISOString()
}
