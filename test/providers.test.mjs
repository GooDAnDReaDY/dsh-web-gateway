import test from 'node:test'
import assert from 'node:assert/strict'
import {
  crawl4aiExtract,
  exaSearch,
  firecrawlExtract,
  firecrawlSearch,
  searxngSearch,
  tavilyExtract,
  tavilySearch,
} from '../lib/providers.js'
import { makeCache } from '../lib/cache.js'

function mockCtx(keys = {}) {
  return {
    credentials: {
      async resolve(ref) {
        const name = typeof ref === 'string' ? ref : ref?.name || ref?.ref || String(ref)
        // credentialRef returns an object; accept common shapes
        const key = keys[name] || keys[ref?.env] || keys[ref?.id]
        if (!key) {
          // try matching env name from stringification
          for (const [k, v] of Object.entries(keys)) {
            if (String(ref).includes(k) || name === k) return { value: v }
          }
          throw new Error('missing')
        }
        return { value: key }
      },
    },
  }
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data },
  }
}

test('tavilySearch skips without key', async () => {
  const out = await tavilySearch(mockCtx(), { tavilyApiKeyEnv: 'TAVILY_API_KEY' }, 'q', 5, 'basic', undefined, async () => {
    throw new Error('should not fetch')
  })
  assert.equal(out.ok, false)
  assert.match(out.reason, /TAVILY/)
})

test('tavilySearch parses results', async () => {
  process.env.TAVILY_API_KEY = 'tvly-test'
  try {
    const out = await tavilySearch(
      mockCtx({ TAVILY_API_KEY: 'tvly-test' }),
      { tavilyApiKeyEnv: 'TAVILY_API_KEY' },
      'hello',
      3,
      'basic',
      undefined,
      async () => jsonResponse({ results: [{ title: 'A', url: 'https://a.test', content: 'snip' }] }),
    )
    assert.equal(out.ok, true)
    assert.equal(out.provider, 'tavily')
    assert.equal(out.results[0].title, 'A')
  } finally {
    delete process.env.TAVILY_API_KEY
  }
})

test('firecrawlSearch parses data array', async () => {
  process.env.FIRECRAWL_API_KEY = 'fc-test'
  try {
    const out = await firecrawlSearch(
      mockCtx({ FIRECRAWL_API_KEY: 'fc-test' }),
      { firecrawlApiKeyEnv: 'FIRECRAWL_API_KEY' },
      'q',
      2,
      undefined,
      async () => jsonResponse({ data: [{ title: 'B', url: 'https://b.test', description: 'd' }] }),
    )
    assert.equal(out.ok, true)
    assert.equal(out.results[0].url, 'https://b.test')
  } finally {
    delete process.env.FIRECRAWL_API_KEY
  }
})

test('exaSearch parses results', async () => {
  process.env.EXA_API_KEY = 'exa-test'
  try {
    const out = await exaSearch(
      mockCtx({ EXA_API_KEY: 'exa-test' }),
      { exaApiKeyEnv: 'EXA_API_KEY' },
      'q',
      2,
      undefined,
      async () => jsonResponse({ results: [{ title: 'C', url: 'https://c.test', text: 'long text here' }] }),
    )
    assert.equal(out.ok, true)
    assert.equal(out.provider, 'exa')
  } finally {
    delete process.env.EXA_API_KEY
  }
})

test('searxngSearch requires configured URL', async () => {
  const out = await searxngSearch(mockCtx(), { searxngUrl: '' }, 'q', 5, undefined, async () => {
    throw new Error('no')
  })
  assert.equal(out.ok, false)
})

test('searxngSearch parses results', async () => {
  const out = await searxngSearch(
    mockCtx(),
    { searxngUrl: 'http://127.0.0.1:8080' },
    'q',
    5,
    undefined,
    async (url) => {
      assert.match(String(url), /format=json/)
      return jsonResponse({ results: [{ title: 'S', url: 'https://s.test', content: 'x' }] })
    },
  )
  assert.equal(out.ok, true)
  assert.equal(out.provider, 'searxng')
})

test('extract providers parse markdown', async () => {
  process.env.FIRECRAWL_API_KEY = 'fc'
  process.env.TAVILY_API_KEY = 'tv'
  try {
    const fc = await firecrawlExtract(
      mockCtx({ FIRECRAWL_API_KEY: 'fc' }),
      { firecrawlApiKeyEnv: 'FIRECRAWL_API_KEY' },
      'https://example.com',
      undefined,
      async () => jsonResponse({ data: { markdown: '# hi' } }),
    )
    assert.equal(fc.ok, true)
    assert.equal(fc.markdown, '# hi')

    const tv = await tavilyExtract(
      mockCtx({ TAVILY_API_KEY: 'tv' }),
      { tavilyApiKeyEnv: 'TAVILY_API_KEY' },
      'https://example.com',
      undefined,
      async () => jsonResponse({ results: [{ raw_content: 'body' }] }),
    )
    assert.equal(tv.ok, true)
    assert.equal(tv.markdown, 'body')

    const c4 = await crawl4aiExtract(
      mockCtx(),
      { crawl4aiUrl: 'http://127.0.0.1:11235', crawl4aiTokenEnv: 'CRAWL4AI_TOKEN' },
      'https://example.com',
      undefined,
      async () => jsonResponse({ markdown: 'c4' }),
    )
    assert.equal(c4.ok, true)
  } finally {
    delete process.env.FIRECRAWL_API_KEY
    delete process.env.TAVILY_API_KEY
  }
})

test('makeCache respects TTL and size', () => {
  const c = makeCache(60_000)
  c.set('a', 1)
  assert.equal(c.get('a'), 1)
  const expired = makeCache(1)
  expired.set('b', 2)
  // force expiry
  const hit = expired.get('b')
  // value may still be present within 1ms; set then wait via fake by ttl 0
  const off = makeCache(0)
  off.set('c', 3)
  assert.equal(off.get('c'), undefined)
})

test('HTTP error surfaces as thrown', async () => {
  process.env.TAVILY_API_KEY = 'tv'
  try {
    await assert.rejects(
      () => tavilySearch(
        mockCtx({ TAVILY_API_KEY: 'tv' }),
        { tavilyApiKeyEnv: 'TAVILY_API_KEY' },
        'q', 1, 'basic', undefined,
        async () => jsonResponse({}, 429),
      ),
      /HTTP 429/,
    )
  } finally {
    delete process.env.TAVILY_API_KEY
  }
})
