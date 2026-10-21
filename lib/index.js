// dsh-web-gateway: resilient web search & extract tools for DeepSeek Harness.
//
//   web_gateway_search(query, limit?, strategy?) -> results [{ title, url, snippet }]
//     chain: configurable (default tavily -> brave -> firecrawl -> exa -> searxng -> duckduckgo)
//     strategies: fallback | race | aggregate
//
//   web_gateway_extract(url, compact?, take_screenshot?) -> { url, provider, markdown, screenshot? }
//     chain: configurable (default firecrawl -> tavily -> crawl4ai -> jina -> readability)
//
// Tool names differ from built-in web_search / web_fetch to avoid collisions.

import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { makeCache } from './cache.js'
import { expandAttempts } from './attempts.js'
import { makeGuards } from './guards.js'
import { makeDiskCache, makeLayeredCache } from './disk-cache.js'
import { capsFromConfig, makeDailyCaps } from './caps.js'
import { makeCircuitBreaker } from './circuit-breaker.js'
import { makeTelemetry } from './telemetry.js'
import { pruneMarkdown } from './pruning.js'
import { filterSearchResults, normalizeFreshness, normalizeSearchQuery } from './filters.js'
import {
  DEFAULT_EXTRACT_ORDER,
  DEFAULT_SEARCH_ORDER,
  EXTRACT_PROVIDER_IDS,
  SEARCH_PROVIDER_IDS,
  normalizeStrategy,
  parseProviderOrder,
  runProviderAggregate,
  runProviderChain,
  runProviderRace,
} from './chain.js'
import { buildHealthSnapshot } from './health.js'
import {
  braveSearch,
  crawl4aiExtract,
  duckduckgoSearch,
  exaSearch,
  firecrawlExtract,
  firecrawlSearch,
  jinaExtract,
  keenableSearch,
  normalizeError,
  readabilityExtract,
  resolveApiKeys,
  searxngSearch,
  tavilyExtract,
  tavilySearch,
  UrlPolicyError,
} from './providers.js'
import { inspectExtractUrl } from './url-policy.js'
import { registerPluginUpdater } from './updater.js'

function isLoopback(value) {
  const address = String(value || '').toLowerCase().replace(/^\[|\]$/g, '')
  return address === 'localhost' || address === 'localhost.' || address === '::1'
    || address.startsWith('127.')
    || address.startsWith('::ffff:127.')
}

export const name = '@goodandready/dsh-web-gateway'
export const NS = 'dsh-web-gateway'
export const inject = ['tools', 'credentials']

export const Config = z.object({
  defaultLimit: z.number().default(5).volatile().description('Default max results for web_gateway_search.'),
  maxLimit: z.number().default(20).volatile().description('Hard cap on web_gateway_search limit.'),
  timeoutMs: z.number().default(30000).volatile().description('Per-provider request timeout in ms.'),
  cacheTtlMs: z.number().default(600000).volatile().description('Result cache TTL in ms (0 disables). Applies to memory and disk layers.'),
  diskCacheEnabled: z.boolean().default(true).volatile().description('Persist search/extract cache on disk under the DSH profile.'),
  diskCacheMaxEntries: z.number().default(500).volatile().description('Soft max disk cache entries.'),
  includeDomains: z.string().default('').volatile().description('Comma-separated allowlist of search result domains (empty = all).'),
  excludeDomains: z.string().default('').volatile().description('Comma-separated denylist of search result domains.'),
  freshness: z.string().default('any').volatile().description('Search freshness: any | day | week | month.'),
  dailyCapTavily: z.number().default(0).volatile().description('Daily call cap for tavily (0 = unlimited, UTC day).'),
  dailyCapBrave: z.number().default(0).volatile().description('Daily call cap for brave (0 = unlimited, UTC day).'),
  dailyCapFirecrawl: z.number().default(0).volatile().description('Daily call cap for firecrawl (0 = unlimited, UTC day).'),
  dailyCapExa: z.number().default(0).volatile().description('Daily call cap for exa (0 = unlimited, UTC day).'),
  dailyCapSearxng: z.number().default(0).volatile().description('Daily call cap for searxng (0 = unlimited, UTC day).'),
  dailyCapDuckduckgo: z.number().default(0).volatile().description('Daily call cap for duckduckgo (0 = unlimited, UTC day).'),
  dailyCapCrawl4ai: z.number().default(0).volatile().description('Daily call cap for crawl4ai (0 = unlimited, UTC day).'),
  dailyCapFirecrawlFree: z.number().default(0).volatile().description('Daily call cap for keyless Firecrawl (0 = unlimited, UTC day).'),
  dailyCapKeenableFree: z.number().default(0).volatile().description('Daily call cap for keyless Keenable (0 = unlimited, UTC day).'),
  dailyCapKeenable: z.number().default(0).volatile().description('Daily call cap for keyed Keenable (0 = unlimited, UTC day).'),
  dailyCapJina: z.number().default(0).description('Daily call cap for jina (0 = unlimited, UTC day).'),
  dailyCapReadability: z.number().default(0).description('Daily call cap for readability (0 = unlimited, UTC day).'),
  circuitBreakerThreshold: z.number().default(3).volatile().description('Consecutive failures before entering cooldown (0 disables).'),
  circuitBreakerCooldownMs: z.number().default(300000).description('Circuit breaker cooldown duration in ms.'),
  compactExtract: z.boolean().default(true).volatile().description('Prune noise and boilerplate from extracted markdown.'),
  jinaEnabled: z.boolean().default(true).volatile().description('Enable keyless Jina Reader extract fallback (https://r.jina.ai).'),
  readabilityEnabled: z.boolean().default(true).volatile().description('Enable keyless HTML-strip extract fallback.'),
  duckduckgoEnabled: z.boolean().default(true).description('Enable keyless DuckDuckGo search fallback.'),
  freeTierFirst: z.boolean().default(true).volatile().description('Run every keyless free attempt before any keyed attempt.'),
  firecrawlKeylessSearch: z.boolean().default(true).volatile().description('Allow Firecrawl search without an API key.'),
  firecrawlKeylessFetch: z.boolean().default(true).volatile().description('Allow Firecrawl extract without a key; sends public URLs to Firecrawl cloud.'),
  keenableEnabled: z.boolean().default(true).volatile().description('Enable Keenable search (keyless, plus keyed when a key exists).'),
  keenableApiKeyEnv: z.string().default('KEENABLE_API_KEY').volatile(),
  searchDeadlineMs: z.number().default(60000).volatile().description('Wall-clock budget for one search chain.'),
  extractDeadlineMs: z.number().default(60000).volatile().description('Wall-clock budget for one extract chain.'),
  researchDefaultLimit: z.number().default(3).volatile().description('Default number of sources for web_gateway_research.'),
  researchMaxLimit: z.number().default(5).volatile().description('Hard cap on web_gateway_research sources.'),
  researchMaxChars: z.number().default(12000).volatile().description('Max combined markdown chars returned by web_gateway_research.'),
  searchStrategy: z.string().default('fallback').volatile().description(
    'Default search execution strategy: fallback | race | aggregate.',
  ),
  parallelMaxConcurrency: z.number().default(2).volatile().description(
    'Max parallel providers queried simultaneously in race or aggregate strategies.',
  ),
  searchProviderOrder: z.string().default(DEFAULT_SEARCH_ORDER).volatile().description(
    'Comma-separated search provider order. Allowed: firecrawl, keenable, searxng, duckduckgo, tavily, brave, exa.',
  ),
  extractProviderOrder: z.string().default(DEFAULT_EXTRACT_ORDER).volatile().description(
    'Comma-separated extract provider order. Allowed: firecrawl, tavily, crawl4ai, jina, readability.',
  ),
  tavilyApiKeyEnv: z.string().default('TAVILY_API_KEY').volatile(),
  braveApiKeyEnv: z.string().default('BRAVE_API_KEY').volatile(),
  firecrawlApiKeyEnv: z.string().default('FIRECRAWL_API_KEY').volatile(),
  exaApiKeyEnv: z.string().default('EXA_API_KEY').volatile(),
  searxngUrl: z.string().default('').volatile().description('Optional local SearXNG base URL. Empty disables the SearXNG fallback.'),
  crawl4aiUrl: z.string().default('').volatile().description('Optional crawl4ai base URL. Empty disables the crawl4ai extract fallback.'),
  crawl4aiTokenEnv: z.string().default('CRAWL4AI_TOKEN').volatile(),
  egressProxyUrl: z.string().default('').volatile().description('Optional HTTP/HTTPS/SOCKS5 outbound egress proxy URL for local/direct fallbacks (SearXNG, Crawl4AI, Readability).'),
  allowInternalUrls: z.boolean().default(false).volatile().description(
    'Allow extract targets that resolve to loopback/private/link-local addresses. Off by default (SSRF protection).',
  ),
})

// DSH serves a namespace's settings form from the volatile fields of its profile
// entry schema (volatileForm() drops every other field, and a schema with no
// volatile field yields no form at all). A volatile field holds a Volatile box,
// so unwrap once here and keep the rest of the plugin reading plain values.
function plainVolatile(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(plainVolatile)
  if (typeof value.get === 'function') return plainVolatile(value.get())
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plainVolatile(child)]))
}

export function readConfig(raw) {
  try {
    return plainVolatile(Config(structuredClone(plainVolatile(raw ?? {}))))
  } catch (_err) {
    return plainVolatile(Config({}))
  }
}

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
  let live = readConfig(config)

  const getConfig = () => live || {}
  const dailyCaps = makeDailyCaps()
  const telemetry = makeTelemetry()
  let circuitBreaker = makeCircuitBreaker({
    threshold: Number(live?.circuitBreakerThreshold) || 3,
    cooldownMs: Number(live?.circuitBreakerCooldownMs) || 300000,
  })

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
  let guards = makeGuards({ dailyCaps, circuitBreaker, telemetry, capsFromConfig })

  function refreshFromConfig() {
    const fresh = readConfig(config)
    if (!fresh || typeof fresh !== 'object') return
    live = fresh
    cache = rebuildCache(live)
    circuitBreaker = makeCircuitBreaker({
      threshold: Number(live?.circuitBreakerThreshold) || 3,
      cooldownMs: Number(live?.circuitBreakerCooldownMs) || 300000,
    })
    guards = makeGuards({ dailyCaps, circuitBreaker, telemetry, capsFromConfig })
  }

  // DSH 0.1.7-rc.2 and 0.2.0 share one contract: the Loader re-merges volatile
  // profile entries in place and announces it with loader/volatile-update.
  // settings.register exists in neither release, so it is not a fallback path.
  if (typeof ctx.on === 'function') {
    try {
      ctx.on('loader/volatile-update', () => {
        try {
          refreshFromConfig()
        } catch (err) {
          const msg = `[dsh-web-gateway] settings refresh failed: ${err?.message || err}`
          if (typeof ctx.logger?.warn === 'function') ctx.logger.warn(msg)
        }
      })
    } catch (err) {
      const msg = `[dsh-web-gateway] volatile-update subscription failed: ${err?.message || err}`
      if (typeof ctx.logger?.warn === 'function') ctx.logger.warn(msg)
    }
  }

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
            if (!isLoopback(request.socket?.remoteAddress)) {
              response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
              response.end(JSON.stringify({ error: 'health check is only accessible from loopback' }))
              return
            }
            if (request.method === 'POST') {
              telemetry.reset()
              const cfg = getConfig()
              const snap = await buildHealthSnapshot(wctx, cfg, globalThis.fetch)
              const capsSnap = dailyCaps.snapshot(capsFromConfig(cfg))
              snap.dailyCaps = capsSnap
              snap.circuitBreaker = circuitBreaker.snapshot()
              snap.telemetry = telemetry.snapshot(capsSnap)
              response.writeHead(200, {
                'content-type': 'application/json; charset=utf-8',
                'cache-control': 'no-store',
              })
              response.end(JSON.stringify(snap))
              return
            }
            if (request.method !== 'GET' && request.method !== 'HEAD') {
              response.writeHead(405, { allow: 'GET, HEAD, POST' })
              response.end()
              return
            }
            const cfg = getConfig()
            const snap = await buildHealthSnapshot(wctx, cfg, globalThis.fetch)
            const capsSnap = dailyCaps.snapshot(capsFromConfig(cfg))
            snap.dailyCaps = capsSnap
            snap.circuitBreaker = circuitBreaker.snapshot()
            snap.telemetry = telemetry.snapshot(capsSnap)
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
    tavily: (cfg, query, limit, depth, signal, filters, attempt) => guards.withGuards(attempt, cfg, (sig) => tavilySearch(ctx, cfg, query, limit, depth, sig || signal, fetchImpl, filters, attempt)),
    brave: (cfg, query, limit, _depth, signal, filters, attempt) => guards.withGuards(attempt, cfg, (sig) => braveSearch(ctx, cfg, query, limit, sig || signal, fetchImpl, filters, attempt)),
    firecrawl: (cfg, query, limit, _depth, signal, filters, attempt) => guards.withGuards(attempt, cfg, (sig) => firecrawlSearch(ctx, cfg, query, limit, sig || signal, fetchImpl, filters, attempt)),
    keenable: (cfg, query, limit, _depth, signal, filters, attempt) => guards.withGuards(attempt, cfg, (sig) => keenableSearch(ctx, cfg, query, limit, sig || signal, fetchImpl, filters, attempt)),
    exa: (cfg, query, limit, _depth, signal, filters, attempt) => guards.withGuards(attempt, cfg, (sig) => exaSearch(ctx, cfg, query, limit, sig || signal, fetchImpl, filters, attempt)),
    searxng: (cfg, query, limit, _depth, signal, filters, attempt) => guards.withGuards(attempt, cfg, (sig) => searxngSearch(ctx, cfg, query, limit, sig || signal, fetchImpl, filters)),
    duckduckgo: (cfg, query, limit, _depth, signal, filters, attempt) => guards.withGuards(attempt, cfg, (sig) => duckduckgoSearch(ctx, cfg, query, limit, sig || signal, fetchImpl, filters)),
  }

  const extractRunners = {
    firecrawl: (cfg, url, signal, opts = {}, attempt) => guards.withGuards(attempt, cfg, (sig) => firecrawlExtract(ctx, cfg, url, sig || signal, fetchImpl, { ...opts, mode: attempt.mode, apiKey: attempt.apiKey })),
    tavily: (cfg, url, signal, opts = {}, attempt) => guards.withGuards(attempt, cfg, (sig) => tavilyExtract(ctx, cfg, url, sig || signal, fetchImpl, { ...opts, apiKey: attempt.apiKey })),
    crawl4ai: (cfg, url, signal, opts = {}, attempt) => guards.withGuards(attempt, cfg, (sig) => crawl4aiExtract(ctx, cfg, url, sig || signal, fetchImpl, { ...opts, apiKey: attempt.apiKey })),
    jina: (cfg, url, signal, opts = {}, attempt) => guards.withGuards(attempt, cfg, (sig) => jinaExtract(ctx, cfg, url, sig || signal, fetchImpl, opts)),
    readability: (cfg, url, signal, opts = {}, attempt) => guards.withGuards(attempt, cfg, (sig) => readabilityExtract(ctx, cfg, url, sig || signal, fetchImpl, opts)),
  }

  async function resolveSearchKeys(cfg) {
    return {
      firecrawl: await resolveApiKeys(ctx, cfg.firecrawlApiKeyEnv),
      keenable: await resolveApiKeys(ctx, cfg.keenableApiKeyEnv || 'KEENABLE_API_KEY'),
      tavily: await resolveApiKeys(ctx, cfg.tavilyApiKeyEnv),
      brave: await resolveApiKeys(ctx, cfg.braveApiKeyEnv),
      exa: await resolveApiKeys(ctx, cfg.exaApiKeyEnv),
    }
  }

  async function buildSearchAttempts(cfg, query, limit, depth, filters, signal) {
    const order = parseProviderOrder(cfg.searchProviderOrder, SEARCH_PROVIDER_IDS)
    const keys = await resolveSearchKeys(cfg)
    const expanded = expandAttempts({ kind: 'search', order, cfg, keys, request: filters })
    return {
      labels: expanded.map((attempt) => attempt.label),
      attempts: expanded.map((attempt) => ({
        name: attempt.label,
        provider: attempt.provider,
        mode: attempt.mode,
        run: searchRunners[attempt.provider](cfg, query, limit, depth, signal, filters, attempt),
      })),
    }
  }

  async function buildExtractAttempts(cfg, url, signal, opts = {}) {
    const order = parseProviderOrder(cfg.extractProviderOrder, EXTRACT_PROVIDER_IDS)
    const keys = {
      firecrawl: await resolveApiKeys(ctx, cfg.firecrawlApiKeyEnv),
      tavily: await resolveApiKeys(ctx, cfg.tavilyApiKeyEnv),
      crawl4ai: await resolveApiKeys(ctx, cfg.crawl4aiTokenEnv),
    }
    const expanded = expandAttempts({
      kind: 'extract',
      order,
      cfg,
      keys,
      request: {
        takeScreenshot: !!opts.takeScreenshot,
        publicTarget: opts.publicTarget !== false,
      },
    })
    return {
      labels: expanded.map((attempt) => attempt.label),
      attempts: expanded.map((attempt) => ({
        name: attempt.label,
        provider: attempt.provider,
        mode: attempt.mode,
        run: extractRunners[attempt.provider](cfg, url, signal, opts, attempt),
      })),
    }
  }

  async function runExtract(url, cfg, signal, opts = {}, attemptsOverride) {
    const attempts = attemptsOverride
      || (await buildExtractAttempts(cfg, url, signal, opts)).attempts
    const deadlineAt = Number.isFinite(opts.deadlineAt)
      ? opts.deadlineAt
      : Date.now() + (Number(cfg.extractDeadlineMs) || 60000)
    return runProviderChain(attempts, {
      deadlineAt,
      timeoutMs: Number(cfg.timeoutMs) || 30000,
    })
  }

  async function runSearch(query, limit, depth, filters, cfg, signal, strategyOverride, attemptsOverride) {
    const strategy = normalizeStrategy(strategyOverride || cfg.searchStrategy)
    const concurrency = Math.max(1, Number(cfg.parallelMaxConcurrency) || 2)
    const timeoutMs = Number(cfg.timeoutMs) || 30000
    const deadlineAt = Date.now() + (Number(cfg.searchDeadlineMs) || 60000)
    const attempts = attemptsOverride
      || (await buildSearchAttempts(cfg, query, limit, depth, filters, signal)).attempts

    if (strategy === 'race' || strategy === 'aggregate') {
      const runTier = (tier) => strategy === 'race'
        ? runProviderRace(tier, { concurrency, signal, deadlineAt, timeoutMs })
        : runProviderAggregate(tier, { concurrency, limit, signal, deadlineAt, timeoutMs })
      if (cfg.freeTierFirst !== false) {
        const free = attempts.filter((attempt) => attempt.mode === 'free')
        const keyed = attempts.filter((attempt) => attempt.mode === 'key')
        const first = await runTier(free)
        if (first.ok) return first
        const second = await runTier(keyed)
        if (second.ok) return { ...second, skipped: [...first.skipped, ...second.skipped] }
        return { ok: false, skipped: [...first.skipped, ...second.skipped] }
      }
      return runTier(attempts)
    }

    return runProviderChain(attempts, { deadlineAt, timeoutMs })
  }

  registerSafeTool(ctx, defineTool({
    name: 'web_gateway_search',
    description:
      'Search the web through a resilient fallback chain (default: tavily -> brave -> firecrawl -> exa -> searxng -> duckduckgo) '
      + 'or parallel strategies (race / aggregate) and return results (title, url, snippet) plus which providers were skipped. '
      + 'Prefer this over built-in web_search when the built-in hits rate limits, captchas, or empty results.',
    parameters: {
      query: { type: 'string', required: true, description: 'The search query.' },
      limit: { type: 'integer', description: 'Max results (bounded by plugin settings).' },
      strategy: {
        type: 'string',
        enum: ['fallback', 'race', 'aggregate'],
        description: 'Execution strategy: fallback (sequential), race (fastest wins), or aggregate (merge & dedupe).',
      },
      search_depth: {
        type: 'string',
        enum: ['basic', 'advanced'],
        description: 'Search depth (only used by the tavily provider). Default basic.',
      },
      category: {
        type: 'string',
        enum: ['general', 'news', 'code', 'academic'],
        description: 'Topic/category filter: general | news | code | academic. Default general.',
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
          query: { type: 'string' },
          strategy: { type: 'string' },
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
    get timeoutMs() { return (Number(getConfig().searchDeadlineMs) || 60000) + 5000 },
    async execute(args, exec) {
      const cfg = getConfig()
      const t0 = Date.now()
      const query = String(args.query).trim()
      if (!query) throw new Error('web_gateway_search: query is required')
      const defaultLimit = Number(cfg.defaultLimit) || 5
      const maxLimit = Number(cfg.maxLimit) || 20
      const limit = Math.min(Math.max(1, args.limit ?? defaultLimit), maxLimit)
      const strategy = normalizeStrategy(args.strategy || cfg.searchStrategy)
      const depth = args.search_depth === 'advanced' ? 'advanced' : 'basic'
      const category = args.category && ['general', 'news', 'code', 'academic'].includes(args.category)
        ? args.category
        : 'general'
      const filters = {
        category,
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

      const built = await buildSearchAttempts(cfg, query, limit, depth, filters, exec.signal)
      const normKey = normalizeSearchQuery(query)
      const cacheKey = `gsearch:${normKey}:${limit}:${strategy}:${depth}:${category}:${built.labels.join('>')}:${filters.includeDomains}|${filters.excludeDomains}|${filters.freshness}`
      const cached = cache.get(cacheKey)
      if (cached) return { ...cached, query, cached: true, tookMs: Date.now() - t0 }

      const outcome = await runSearch(query, limit, depth, filters, cfg, exec.signal, strategy, built.attempts)
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
        query,
        strategy,
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
      'Fetch a URL and extract readable markdown (and optional page screenshot) through a resilient fallback chain '
      + '(default: firecrawl -> tavily -> crawl4ai -> jina -> readability). Returns which providers were skipped. '
      + 'Prefer this when built-in web_fetch fails or hits rate limits. '
      + 'Private/loopback targets are blocked unless allowInternalUrls is enabled.',
    parameters: {
      url: { type: 'string', required: true, description: 'The public http(s) URL to fetch and extract.' },
      compact: { type: 'boolean', description: 'Strip boilerplate notices and prune tokens (default: true).' },
      take_screenshot: { type: 'boolean', description: 'Capture a visual page snapshot via Firecrawl or Crawl4AI for multimodal vision analysis (default: false).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          provider: { type: 'string' },
          url: { type: 'string' },
          markdown: { type: 'string' },
          screenshot: {
            type: 'object',
            additionalProperties: false,
            properties: {
              screenshotPath: { type: 'string' },
              screenshotUrl: { type: 'string' },
              dataUri: { type: 'string' },
            },
          },
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
        const shotInfo = value.screenshot
          ? `\nScreenshot: ${value.screenshot.screenshotPath || value.screenshot.screenshotUrl || 'captured (dataUri)'}`
          : ''
        return [{
          type: 'text',
          text: `web_gateway_extract (${value.provider}${value.cached ? ', cached' : ''}, ${value.tookMs}ms)`
            + (skip ? `; skipped [${skip}]` : '')
            + `: ${value.url}${shotInfo}\n\n${body}`,
        }]
      },
    },
    isConcurrencySafe: () => false,
    get timeoutMs() { return (Number(getConfig().extractDeadlineMs) || 60000) + 5000 },
    async execute(args, exec) {
      const cfg = getConfig()
      const t0 = Date.now()
      let inspected
      try {
        inspected = await inspectExtractUrl(String(args.url ?? ''), {
          allowInternal: !!cfg.allowInternalUrls,
          signal: exec.signal,
        })
      } catch (err) {
        if (err instanceof UrlPolicyError) throw new Error(`web_gateway_extract: ${err.message}`)
        throw err
      }
      const url = inspected.url.href
      const publicTarget = inspected.publicTarget
      const isCompact = args.compact ?? cfg.compactExtract ?? true
      const takeScreenshot = !!args.take_screenshot

      const built = await buildExtractAttempts(cfg, url, exec.signal, { takeScreenshot, publicTarget })
      const cacheKey = `gextract:${url}:${built.labels.join('>')}:${isCompact ? 'compact' : 'full'}:${takeScreenshot ? 'shot' : 'noshot'}`
      const cached = cache.get(cacheKey)
      if (cached) return { ...cached, cached: true, tookMs: Date.now() - t0 }

      const outcome = await runExtract(url, cfg, exec.signal, { takeScreenshot, publicTarget }, built.attempts)
      if (!outcome.ok) {
        const detail = outcome.skipped.map((s) => `${s.provider}: ${s.reason}`).join('; ')
        throw new Error(`web_gateway_extract: all providers failed (${detail})`)
      }

      const rawMarkdown = outcome.payload.markdown || ''
      const cleanMarkdown = isCompact ? pruneMarkdown(rawMarkdown, { compact: true }) : rawMarkdown

      const value = {
        provider: outcome.provider,
        url,
        markdown: cleanMarkdown,
        ...(outcome.payload.screenshot ? { screenshot: outcome.payload.screenshot } : {}),
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
      category: {
        type: 'string',
        enum: ['general', 'news', 'code', 'academic'],
        description: 'Topic/category filter: general | news | code | academic. Default general.',
      },
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
    get timeoutMs() {
      return (Number(getConfig().searchDeadlineMs) || 60000)
        + (Number(getConfig().extractDeadlineMs) || 60000)
        + 10000
    },
    async execute(args, exec) {
      const cfg = getConfig()
      const t0 = Date.now()
      const query = String(args.query || '').trim()
      if (!query) throw new Error('web_gateway_research: query is required')
      const defaultLimit = Number(cfg.researchDefaultLimit) || 3
      const maxLimit = Number(cfg.researchMaxLimit) || 5
      const limit = Math.min(Math.max(1, args.limit ?? defaultLimit), maxLimit)
      const maxChars = Number(cfg.researchMaxChars) || 12000
      const researchDeadlineAt = Date.now()
        + (Number(cfg.searchDeadlineMs) || 60000)
        + (Number(cfg.extractDeadlineMs) || 60000)
      const category = args.category && ['general', 'news', 'code', 'academic'].includes(args.category)
        ? args.category
        : 'general'
      const filters = {
        category,
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
        let inspected
        try {
          inspected = await inspectExtractUrl(r.url, {
            allowInternal: !!cfg.allowInternalUrls,
            signal: exec.signal,
          })
        } catch (err) {
          sources.push({
            title: r.title || '',
            url: r.url,
            extractProvider: 'blocked',
            skipped: [{ provider: 'policy', reason: err?.message || String(err) }],
          })
          continue
        }
        const href = inspected.url.href
        const extractOutcome = await runExtract(href, cfg, exec.signal, {
          publicTarget: inspected.publicTarget,
          deadlineAt: researchDeadlineAt,
        })
        if (!extractOutcome.ok) {
          sources.push({
            title: r.title || '',
            url: href,
            extractProvider: 'none',
            skipped: extractOutcome.skipped,
          })
          continue
        }
        const md = pruneMarkdown(String(extractOutcome.payload.markdown || ''), { compact: true })
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
