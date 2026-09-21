// Search and extract providers for dsh-web-gateway.
import {
  assertExtractUrlAllowed,
  assertSameOriginRedirect,
  MAX_REDIRECTS,
  UrlPolicyError,
} from './url-policy.js'
import {
  freshnessToExaStart,
  freshnessToSearxngRange,
  freshnessToTavilyDays,
  parseDomainList,
} from './filters.js'

export function normalizeError(err) {
  const cause = err?.cause?.message || err?.message || String(err)
  return cause.slice(0, 200)
}

async function toCredentialRef(ref) {
  try {
    const mod = await import('@deepseek-ai/dsh-credentials')
    if (typeof mod.credentialRef === 'function') return mod.credentialRef(ref)
  } catch {
    // Package missing in offline unit tests — fall back to the bare name.
  }
  return ref
}

export async function resolveApiKey(ctx, ref) {
  try {
    if (ctx?.credentials && typeof ctx.credentials.resolve === 'function') {
      const resolved = await ctx.credentials.resolve(await toCredentialRef(ref))
      if (resolved && resolved.value) return resolved.value
    }
  } catch {
    // fall through to the environment
  }
  const fromEnv = process.env[ref]
  if (fromEnv) return fromEnv
  return ''
}

export async function postJSON(url, body, headers, signal, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
    redirect: 'manual',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function tavilySearch(ctx, cfg, query, limit, depth, signal, fetchImpl = fetch, filters = {}) {
  const key = await resolveApiKey(ctx, cfg.tavilyApiKeyEnv)
  if (!key) return { ok: false, provider: 'tavily', reason: 'no TAVILY_API_KEY' }
  const body = { api_key: key, query, max_results: limit, search_depth: depth }
  const include = parseDomainList(filters.includeDomains)
  const exclude = parseDomainList(filters.excludeDomains)
  if (include.length) body.include_domains = include
  if (exclude.length) body.exclude_domains = exclude
  const days = freshnessToTavilyDays(filters.freshness)
  if (days) body.days = days
  const data = await postJSON(
    'https://api.tavily.com/search',
    body,
    {},
    signal,
    fetchImpl,
  )
  const results = (data.results || []).map((r) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.content || '',
  }))
  return { ok: results.length > 0, provider: 'tavily', results, reason: results.length ? '' : 'empty' }
}

export async function firecrawlSearch(ctx, cfg, query, limit, signal, fetchImpl = fetch, filters = {}) {
  const key = await resolveApiKey(ctx, cfg.firecrawlApiKeyEnv)
  if (!key) return { ok: false, provider: 'firecrawl', reason: 'no FIRECRAWL_API_KEY' }
  const data = await postJSON(
    'https://api.firecrawl.dev/v1/search',
    { query, limit, lang: 'en' },
    { authorization: `Bearer ${key}` },
    signal,
    fetchImpl,
  )
  const results = ((data.data || data.results || []).slice(0, limit)).map((r) => ({
    title: r.title || r.name || '',
    url: r.url || '',
    snippet: r.description || r.snippet || '',
  }))
  return { ok: results.length > 0, provider: 'firecrawl', results, reason: results.length ? '' : 'empty' }
}

export async function exaSearch(ctx, cfg, query, limit, signal, fetchImpl = fetch, filters = {}) {
  const key = await resolveApiKey(ctx, cfg.exaApiKeyEnv)
  if (!key) return { ok: false, provider: 'exa', reason: 'no EXA_API_KEY' }
  const body = { query, numResults: limit, contents: { text: true } }
  const start = freshnessToExaStart(filters.freshness)
  if (start) body.startPublishedDate = start
  const include = parseDomainList(filters.includeDomains)
  if (include.length) body.includeDomains = include
  const exclude = parseDomainList(filters.excludeDomains)
  if (exclude.length) body.excludeDomains = exclude
  const data = await postJSON(
    'https://api.exa.ai/search',
    body,
    { 'x-api-key': key },
    signal,
    fetchImpl,
  )
  const results = (data.results || []).map((r) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: (r.text || r.snippet || '').slice(0, 400),
  }))
  return { ok: results.length > 0, provider: 'exa', results, reason: results.length ? '' : 'empty' }
}

export async function searxngSearch(ctx, cfg, query, limit, signal, fetchImpl = fetch, filters = {}) {
  const base = cfg.searxngUrl
  if (!base) return { ok: false, provider: 'searxng', reason: 'searxng not configured' }
  const params = new URLSearchParams({ q: query, format: 'json' })
  const range = freshnessToSearxngRange(filters.freshness)
  if (range) params.set('time_range', range)
  const url = `${base.replace(/\/$/, '')}/search?${params.toString()}`
  const res = await fetchImpl(url, { signal, redirect: 'manual' })
  if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}`)
  const data = await res.json()
  const results = (data.results || []).slice(0, limit).map((r) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.content || '',
  }))
  return { ok: results.length > 0, provider: 'searxng', results, reason: results.length ? '' : 'empty' }
}

export async function firecrawlExtract(ctx, cfg, url, signal, fetchImpl = fetch) {
  const key = await resolveApiKey(ctx, cfg.firecrawlApiKeyEnv)
  if (!key) return { ok: false, provider: 'firecrawl', reason: 'no FIRECRAWL_API_KEY' }
  const data = await postJSON(
    'https://api.firecrawl.dev/v1/scrape',
    { url, formats: ['markdown'] },
    { authorization: `Bearer ${key}` },
    signal,
    fetchImpl,
  )
  const markdown = data?.data?.markdown || data?.markdown || ''
  return { ok: markdown.length > 0, provider: 'firecrawl', markdown, reason: markdown.length ? '' : 'empty' }
}

export async function tavilyExtract(ctx, cfg, url, signal, fetchImpl = fetch) {
  const key = await resolveApiKey(ctx, cfg.tavilyApiKeyEnv)
  if (!key) return { ok: false, provider: 'tavily', reason: 'no TAVILY_API_KEY' }
  const data = await postJSON(
    'https://api.tavily.com/extract',
    { api_key: key, urls: [url] },
    {},
    signal,
    fetchImpl,
  )
  const raw = data?.results?.[0]?.raw_content || ''
  return { ok: raw.length > 0, provider: 'tavily', markdown: raw, reason: raw.length ? '' : 'empty' }
}

export async function crawl4aiExtract(ctx, cfg, url, signal, fetchImpl = fetch) {
  const base = cfg.crawl4aiUrl
  if (!base) return { ok: false, provider: 'crawl4ai', reason: 'crawl4ai not configured' }
  const token = await resolveApiKey(ctx, cfg.crawl4aiTokenEnv)
  const headers = token ? { authorization: `Bearer ${token}` } : {}
  const data = await postJSON(
    `${base.replace(/\/$/, '')}/v0/scrape`,
    { url, formats: ['markdown'] },
    headers,
    signal,
    fetchImpl,
  )
  const markdown = data?.data?.markdown || data?.markdown || data?.result?.markdown || ''
  return { ok: markdown.length > 0, provider: 'crawl4ai', markdown, reason: markdown.length ? '' : 'empty' }
}


export async function jinaExtract(ctx, cfg, url, signal, fetchImpl = fetch) {
  if (cfg.jinaEnabled === false) return { ok: false, provider: 'jina', reason: 'jina disabled' }
  const target = `https://r.jina.ai/${url}`
  const res = await fetchImpl(target, {
    method: 'GET',
    headers: { accept: 'text/plain' },
    signal,
    redirect: 'manual',
  })
  if (!res.ok) throw new Error(`Jina HTTP ${res.status}`)
  const markdown = String(await res.text() || '').trim()
  return { ok: markdown.length > 0, provider: 'jina', markdown, reason: markdown.length ? '' : 'empty' }
}

/** Last-resort keyless extract: fetch HTML and strip tags (best-effort, not a full browser). */
export async function readabilityExtract(ctx, cfg, url, signal, fetchImpl = fetch) {
  if (cfg.readabilityEnabled === false) return { ok: false, provider: 'readability', reason: 'readability disabled' }
  const res = await fetchImpl(url, {
    method: 'GET',
    headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' },
    signal,
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = String(await res.text() || '')
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|h[1-6]|li|br|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  if (text.length > 20000) text = `${text.slice(0, 20000)}\n…[truncated]`
  return { ok: text.length > 80, provider: 'readability', markdown: text, reason: text.length > 80 ? '' : 'empty' }
}

/**
 * Validate extract target URL (scheme + public DNS) before calling any provider.
 */
export async function prepareExtractUrl(rawUrl, cfg, opts = {}) {
  return assertExtractUrlAllowed(rawUrl, {
    allowInternal: !!cfg.allowInternalUrls,
    resolve: opts.resolve,
    signal: opts.signal,
  })
}

export {
  assertExtractUrlAllowed,
  assertSameOriginRedirect,
  MAX_REDIRECTS,
  UrlPolicyError,
}
