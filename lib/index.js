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
  normalizeError,
  prepareExtractUrl,
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
  cacheTtlMs: z.number().default(600000).description('In-memory result cache TTL in ms (0 disables).'),
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
  let cache = makeCache(Number(live?.cacheTtlMs) || 0)

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
            cache = makeCache(Number(live.cacheTtlMs) || 0)
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
            cache = makeCache(Number(live.cacheTtlMs) || 0)
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
            const snap = await buildHealthSnapshot(wctx, getConfig(), globalThis.fetch)
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

  const searchRunners = {
    tavily: (cfg, query, limit, depth, signal) => () => tavilySearch(ctx, cfg, query, limit, depth, signal, fetchImpl),
    firecrawl: (cfg, query, limit, _depth, signal) => () => firecrawlSearch(ctx, cfg, query, limit, signal, fetchImpl),
    exa: (cfg, query, limit, _depth, signal) => () => exaSearch(ctx, cfg, query, limit, signal, fetchImpl),
    searxng: (cfg, query, limit, _depth, signal) => () => searxngSearch(ctx, cfg, query, limit, signal, fetchImpl),
  }

  const extractRunners = {
    firecrawl: (cfg, url, signal) => () => firecrawlExtract(ctx, cfg, url, signal, fetchImpl),
    tavily: (cfg, url, signal) => () => tavilyExtract(ctx, cfg, url, signal, fetchImpl),
    crawl4ai: (cfg, url, signal) => () => crawl4aiExtract(ctx, cfg, url, signal, fetchImpl),
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

      const order = parseProviderOrder(cfg.searchProviderOrder, SEARCH_PROVIDER_IDS)
      const cacheKey = `gsearch:${query}:${limit}:${depth}:${order.join('>')}`
      const cached = cache.get(cacheKey)
      if (cached) return { ...cached, cached: true, tookMs: Date.now() - t0 }

      const attempts = order.map((id) => ({
        name: id,
        run: searchRunners[id](cfg, query, limit, depth, exec.signal),
      }))

      const outcome = await runProviderChain(attempts)
      if (!outcome.ok) {
        const detail = outcome.skipped.map((s) => `${s.provider}: ${s.reason}`).join('; ')
        throw new Error(`web_gateway_search: all providers failed (${detail})`)
      }
      const value = {
        provider: outcome.provider,
        results: outcome.payload.results,
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
}

export { normalizeError }
