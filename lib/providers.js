// Search and extract providers for dsh-web-gateway.

const MAX_BODY_BYTES = 2 * 1024 * 1024 // 2 MB response limit

async function readBoundedText(res, maxBytes = MAX_BODY_BYTES) {
  if (!res) return ''
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let result = ''
    let totalBytes = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        totalBytes += value.byteLength
        if (totalBytes > maxBytes) {
          const allowed = value.subarray(0, value.byteLength - (totalBytes - maxBytes))
          result += decoder.decode(allowed, { stream: false })
          try { await reader.cancel() } catch (_err) { /* ignore */ }
          break
        }
        result += decoder.decode(value, { stream: true })
      }
    }
    return result
  }
  if (typeof res.text === 'function') {
    const text = String((await res.text()) || '')
    return text.length > maxBytes ? text.slice(0, maxBytes) : text
  }
  return ''
}

import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

import {
  assertExtractUrlAllowed,
  assertSameOriginRedirect,
  getSafeDispatcher,
  MAX_REDIRECTS,
  UrlPolicyError,
} from './url-policy.js'
import {
  freshnessToExaStart,
  freshnessToSearxngRange,
  freshnessToTavilyDays,
  parseDomainList,
} from './filters.js'
import {
  formatDocumentMarkdown,
  getDocumentType,
} from './document.js'

function defaultScreenshotsDir() {
  const profileDir = process.env.DSH_PROFILE_DIR || resolve(homedir(), '.dsh', 'profiles', 'web')
  return resolve(profileDir, 'data', 'dsh-web-gateway', 'screenshots')
}

/**
 * Persist a screenshot (base64, data URI, or URL) under the DSH profile cache directory
 * with soft entry cap and return { screenshotUrl?, screenshotPath?, dataUri? }.
 */
export function persistScreenshot(rawScreenshot, targetUrl, opts = {}) {
  if (!rawScreenshot || typeof rawScreenshot !== 'string') return null
  const val = rawScreenshot.trim()
  if (!val) return null

  // If the provider returned a remote HTTP(S) screenshot URL, return it directly
  if (/^https?:\/\//i.test(val)) {
    return { screenshotUrl: val }
  }

  let base64Data = val
  let mime = 'image/png'
  let ext = 'png'

  const dataMatch = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(val)
  if (dataMatch) {
    mime = dataMatch[1].toLowerCase()
    base64Data = dataMatch[2].trim()
    if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg'
    else if (mime.includes('webp')) ext = 'webp'
  }

  const dir = opts.dir || defaultScreenshotsDir()
  try {
    mkdirSync(dir, { recursive: true })
    const hash = createHash('sha256').update(`${targetUrl}:${Date.now()}`).digest('hex').slice(0, 16)
    const filePath = resolve(dir, `snap-${hash}.${ext}`)
    const buf = Buffer.from(base64Data, 'base64')
    // Cap screenshot file size at 5MB
    if (buf.byteLength > 5 * 1024 * 1024) return null
    writeFileSync(filePath, buf)

    // Prune older screenshots if directory exceeds 50 files
    try {
      const files = readdirSync(dir)
        .filter((f) => f.startsWith('snap-'))
        .map((f) => {
          const p = resolve(dir, f)
          return { p, mtime: statSync(p).mtimeMs }
        })
        .sort((a, b) => b.mtime - a.mtime)
      for (const old of files.slice(50)) {
        try { unlinkSync(old.p) } catch (_e) { /* ignore */ }
      }
    } catch (_e) { /* ignore cleanup errors */ }

    return {
      screenshotPath: filePath,
      dataUri: `data:${mime};base64,${base64Data}`,
    }
  } catch (_err) {
    return {
      dataUri: `data:${mime};base64,${base64Data}`,
    }
  }
}

export function normalizeError(err) {
  const cause = err?.cause?.message || err?.message || String(err)
  return cause.slice(0, 200)
}

async function toCredentialRef(ref) {
  try {
    const mod = await import('@deepseek-ai/dsh-credentials')
    if (typeof mod.credentialRef === 'function') return mod.credentialRef(ref)
  } catch (_err) {
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
  } catch (_err) {
    // fall through to the environment
  }
  const fromEnv = process.env[ref]
  if (fromEnv) return fromEnv
  return ''
}

export async function postJSON(url, body, headers, signal, fetchImpl = fetch, dispatcher = undefined) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
    redirect: 'manual',
    ...(dispatcher ? { dispatcher } : {}),
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
  if (filters.category === 'news') body.topic = 'news'
  else if (filters.category === 'general') body.topic = 'general'
  const data = await postJSON(
    'https://api.tavily.com/search',
    body,
    {},
    signal,
    fetchImpl,
  )
  const results = (data.results || []).slice(0, limit).map((r) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.content || r.snippet || '',
  }))
  return { ok: results.length > 0, provider: 'tavily', results, reason: results.length ? '' : 'empty' }
}

export async function braveSearch(ctx, cfg, query, limit, signal, fetchImpl = fetch, filters = {}) {
  const key = await resolveApiKey(ctx, cfg.braveApiKeyEnv || 'BRAVE_API_KEY')
  if (!key) return { ok: false, provider: 'brave', reason: 'no BRAVE_API_KEY' }
  const params = new URLSearchParams({ q: query, count: String(Math.min(limit, 20)) })
  if (filters.freshness === 'day') params.set('freshness', 'pd')
  else if (filters.freshness === 'week') params.set('freshness', 'pw')
  else if (filters.freshness === 'month') params.set('freshness', 'pm')

  const url = `https://api.search.brave.com/res/v1/web/search?${params.toString()}`
  const res = await fetchImpl(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'X-Subscription-Token': key,
    },
    signal,
    redirect: 'manual',
  })
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`)
  const data = await res.json()
  const raw = data?.web?.results || []
  const results = raw.slice(0, limit).map((r) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.description || r.snippet || '',
  }))
  return { ok: results.length > 0, provider: 'brave', results, reason: results.length ? '' : 'empty' }
}

export async function duckduckgoSearch(ctx, cfg, query, limit, signal, fetchImpl = fetch, _filters = {}) {
  if (cfg?.duckduckgoEnabled === false) return { ok: false, provider: 'duckduckgo', reason: 'duckduckgo disabled' }
  const target = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const dispatcher = getSafeDispatcher({ allowInternal: false, proxyUrl: cfg?.egressProxyUrl })
  const res = await fetchImpl(target, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    body: `q=${encodeURIComponent(query)}`,
    signal,
    redirect: 'manual',
    ...(dispatcher ? { dispatcher } : {}),
  })
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`)
  const html = await readBoundedText(res)

  const results = []
  const regex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
  let match
  while ((match = regex.exec(html)) !== null && results.length < limit) {
    let rawHref = match[1]
    if (rawHref.includes('uddg=')) {
      try {
        const u = new URL(rawHref, 'https://duckduckgo.com')
        const real = u.searchParams.get('uddg')
        if (real) rawHref = real
      } catch (_err) {
        // leave rawHref
      }
    }
    const cleanTitle = match[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").trim()
    const cleanSnippet = match[3].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").trim()
    if (rawHref && /^https?:\/\//i.test(rawHref)) {
      results.push({ title: cleanTitle, url: rawHref, snippet: cleanSnippet })
    }
  }
  return { ok: results.length > 0, provider: 'duckduckgo', results, reason: results.length ? '' : 'empty' }
}

export async function firecrawlSearch(ctx, cfg, query, limit, signal, fetchImpl = fetch, _filters = {}) {
  const key = await resolveApiKey(ctx, cfg.firecrawlApiKeyEnv)
  if (!key) return { ok: false, provider: 'firecrawl', reason: 'no FIRECRAWL_API_KEY' }
  const data = await postJSON(
    'https://api.firecrawl.dev/v1/search',
    { query, limit },
    { authorization: `Bearer ${key}` },
    signal,
    fetchImpl,
  )
  const items = Array.isArray(data.data) ? data.data : data.results || []
  const results = items.slice(0, limit).map((r) => ({
    title: r.title || r.metadata?.title || '',
    url: r.url || r.metadata?.sourceURL || '',
    snippet: r.description || r.markdown?.slice(0, 400) || '',
  }))
  return { ok: results.length > 0, provider: 'firecrawl', results, reason: results.length ? '' : 'empty' }
}

export async function exaSearch(ctx, cfg, query, limit, signal, fetchImpl = fetch, filters = {}) {
  const key = await resolveApiKey(ctx, cfg.exaApiKeyEnv)
  if (!key) return { ok: false, provider: 'exa', reason: 'no EXA_API_KEY' }
  const body = { query, numResults: limit }
  const start = freshnessToExaStart(filters.freshness)
  if (start) body.startPublishedDate = start
  const include = parseDomainList(filters.includeDomains)
  if (include.length) body.includeDomains = include
  const exclude = parseDomainList(filters.excludeDomains)
  if (exclude.length) body.excludeDomains = exclude
  if (filters.category === 'code') body.category = 'github'
  else if (filters.category === 'academic') body.category = 'research paper'
  else if (filters.category === 'news') body.category = 'news'

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
  if (filters.category === 'code') params.set('categories', 'it')
  else if (filters.category === 'academic') params.set('categories', 'science')
  else if (filters.category === 'news') params.set('categories', 'news')
  else if (filters.category === 'general') params.set('categories', 'general')

  const url = `${base.replace(/\/$/, '')}/search?${params.toString()}`
  const dispatcher = getSafeDispatcher({ allowInternal: true, proxyUrl: cfg?.egressProxyUrl })
  const res = await fetchImpl(url, {
    signal,
    redirect: 'manual',
    ...(dispatcher ? { dispatcher } : {}),
  })
  if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}`)
  const data = await res.json()
  const results = (data.results || []).slice(0, limit).map((r) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.content || '',
  }))
  return { ok: results.length > 0, provider: 'searxng', results, reason: results.length ? '' : 'empty' }
}

export async function firecrawlExtract(ctx, cfg, url, signal, fetchImpl = fetch, opts = {}) {
  const key = await resolveApiKey(ctx, cfg.firecrawlApiKeyEnv)
  if (!key) return { ok: false, provider: 'firecrawl', reason: 'no FIRECRAWL_API_KEY' }
  const formats = opts.takeScreenshot ? ['markdown', 'screenshot'] : ['markdown']
  const data = await postJSON(
    'https://api.firecrawl.dev/v1/scrape',
    { url, formats },
    { authorization: `Bearer ${key}` },
    signal,
    fetchImpl,
  )
  const markdown = data?.data?.markdown || data?.markdown || ''
  const rawShot = data?.data?.screenshot || data?.screenshot || ''
  const shot = opts.takeScreenshot && rawShot ? persistScreenshot(rawShot, url, opts) : null
  return {
    ok: markdown.length > 0 || !!shot,
    provider: 'firecrawl',
    markdown,
    ...(shot ? { screenshot: shot } : {}),
    reason: markdown.length || shot ? '' : 'empty',
  }
}

export async function tavilyExtract(ctx, cfg, url, signal, fetchImpl = fetch, _opts = {}) {
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

export async function crawl4aiExtract(ctx, cfg, url, signal, fetchImpl = fetch, opts = {}) {
  const base = cfg.crawl4aiUrl
  if (!base) return { ok: false, provider: 'crawl4ai', reason: 'crawl4ai not configured' }
  const token = await resolveApiKey(ctx, cfg.crawl4aiTokenEnv)
  const headers = token ? { authorization: `Bearer ${token}` } : {}
  const formats = opts.takeScreenshot ? ['markdown', 'screenshot'] : ['markdown']
  const dispatcher = getSafeDispatcher({ allowInternal: true, proxyUrl: cfg?.egressProxyUrl })
  const data = await postJSON(
    `${base.replace(/\/$/, '')}/v0/scrape`,
    { url, formats, ...(opts.takeScreenshot ? { screenshot: true } : {}) },
    headers,
    signal,
    fetchImpl,
    dispatcher,
  )
  const markdown = data?.data?.markdown || data?.markdown || data?.result?.markdown || ''
  const rawShot = data?.data?.screenshot || data?.screenshot || data?.result?.screenshot || ''
  const shot = opts.takeScreenshot && rawShot ? persistScreenshot(rawShot, url, opts) : null
  return {
    ok: markdown.length > 0 || !!shot,
    provider: 'crawl4ai',
    markdown,
    ...(shot ? { screenshot: shot } : {}),
    reason: markdown.length || shot ? '' : 'empty',
  }
}

export async function jinaExtract(ctx, cfg, url, signal, fetchImpl = fetch, _opts = {}) {
  if (cfg.jinaEnabled === false) return { ok: false, provider: 'jina', reason: 'jina disabled' }
  const target = `https://r.jina.ai/${url}`
  const res = await fetchImpl(target, {
    method: 'GET',
    headers: { accept: 'text/plain' },
    signal,
    redirect: 'manual',
  })
  if (!res.ok) throw new Error(`Jina HTTP ${res.status}`)
  const markdown = (await readBoundedText(res)).trim()
  return { ok: markdown.length > 0, provider: 'jina', markdown, reason: markdown.length ? '' : 'empty' }
}

/** Last-resort keyless extract: fetch HTML and strip tags, or format structured text documents. */
export async function readabilityExtract(ctx, cfg, url, signal, fetchImpl = fetch, _opts = {}) {
  if (cfg.readabilityEnabled === false) return { ok: false, provider: 'readability', reason: 'readability disabled' }

  // Strictly enforce SSRF validation on the initial target BEFORE using any egress proxy
  await assertExtractUrlAllowed(url, {
    allowInternal: !!cfg?.allowInternalUrls,
    signal,
  })

  let currentUrl = url
  let res
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const dispatcher = getSafeDispatcher({
      allowInternal: !!cfg?.allowInternalUrls,
      proxyUrl: cfg?.egressProxyUrl,
    })
    const fetchOpts = {
      method: 'GET',
      headers: { accept: 'text/html,application/xhtml+xml,application/pdf,text/plain,text/csv,application/json;q=0.9,*/*;q=0.8' },
      signal,
      redirect: 'manual',
      ...(dispatcher ? { dispatcher } : {}),
    }
    res = await fetchImpl(currentUrl, fetchOpts)

    const status = typeof res.status === 'number' ? res.status : (res.ok ? 200 : 500)
    if (status >= 300 && status < 400) {
      const location = res.headers?.get ? res.headers.get('location') : res.headers?.location
      if (!location) {
        throw new UrlPolicyError(`redirect status ${status} without Location header`, 'WEB_GATEWAY_BLOCKED_URL')
      }
      if (redirects === MAX_REDIRECTS) {
        throw new UrlPolicyError(`exceeded maximum redirects (${MAX_REDIRECTS})`, 'WEB_GATEWAY_BLOCKED_URL')
      }
      let nextUrl
      if (!cfg?.allowInternalUrls) {
        const validatedUrl = assertSameOriginRedirect(new URL(currentUrl), location)
        nextUrl = validatedUrl.toString()
      } else {
        try {
          nextUrl = new URL(location, currentUrl).toString()
        } catch (_err) {
          throw new UrlPolicyError(`invalid redirect Location: "${location}"`, 'WEB_GATEWAY_INVALID_URL')
        }
      }

      await assertExtractUrlAllowed(nextUrl, {
        allowInternal: !!cfg?.allowInternalUrls,
        signal,
      })

      currentUrl = nextUrl
      continue
    }

    break
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const contentType = (res.headers?.get ? res.headers.get('content-type') : res.headers?.['content-type']) || ''
  const docType = getDocumentType(currentUrl, contentType)

  if (docType === 'pdf') {
    return { ok: false, provider: 'readability', reason: 'readability cannot parse binary PDF; use Jina or Firecrawl' }
  }

  const rawText = await readBoundedText(res)
  if (docType === 'csv' || docType === 'json' || docType === 'txt') {
    const formatted = formatDocumentMarkdown(docType, rawText, currentUrl)
    return { ok: formatted.length > 0, provider: 'readability', markdown: formatted, reason: formatted.length ? '' : 'empty' }
  }

  let text = rawText
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
  MAX_BODY_BYTES,
  MAX_REDIRECTS,
  readBoundedText,
  UrlPolicyError,
}
