// Attempt expansion for dsh-web-gateway.
// A provider is one or more attempts: keyless ("free") and one per API key.
// With freeTierFirst, every free attempt runs before every keyed attempt.

const SEARCH_CATEGORY_SUPPORT = Object.freeze({
  firecrawl: ['general', 'news', 'code', 'academic'],
  keenable: ['general'],
  searxng: ['general', 'news', 'code', 'academic'],
  duckduckgo: ['general'],
  tavily: ['general', 'news'],
  brave: ['general'],
  exa: ['general', 'news', 'code', 'academic'],
})

const SEARCH_FRESHNESS_SUPPORT = Object.freeze({
  firecrawl: true,
  keenable: true,
  searxng: true,
  duckduckgo: false,
  tavily: true,
  brave: true,
  exa: true,
})

const EXTRACT_SCREENSHOT_PROVIDERS = Object.freeze(['firecrawl', 'crawl4ai'])
const EXTRACT_LOCAL_ONLY_PROVIDER = 'readability'

export function attemptLabel(provider, mode, keyIndex) {
  if (mode === 'free') return `${provider}:free`
  return keyIndex === undefined || keyIndex === 0
    ? `${provider}:key`
    : `${provider}:key#${keyIndex + 1}`
}

const SPLIT_CAP_PROVIDERS = new Set(['firecrawl', 'keenable'])

export function normalizeCapLabel(label) {
  const normalized = String(label).replace(/#\d+$/, '')
  const separator = normalized.indexOf(':')
  if (separator === -1) return normalized
  const provider = normalized.slice(0, separator)
  return SPLIT_CAP_PROVIDERS.has(provider) ? normalized : provider
}

export function supportsRequestFilters(provider, kind, request = {}) {
  if (kind === 'extract') {
    if (request.takeScreenshot && !EXTRACT_SCREENSHOT_PROVIDERS.includes(provider)) return false
    if (request.publicTarget === false && provider !== EXTRACT_LOCAL_ONLY_PROVIDER) return false
    return true
  }

  const category = request.category || 'general'
  const freshness = request.freshness || 'any'
  const categories = SEARCH_CATEGORY_SUPPORT[provider]
  if (!categories || !categories.includes(category)) return false
  // Firecrawl's tbs filter applies to web results, not news; a news query
  // with freshness would silently lose the freshness filter.
  if (provider === 'firecrawl' && category !== 'general' && freshness !== 'any') return false
  // Tavily's `days` parameter is documented for topic=news only.
  if (provider === 'tavily' && category !== 'news' && freshness !== 'any') return false
  if (freshness !== 'any' && !SEARCH_FRESHNESS_SUPPORT[provider]) return false
  return true
}

function freeAttempt(provider) {
  return { provider, mode: 'free', label: attemptLabel(provider, 'free') }
}

function keyAttempts(provider, keys = []) {
  if (!keys.length) {
    return [{ provider, mode: 'key', keyIndex: undefined, apiKey: undefined, label: attemptLabel(provider, 'key') }]
  }
  return keys.map((apiKey, keyIndex) => ({
    provider,
    mode: 'key',
    keyIndex,
    apiKey,
    label: attemptLabel(provider, 'key', keyIndex),
  }))
}

function firecrawlAttempts(kind, cfg, keys) {
  const freeEnabled = kind === 'search'
    ? cfg.firecrawlKeylessSearch !== false
    : cfg.firecrawlKeylessFetch !== false
  const out = []
  if (freeEnabled) out.push(freeAttempt('firecrawl'))
  if (freeEnabled && !(keys.firecrawl || []).length) return out
  out.push(...keyAttempts('firecrawl', keys.firecrawl))
  return out
}

function attemptsFor(provider, kind, cfg, keys, request) {
  if (!supportsRequestFilters(provider, kind, request)) return []

  if (kind === 'search') {
    switch (provider) {
      case 'firecrawl':
        return firecrawlAttempts('search', cfg, keys)
      case 'keenable': {
        if (cfg.keenableEnabled === false) return [freeAttempt('keenable')]
        const out = [freeAttempt('keenable')]
        if ((keys.keenable || []).length) out.push(...keyAttempts('keenable', keys.keenable))
        return out
      }
      case 'searxng':
        return [freeAttempt('searxng')]
      case 'duckduckgo':
        return [freeAttempt('duckduckgo')]
      case 'tavily':
      case 'brave':
      case 'exa':
        return keyAttempts(provider, keys[provider])
      default:
        return []
    }
  }

  switch (provider) {
    case 'firecrawl':
      return firecrawlAttempts('extract', cfg, keys)
    case 'jina':
      return [freeAttempt('jina')]
    case 'readability':
      return [freeAttempt('readability')]
    case 'tavily':
      return keyAttempts('tavily', keys.tavily)
    case 'crawl4ai':
      return keyAttempts('crawl4ai', keys.crawl4ai)
    default:
      return []
  }
}

export function expandAttempts({ kind, order = [], cfg = {}, keys = {}, request = {} }) {
  const free = []
  const keyed = []
  const interleaved = []

  for (const provider of order) {
    for (const attempt of attemptsFor(provider, kind, cfg, keys, request)) {
      if (attempt.mode === 'free') free.push(attempt)
      else keyed.push(attempt)
      interleaved.push(attempt)
    }
  }

  return cfg.freeTierFirst === false ? interleaved : [...free, ...keyed]
}
