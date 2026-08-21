// dsh-web-gateway: web_gateway_search / web_gateway_extract tools with a
// resilient fallback chain, Hermes-style.
//
//   web_gateway_search(query, limit?)  -> results [{ title, url, snippet }]
//     chain: tavily -> firecrawl -> exa -> searxng (local, optional)
//     a provider is skipped on error / empty result / 429 / 5xx
//
//   web_gateway_extract(url)           -> { url, provider, markdown }
//     chain: firecrawl scrape -> tavily extract -> crawl4ai (optional)
//
// Tool names deliberately differ from the built-in web_search / web_extract
// (dsh-tool-web) to avoid duplicate-registration collisions; the model picks
// the gateway variants when the built-ins hit rate limits / captchas.
//
// API keys are resolved per call through the credentials service (Settings ->
// Credentials, or $DSH_HOME/.credentials.yaml) under the configured env
// references (TAVILY_API_KEY / FIRECRAWL_API_KEY / EXA_API_KEY /
// CRAWL4AI_TOKEN), falling back to the process environment.
//
// Results are cached in memory (TTL) to protect paid quotas.

import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

export const name = 'dsh-web-gateway'
export const inject = ['tools', 'credentials']

export const Config = z.object({
  defaultLimit: z.number().default(5).description('Default max results for web_gateway_search.'),
  maxLimit: z.number().default(20).description('Hard cap on web_gateway_search limit.'),
  timeoutMs: z.number().default(30000).description('Per-provider request timeout in ms.'),
  cacheTtlMs: z.number().default(600000).description('In-memory result cache TTL in ms (0 disables).'),
  tavilyApiKeyEnv: z.string().default('TAVILY_API_KEY'),
  firecrawlApiKeyEnv: z.string().default('FIRECRAWL_API_KEY'),
  exaApiKeyEnv: z.string().default('EXA_API_KEY'),
  searxngUrl: z.string().default('').description('Optional local SearXNG base URL, e.g. http://127.0.0.1:8080. Empty disables the SearXNG fallback.'),
  crawl4aiUrl: z.string().default('').description('Optional crawl4ai base URL, e.g. http://127.0.0.1:11235. Empty disables the crawl4ai extract fallback.'),
  crawl4aiTokenEnv: z.string().default('CRAWL4AI_TOKEN'),
})

/** Simple in-memory TTL cache. */
function makeCache(ttlMs) {
  const store = new Map()
  return {
    get(key) {
      const hit = store.get(key)
      if (!hit) return undefined
      if (Date.now() - hit.ts > ttlMs) {
        store.delete(key)
        return undefined
      }
      return hit.value
    },
    set(key, value) {
      if (ttlMs <= 0) return
      if (store.size > 512) store.clear()
      store.set(key, { ts: Date.now(), value })
    },
  }
}

async function resolveApiKey(ctx, ref) {
  try {
    const resolved = await ctx.credentials.resolve(credentialRef(ref))
    if (resolved && resolved.value) return resolved.value
  } catch {
    // fall through to the environment
  }
  const fromEnv = process.env[ref]
  if (fromEnv) return fromEnv
  return ''
}

function normalizeError(err) {
  const cause = err?.cause?.message || err?.message || String(err)
  return cause.slice(0, 200)
}

async function postJSON(url, body, headers, signal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ── search providers ────────────────────────────────────────────────────────

async function tavilySearch(ctx, cfg, query, limit, depth, signal) {
  const key = await resolveApiKey(ctx, cfg.tavilyApiKeyEnv)
  if (!key) return { ok: false, reason: 'no TAVILY_API_KEY' }
  const data = await postJSON(
    'https://api.tavily.com/search',
    { api_key: key, query, max_results: limit, search_depth: depth },
    {},
    signal,
  )
  const results = (data.results || []).map((r) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.content || '',
  }))
  return { ok: results.length > 0, provider: 'tavily', results, reason: results.length ? '' : 'empty' }
}

async function firecrawlSearch(ctx, cfg, query, limit, signal) {
  const key = await resolveApiKey(ctx, cfg.firecrawlApiKeyEnv)
  if (!key) return { ok: false, reason: 'no FIRECRAWL_API_KEY' }
  const data = await postJSON(
    'https://api.firecrawl.dev/v1/search',
    { query, limit, lang: 'en' },
    { authorization: `Bearer ${key}` },
    signal,
  )
  const results = ((data.data || data.results || []).slice(0, limit)).map((r) => ({
    title: r.title || r.name || '',
    url: r.url || '',
    snippet: r.description || r.snippet || '',
  }))
  return { ok: results.length > 0, provider: 'firecrawl', results, reason: results.length ? '' : 'empty' }
}

async function exaSearch(ctx, cfg, query, limit, signal) {
  const key = await resolveApiKey(ctx, cfg.exaApiKeyEnv)
  if (!key) return { ok: false, reason: 'no EXA_API_KEY' }
  const data = await postJSON(
    'https://api.exa.ai/search',
    { query, numResults: limit, contents: { text: true } },
    { 'x-api-key': key },
    signal,
  )
  const results = (data.results || []).map((r) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: (r.text || r.snippet || '').slice(0, 400),
  }))
  return { ok: results.length > 0, provider: 'exa', results, reason: results.length ? '' : 'empty' }
}

async function searxngSearch(ctx, cfg, query, limit, signal) {
  const base = cfg.searxngUrl
  if (!base) return { ok: false, reason: 'searxng not configured' }
  const url = `${base.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}`)
  const data = await res.json()
  const results = (data.results || []).slice(0, limit).map((r) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.content || '',
  }))
  return { ok: results.length > 0, provider: 'searxng', results, reason: results.length ? '' : 'empty' }
}

// ── extract providers ───────────────────────────────────────────────────────

async function firecrawlExtract(ctx, cfg, url, signal) {
  const key = await resolveApiKey(ctx, cfg.firecrawlApiKeyEnv)
  if (!key) return { ok: false, reason: 'no FIRECRAWL_API_KEY' }
  const data = await postJSON(
    'https://api.firecrawl.dev/v1/scrape',
    { url, formats: ['markdown'] },
    { authorization: `Bearer ${key}` },
    signal,
  )
  const markdown = data?.data?.markdown || data?.markdown || ''
  return { ok: markdown.length > 0, provider: 'firecrawl', markdown, reason: markdown.length ? '' : 'empty' }
}

async function tavilyExtract(ctx, cfg, url, signal) {
  const key = await resolveApiKey(ctx, cfg.tavilyApiKeyEnv)
  if (!key) return { ok: false, reason: 'no TAVILY_API_KEY' }
  const data = await postJSON(
    'https://api.tavily.com/extract',
    { api_key: key, urls: [url] },
    {},
    signal,
  )
  const raw = data?.results?.[0]?.raw_content || ''
  return { ok: raw.length > 0, provider: 'tavily', markdown: raw, reason: raw.length ? '' : 'empty' }
}

async function crawl4aiExtract(ctx, cfg, url, signal) {
  const base = cfg.crawl4aiUrl
  if (!base) return { ok: false, reason: 'crawl4ai not configured' }
  const token = await resolveApiKey(ctx, cfg.crawl4aiTokenEnv)
  const headers = token ? { authorization: `Bearer ${token}` } : {}
  const data = await postJSON(`${base.replace(/\/$/, '')}/v0/scrape`, { url, formats: ['markdown'] }, headers, signal)
  const markdown = data?.data?.markdown || data?.markdown || data?.result?.markdown || ''
  return { ok: markdown.length > 0, provider: 'crawl4ai', markdown, reason: markdown.length ? '' : 'empty' }
}

// ── plugin ──────────────────────────────────────────────────────────────────

export function apply(ctx, config) {
  const cache = makeCache(config.cacheTtlMs)

  ctx.tools.register(
    defineTool({
      name: 'web_gateway_search',
      description:
        'Search the web through a resilient fallback chain (tavily -> firecrawl -> exa -> local searxng) ' +
        'and return results (title, url, snippet). A single provider outage / rate limit / captcha does not fail the query. ' +
        'Prefer this over the built-in web_search when the built-in hits rate limits, captchas, or empty results.',
      parameters: {
        query: {
          type: 'string',
          required: true,
          description: 'The search query.',
        },
        limit: {
          type: 'integer',
          description: `Max results (default ${config.defaultLimit}, cap ${config.maxLimit}).`,
        },
        search_depth: {
          type: 'string',
          enum: ['basic', 'advanced'],
          description: 'Search depth (only used by the tavily provider). Default basic.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            provider: { type: 'string' },
            results: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  title: { type: 'string' },
                  url: { type: 'string' },
                  snippet: { type: 'string' },
                },
              },
            },
            tookMs: { type: 'integer' },
          },
        },
        render(args, value) {
          const lines = [`web_gateway_search: ${value.results.length} result(s) via ${value.provider} (${value.tookMs}ms)`]
          for (const r of value.results) {
            lines.push(`- ${r.title}\n  ${r.url}\n  ${r.snippet.slice(0, 300)}`)
          }
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      isConcurrencySafe: () => false,
      timeoutMs: config.timeoutMs * 3 + 5000,
      async execute(args, exec) {
        const t0 = Date.now()
        const query = String(args.query).trim()
        if (!query) throw new Error('web_gateway_search: query is required')
        const limit = Math.min(Math.max(1, args.limit ?? config.defaultLimit), config.maxLimit)
        const depth = args.search_depth === 'advanced' ? 'advanced' : 'basic'

        const cacheKey = `gsearch:${query}:${limit}`
        const cached = cache.get(cacheKey)
        if (cached) return { ...cached, tookMs: Date.now() - t0 }

        const chain = [
          () => tavilySearch(ctx, config, query, limit, depth, exec.signal),
          () => firecrawlSearch(ctx, config, query, limit, exec.signal),
          () => exaSearch(ctx, config, query, limit, exec.signal),
          () => searxngSearch(ctx, config, query, limit, exec.signal),
        ]

        const errors = []
        for (const attempt of chain) {
          try {
            const out = await attempt()
            if (out.ok) {
              const value = { provider: out.provider, results: out.results, tookMs: Date.now() - t0 }
              cache.set(cacheKey, value)
              return value
            }
            errors.push(`${out.provider}: ${out.reason}`)
          } catch (err) {
            errors.push(normalizeError(err))
          }
        }
        throw new Error(`web_gateway_search: all providers failed (${errors.join('; ')})`)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'web_gateway_extract',
      description:
        'Fetch a URL and extract its readable text content as markdown through a resilient fallback chain ' +
        '(firecrawl -> tavily -> optional crawl4ai). Use to read the full content of a page found by ' +
        'web_gateway_search or the built-in web_search. Prefer this when the built-in web_extract fails ' +
        'or hits rate limits.',
      parameters: {
        url: {
          type: 'string',
          required: true,
          description: 'The URL to fetch and extract.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            provider: { type: 'string' },
            url: { type: 'string' },
            markdown: { type: 'string' },
            tookMs: { type: 'integer' },
          },
        },
        render(args, value) {
          const body = value.markdown.length > 4000 ? `${value.markdown.slice(0, 4000)}\n…[truncated ${value.markdown.length} chars]` : value.markdown
          return [{ type: 'text', text: `web_gateway_extract (${value.provider}, ${value.tookMs}ms): ${value.url}\n\n${body}` }]
        },
      },
      isConcurrencySafe: () => false,
      timeoutMs: config.timeoutMs * 3 + 5000,
      async execute(args, exec) {
        const t0 = Date.now()
        const url = String(args.url).trim()
        if (!/^https?:\/\//i.test(url)) throw new Error('web_gateway_extract: url must start with http(s)://')

        const cacheKey = `gextract:${url}`
        const cached = cache.get(cacheKey)
        if (cached) return { ...cached, tookMs: Date.now() - t0 }

        const chain = [
          () => firecrawlExtract(ctx, config, url, exec.signal),
          () => tavilyExtract(ctx, config, url, exec.signal),
          () => crawl4aiExtract(ctx, config, url, exec.signal),
        ]

        const errors = []
        for (const attempt of chain) {
          try {
            const out = await attempt()
            if (out.ok) {
              const value = { provider: out.provider, url, markdown: out.markdown, tookMs: Date.now() - t0 }
              cache.set(cacheKey, value)
              return value
            }
            errors.push(`${out.provider}: ${out.reason}`)
          } catch (err) {
            errors.push(normalizeError(err))
          }
        }
        throw new Error(`web_gateway_extract: all providers failed (${errors.join('; ')})`)
      },
    }),
  )
}
