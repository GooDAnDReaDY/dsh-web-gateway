// Search and extract providers for dsh-web-gateway.
import {
  assertExtractUrlAllowed,
  assertSameOriginRedirect,
  MAX_REDIRECTS,
  UrlPolicyError,
} from './url-policy.js'

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

export async function tavilySearch(ctx, cfg, query, limit, depth, signal, fetchImpl = fetch) {
  const key = await resolveApiKey(ctx, cfg.tavilyApiKeyEnv)
  if (!key) return { ok: false, provider: 'tavily', reason: 'no TAVILY_API_KEY' }
  const data = await postJSON(
    'https://api.tavily.com/search',
    { api_key: key, query, max_results: limit, search_depth: depth },
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

export async function firecrawlSearch(ctx, cfg, query, limit, signal, fetchImpl = fetch) {
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

export async function exaSearch(ctx, cfg, query, limit, signal, fetchImpl = fetch) {
  const key = await resolveApiKey(ctx, cfg.exaApiKeyEnv)
  if (!key) return { ok: false, provider: 'exa', reason: 'no EXA_API_KEY' }
  const data = await postJSON(
    'https://api.exa.ai/search',
    { query, numResults: limit, contents: { text: true } },
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

export async function searxngSearch(ctx, cfg, query, limit, signal, fetchImpl = fetch) {
  const base = cfg.searxngUrl
  if (!base) return { ok: false, provider: 'searxng', reason: 'searxng not configured' }
  const url = `${base.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json`
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
