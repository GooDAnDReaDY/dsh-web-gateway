// dsh-web-gateway: resilient web search & extract tools for DeepSeek Harness.
//
//   web_gateway_search(query, limit?)  -> results [{ title, url, snippet }]
//     chain: configurable (default tavily -> firecrawl -> exa -> searxng)
//
//   web_gateway_extract(url)           -> { url, provider, markdown }
//     chain: configurable (default firecrawl -> tavily -> crawl4ai)
//
// Tool names differ from built-in web_search / web_fetch to avoid collisions.

import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { makeCache } from './cache.js'
import { makeDiskCache, makeLayeredCache } from './disk-cache.js'
import { capsFromConfig, makeDailyCaps } from './caps.js'
import { filterSearchResults, normalizeFreshness } from './filters.js'
import {
  DEFAULT_EXTRACT_ORDER,
  DEFAULT_SEARCH_ORDER,
  EXTRACT_PROVIDER_IDS,
  SEARCH_PROVIDER_IDS,
  parseProviderOrder,
  runProviderChain,
} from './chain.js'
import { buildHealthSnapshot } from './health.js'
import {
  crawl4aiExtract,
  exaSearch,
  firecrawlExtract,
  firecrawlSearch,
  jinaExtract,
  normalizeError,
  prepareExtractUrl,
  readabilityExtract,
  searxngSearch,
  tavilyExtract,
  tavilySearch,
  UrlPolicyError,
} from './providers.js'
import { registerPluginUpdater } from './updater.js'

export const name = 'dsh-web-gateway'
export const NS = 'dsh-web-gateway'
export const inject = ['tools', 'credentials']

export const Config = z.object({
  defaultLimit: z.number().default(5).description('Default max results for web_gateway_search.'),
  maxLimit: z.number().default(20).description('Hard cap on web_gateway_search limit.'),
  timeoutMs: z.number().default(30000).description('Per-provider request timeout in ms.'),
  cacheTtlMs: z.number().default(600000).description('Result cache TTL in ms (0 disables). Applies to memory and disk layers.'),
  diskCacheEnabled: z.boolean().default(true).description('Persist search/extract cache on disk under the DSH profile.'),
  diskCacheMaxEntries: z.number().default(500).description('Soft max disk cache entries.'),
  includeDomains: z.string().default('').description('Comma-separated allowlist of search result domains (empty = all).'),
  excludeDomains: z.string().default('').description('Comma-separated denylist of search result domains.'),
  freshness: z.string().default('any').description('Search freshness: any | day | week | month.'),
  dailyCapTavily: z.number().default(0).description('Daily call cap for tavily (0 = unlimited, UTC day).'),
  dailyCapFirecrawl: z.number().default(0).description('Daily call cap for firecrawl (0 = unlimited, UTC day).'),
  dailyCapExa: z.number().default(0).description('Daily call cap for exa (0 = unlimited, UTC day).'),
  dailyCapSearxng: z.number().default(0).description('Daily call cap for searxng (0 = unlimited, UTC day).'),
  dailyCapCrawl4ai: z.number().default(0).description('Daily call cap for crawl4ai (0 = unlimited, UTC day).'),
  dailyCapJina: z.number().default(0).description('Daily call cap for jina (0 = unlimited, UTC day).'),
  dailyCapReadability: z.number().default(0).description('Daily call cap for readability (0 = unlimited, UTC day).'),
  jinaEnabled: z.boolean().default(true).description('Enable keyless Jina Reader extract fallback (https://r.jina.ai).'),
  readabilityEnabled: z.boolean().default(true).description('Enable keyless HTML-strip extract fallback.'),
  researchDefaultLimit: z.number().default(3).description('Default number of sources for web_gateway_research.'),
  researchMaxLimit: z.number().default(5).description('Hard cap on web_gateway_research sources.'),
  researchMaxChars: z.number().default(12000).description('Max combined markdown chars returned by web_gateway_research.'),
  searchProviderOrder: z.string().default(DEFAULT_SEARCH_ORDER).description(
    'Comma-separated search provider order. Allowed: tavily, firecrawl, exa, searxng.',
  ),
  extractProviderOrder: z.string().default(DEFAULT_EXTRACT_ORDER).description(
    'Comma-separated extract provider order. Allowed: firecrawl, tavily, crawl4ai.',
  ),
  tavilyApiKeyEnv: z.string().default('TAVILY_API_KEY'),
  firecrawlApiKeyEnv: z.string().default('FIRECRAWL_API_KEY'),
  exaApiKeyEnv: z.string().default('EXA_API_KEY'),
  searxngUrl: z.string().default('').description('Optional local SearXNG base URL. Empty disables the SearXNG fallback.'),
  crawl4aiUrl: z.string().default('').description('Optional crawl4ai base URL. Empty disables the crawl4ai extract fallback.'),
  crawl4aiTokenEnv: z.string().default('CRAWL4AI_TOKEN'),
  allowInternalUrls: z.boolean().default(false).description(
    'Allow extract targets that resolve to loopback/private/link-local addresses. Off by default (SSRF protection).',
  ),
})

function registerSafeTool(ctx, tool, label) {
  try {
    return ctx.tools.register(tool)
  } catch (err) {
    const msg = `[dsh-web-gateway] failed to register ${label}: ${err?.message || err}`
    if (typeof ctx.logger?.warn === 'function') ctx.logger.warn(msg)
    else if (typeof console !== 'undefined' && console.warn) console.warn(msg)
    return () => {}
  }
}

const skippedSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      provider: { type: 'string' },
      reason: { type: 'string' },
    },
  },
}

export function apply(ctx, config) {
  let live
  try {
    live = Config(structuredClone(config ?? {})) ?? config
  } catch {
    live = Config({}) ?? {}
  }

  const getConfig = () => live || {}
  const dailyCaps = makeDailyCaps()

  function rebuildCache(cfg) {
    const ttl = Number(cfg?.cacheTtlMs) || 0
    const memory = makeCache(ttl)
    if (!cfg?.diskCacheEnabled || ttl <= 0) return memory
    const disk = makeDiskCache({
      ttlMs: ttl,
      maxEntries: Number(cfg.diskCacheMaxEntries) || 500,
    })
    return makeLayeredCache({ memory, disk })
  }

  let cache = rebuildCache(live)

  ctx.inject(['settings'], (sctx) => {
    try {
      const scope = sctx.settings?.register?.(NS, Config, { base: config })
      if (!scope) {
        const msg = '[dsh-web-gateway] settings.register unavailable; using defaults'
        if (typeof sctx.logger?.warn === 'function') sctx.logger.warn(msg)
        return
      }
      if (typeof scope.get === 'function') {
        try {
          const fresh = scope.get()
          if (fresh && typeof fresh === 'object') {
            live = fresh
            cache = rebuildCache(live)
          }
        } catch (readErr) {
          const msg = `[dsh-web-gateway] settings get failed: ${readErr?.message || readErr}`
          if (typeof sctx.logger?.warn === 'function') sctx.logger.warn(msg)
        }
      }
      if (typeof scope.watch === 'function') {
        sctx.effect(() => scope.watch((next) => {
          if (next && typeof next === 'object') {
            live = next
            cache = rebuildCache(live)
          }
        }))
      }
    } catch (err) {
      const msg = `[dsh-web-gateway] settings registration failed: ${err?.message || err}`
      if (typeof sctx.logger?.warn === 'function') sctx.logger.warn(msg)
    }
  })

  ctx.inject(['webServer'], (wctx) => {
    try {
      wctx.effect(() => registerPluginUpdater(wctx, {
        endpoint: '/api/dsh-web-gateway/update',
        packageName: '@goodandready/dsh-web-gateway',
        manifestUrl: new URL('../package.json', import.meta.url),
      }), 'dsh-web-gateway: plugin updater')
    } catch (err) {
      const msg = `[dsh-web-gateway] updater route failed: ${err?.message || err}`
      if (typeof wctx.logger?.warn === 'function') wctx.logger.warn(msg)
    }

    try {
      wctx.effect(() => wctx.webServer.register({
        kind: 'exact',
        path: '/api/dsh-web-gateway/health',
        handler: async (request, response) => {
          try {
            if (request.method !== 'GET' && request.method !== 'HEAD') {
              response.writeHead(405, { allow: 'GET, HEAD' })
              response.end()
              return
            }
            const cfg = getConfig()
            const snap = await buildHealthSnapshot(wctx, cfg, globalThis.fetch)
            snap.dailyCaps = dailyCaps.snapshot(capsFromConfig(cfg))
            const body = JSON.stringify(snap)
            response.writeHead(200, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            })
            response.end(request.method === 'HEAD' ? undefined : body)
          } catch (err) {
            const body = JSON.stringify({ error: String(err?.message || err) })
            response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
            response.end(body)
          }
        },
      }), 'dsh-web-gateway: health')
    } catch (err) {
      const msg = `[dsh-web-gateway] health route failed: ${err?.message || err}`
      if (typeof wctx.logger?.warn === 'function') wctx.logger.warn(msg)
    }
  })

  const fetchImpl = globalThis.fetch

  function withCap(provider, cfg, run) {
    return async () => {
      const caps = capsFromConfig(cfg)
      const gate = dailyCaps.check(provider, caps[provider])
      if (!gate.ok) return { ok: false, provider, reason: gate.reason }
      const out = await run()
      if (out?.ok) dailyCaps.record(provider)
      return out
    }
  }

  const searchRunners = {
    tavily: (cfg, query, limit, depth, signal, filters) => withCap('tavily', cfg, () => tavilySearch(ctx, cfg, query, limit, depth, signal, fetchImpl, filters)),
    firecrawl: (cfg, query, limit, _depth, signal, filters) => withCap('firecrawl', cfg, () => firecrawlSearch(ctx, cfg, query, limit, signal, fetchImpl, filters)),
    exa: (cfg, query, limit, _depth, signal, filters) => withCap('exa', cfg, () => exaSearch(ctx, cfg, query, limit, signal, fetchImpl, filters)),
    searxng: (cfg, query, limit, _depth, signal, filters) => withCap('searxng', cfg, () => searxngSearch(ctx, cfg, query, limit, signal, fetchImpl, filters)),
  }

  const extractRunners = {
    firecrawl: (cfg, url, signal) => withCap('firecrawl', cfg, () => firecrawlExtract(ctx, cfg, url, signal, fetchImpl)),
    tavily: (cfg, url, signal) => withCap('tavily', cfg, () => tavilyExtract(ctx, cfg, url, signal, fetchImpl)),
    crawl4ai: (cfg, url, signal) => withCap('crawl4ai', cfg, () => crawl4aiExtract(ctx, cfg, url, signal, fetchImpl)),
    jina: (cfg, url, signal) => withCap('jina', cfg, () => jinaExtract(ctx, cfg, url, signal, fetchImpl)),
    readability: (cfg, url, signal) => withCap('readability', cfg, () => readabilityExtract(ctx, cfg, url, signal, fetchImpl)),
  }

  async function runExtract(url, cfg, signal) {
    const order = parseProviderOrder(cfg.extractProviderOrder, EXTRACT_PROVIDER_IDS)
    const attempts = order.map((id) => ({
      name: id,
      run: extractRunners[id](cfg, url, signal),
    }))
    return runProviderChain(attempts)
  }

  async function runSearch(query, limit, depth, filters, cfg, signal) {
    const order = parseProviderOrder(cfg.searchProviderOrder, SEARCH_PROVIDER_IDS)
    const attempts = order.map((id) => ({
      name: id,
      run: searchRunners[id](cfg, query, limit, depth, signal, filters),
    }))
    return runProviderChain(attempts)
  }

  registerSafeTool(ctx, defineTool({
    name: 'web_gateway_search',
    description:
      'Search the web through a resilient fallback chain (default: tavily -> firecrawl -> exa -> local searxng) '
      + 'and return results (title, url, snippet) plus which providers were skipped. Prefer this over built-in '
      + 'web_search when the built-in hits rate limits, captchas, or empty results.',
    parameters: {
      query: { type: 'string', required: true, description: 'The search query.' },
      limit: { type: 'integer', description: 'Max results (bounded by plugin settings).' },
      search_depth: {
        type: 'string',
        enum: ['basic', 'advanced'],
        description: 'Search depth (only used by the tavily provider). Default basic.',
      },
      include_domains: { type: 'string', description: 'Comma-separated domain allowlist (overrides settings when set).' },
      exclude_domains: { type: 'string', description: 'Comma-separated domain denylist (overrides settings when set).' },
      freshness: {
        type: 'string',
        enum: ['any', 'day', 'week', 'month'],
        description: 'Recency filter (overrides settings when set).',
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
          skipped: skippedSchema,
          cached: { type: 'boolean' },
          tookMs: { type: 'integer' },
        },
      },
      render(_args, value) {
        const skip = (value.skipped || []).map((s) => `${s.provider}:${s.reason}`).join(', ')
        const lines = [
          `web_gateway_search: ${value.results.length} result(s) via ${value.provider}`
            + `${value.cached ? ' (cached)' : ''} (${value.tookMs}ms)`
            + (skip ? `; skipped [${skip}]` : ''),
        ]
        for (const r of value.results) {
          lines.push(`- ${r.title}\n  ${r.url}\n  ${r.snippet.slice(0, 300)}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    isConcurrencySafe: () => false,
    timeoutMs: (Number(getConfig().timeoutMs) || 30000) * 3 + 5000,
    async execute(args, exec) {
      const cfg = getConfig()
      const t0 = Date.now()
      const query = String(args.query).trim()
      if (!query) throw new Error('web_gateway_search: query is required')
      const defaultLimit = Number(cfg.defaultLimit) || 5
      const maxLimit = Number(cfg.maxLimit) || 20
      const limit = Math.min(Math.max(1, args.limit ?? defaultLimit), maxLimit)
      const depth = args.search_depth === 'advanced' ? 'advanced' : 'basic'
      const filters = {
        includeDomains: args.include_domains != null && String(args.include_domains).trim() !== ''
          ? args.include_domains
          : (cfg.includeDomains || ''),
        excludeDomains: args.exclude_domains != null && String(args.exclude_domains).trim() !== ''
          ? args.exclude_domains
          : (cfg.excludeDomains || ''),
        freshness: normalizeFreshness(
          args.freshness != null && String(args.freshness).trim() !== ''
            ? args.freshness
            : (cfg.freshness || 'any'),
        ),
      }

      const order = parseProviderOrder(cfg.searchProviderOrder, SEARCH_PROVIDER_IDS)
      const cacheKey = `gsearch:${query}:${limit}:${depth}:${order.join('>')}:${filters.includeDomains}|${filters.excludeDomains}|${filters.freshness}`
      const cached = cache.get(cacheKey)
      if (cached) return { ...cached, cached: true, tookMs: Date.now() - t0 }

      const attempts = order.map((id) => ({
        name: id,
        run: searchRunners[id](cfg, query, limit, depth, exec.signal, filters),
      }))

      const outcome = await runProviderChain(attempts)
      if (!outcome.ok) {
        const detail = outcome.skipped.map((s) => `${s.provider}: ${s.reason}`).join('; ')
        throw new Error(`web_gateway_search: all providers failed (${detail})`)
      }
      const filtered = filterSearchResults(
        outcome.payload.results,
        filters.includeDomains,
        filters.excludeDomains,
      )
      if (!filtered.length) {
        throw new Error('web_gateway_search: all results filtered out by domain policy')
      }
      const value = {
        provider: outcome.provider,
        results: filtered,
        skipped: outcome.skipped,
        cached: false,
        tookMs: Date.now() - t0,
      }
      cache.set(cacheKey, { ...value, cached: false })
      return value
    },
  }), 'web_gateway_search')

  registerSafeTool(ctx, defineTool({
    name: 'web_gateway_extract',
    description:
      'Fetch a URL and extract readable markdown through a resilient fallback chain '
      + '(default: firecrawl -> tavily -> optional crawl4ai). Returns which providers were skipped. '
      + 'Prefer this when built-in web_fetch fails or hits rate limits. '
      + 'Private/loopback targets are blocked unless allowInternalUrls is enabled.',
    parameters: {
      url: { type: 'string', required: true, description: 'The public http(s) URL to fetch and extract.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          provider: { type: 'string' },
          url: { type: 'string' },
          markdown: { type: 'string' },
          skipped: skippedSchema,
          cached: { type: 'boolean' },
          tookMs: { type: 'integer' },
        },
      },
      render(_args, value) {
        const skip = (value.skipped || []).map((s) => `${s.provider}:${s.reason}`).join(', ')
        const body = value.markdown.length > 4000
          ? `${value.markdown.slice(0, 4000)}\n…[truncated ${value.markdown.length} chars]`
          : value.markdown
        return [{
          type: 'text',
          text: `web_gateway_extract (${value.provider}${value.cached ? ', cached' : ''}, ${value.tookMs}ms)`
            + (skip ? `; skipped [${skip}]` : '')
            + `: ${value.url}\n\n${body}`,
        }]
      },
    },
    isConcurrencySafe: () => false,
    timeoutMs: (Number(getConfig().timeoutMs) || 30000) * 3 + 5000,
    async execute(args, exec) {
      const cfg = getConfig()
      const t0 = Date.now()
      let parsed
      try {
        parsed = await prepareExtractUrl(String(args.url ?? ''), cfg, { signal: exec.signal })
      } catch (err) {
        if (err instanceof UrlPolicyError) throw new Error(`web_gateway_extract: ${err.message}`)
        throw err
      }
      const url = parsed.href

      const order = parseProviderOrder(cfg.extractProviderOrder, EXTRACT_PROVIDER_IDS)
      const cacheKey = `gextract:${url}:${order.join('>')}`
      const cached = cache.get(cacheKey)
      if (cached) return { ...cached, cached: true, tookMs: Date.now() - t0 }

      const attempts = order.map((id) => ({
        name: id,
        run: extractRunners[id](cfg, url, exec.signal),
      }))

      const outcome = await runProviderChain(attempts)
      if (!outcome.ok) {
        const detail = outcome.skipped.map((s) => `${s.provider}: ${s.reason}`).join('; ')
        throw new Error(`web_gateway_extract: all providers failed (${detail})`)
      }
      const value = {
        provider: outcome.provider,
        url,
        markdown: outcome.payload.markdown,
        skipped: outcome.skipped,
        cached: false,
        tookMs: Date.now() - t0,
      }
      cache.set(cacheKey, { ...value, cached: false })
      return value
    },

  }), 'web_gateway_extract')

  registerSafeTool(ctx, defineTool({
    name: 'web_gateway_research',
    description:
      'Research a topic: run web_gateway_search, extract the top N public pages, and return a compact '
      + 'multi-source brief. Hard-capped for safety. Prefer this for "summarize the web on X" tasks.',
    parameters: {
      query: { type: 'string', required: true, description: 'Research question or topic.' },
      limit: { type: 'integer', description: 'Number of sources to extract (bounded by settings).' },
      include_domains: { type: 'string', description: 'Optional domain allowlist.' },
      exclude_domains: { type: 'string', description: 'Optional domain denylist.' },
      freshness: { type: 'string', enum: ['any', 'day', 'week', 'month'], description: 'Optional freshness filter.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string' },
          searchProvider: { type: 'string' },
          sources: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string' },
                url: { type: 'string' },
                extractProvider: { type: 'string' },
                skipped: skippedSchema,
              },
            },
          },
          brief: { type: 'string' },
          skippedSearch: skippedSchema,
          tookMs: { type: 'integer' },
        },
      },
      render(_args, value) {
        const lines = [
          `web_gateway_research (${value.tookMs}ms) via search=${value.searchProvider}; sources=${value.sources.length}`,
          '',
          value.brief,
          '',
          'Sources:',
        ]
        for (const s of value.sources) {
          lines.push(`- ${s.title} (${s.extractProvider})\n  ${s.url}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    isConcurrencySafe: () => false,
    timeoutMs: (Number(getConfig().timeoutMs) || 30000) * 6 + 10000,
    async execute(args, exec) {
      const cfg = getConfig()
      const t0 = Date.now()
      const query = String(args.query || '').trim()
      if (!query) throw new Error('web_gateway_research: query is required')
      const defaultLimit = Number(cfg.researchDefaultLimit) || 3
      const maxLimit = Number(cfg.researchMaxLimit) || 5
      const limit = Math.min(Math.max(1, args.limit ?? defaultLimit), maxLimit)
      const maxChars = Number(cfg.researchMaxChars) || 12000
      const filters = {
        includeDomains: args.include_domains != null && String(args.include_domains).trim() !== ''
          ? args.include_domains
          : (cfg.includeDomains || ''),
        excludeDomains: args.exclude_domains != null && String(args.exclude_domains).trim() !== ''
          ? args.exclude_domains
          : (cfg.excludeDomains || ''),
        freshness: normalizeFreshness(
          args.freshness != null && String(args.freshness).trim() !== ''
            ? args.freshness
            : (cfg.freshness || 'any'),
        ),
      }

      const searchOutcome = await runSearch(query, limit, 'basic', filters, cfg, exec.signal)
      if (!searchOutcome.ok) {
        const detail = searchOutcome.skipped.map((s) => `${s.provider}: ${s.reason}`).join('; ')
        throw new Error(`web_gateway_research: search failed (${detail})`)
      }
      let results = filterSearchResults(
        searchOutcome.payload.results,
        filters.includeDomains,
        filters.excludeDomains,
      ).slice(0, limit)
      if (!results.length) throw new Error('web_gateway_research: no search results after filters')

      const sources = []
      const parts = []
      for (const r of results) {
        let parsed
        try {
          parsed = await prepareExtractUrl(r.url, cfg, { signal: exec.signal })
        } catch (err) {
          sources.push({
            title: r.title || '',
            url: r.url,
            extractProvider: 'blocked',
            skipped: [{ provider: 'policy', reason: err?.message || String(err) }],
          })
          continue
        }
        const href = parsed.href
        const extractOutcome = await runExtract(href, cfg, exec.signal)
        if (!extractOutcome.ok) {
          sources.push({
            title: r.title || '',
            url: href,
            extractProvider: 'none',
            skipped: extractOutcome.skipped,
          })
          continue
        }
        const md = String(extractOutcome.payload.markdown || '')
        sources.push({
          title: r.title || '',
          url: href,
          extractProvider: extractOutcome.provider,
          skipped: extractOutcome.skipped,
        })
        parts.push(`## ${r.title || href}\nSource: ${href}\n\n${md}`)
      }

      let brief = parts.join('\n\n---\n\n')
      if (!brief.trim()) throw new Error('web_gateway_research: no pages could be extracted')
      if (brief.length > maxChars) brief = `${brief.slice(0, maxChars)}\n\n…[truncated ${brief.length} chars]`

      return {
        query,
        searchProvider: searchOutcome.provider,
        sources,
        brief,
        skippedSearch: searchOutcome.skipped,
        tookMs: Date.now() - t0,
      }
    },
  }), 'web_gateway_research')
}


export { normalizeError }
