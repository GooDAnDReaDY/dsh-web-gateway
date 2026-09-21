import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHealthSnapshot } from '../lib/health.js'

test('buildHealthSnapshot reports missing credentials and skipped endpoints', async () => {
  const prev = { ...process.env }
  for (const k of ['TAVILY_API_KEY','FIRECRAWL_API_KEY','EXA_API_KEY','CRAWL4AI_TOKEN']) delete process.env[k]

  const ctx = { credentials: { resolve: async () => null } }
  const cfg = {
    tavilyApiKeyEnv: 'TAVILY_API_KEY',
    firecrawlApiKeyEnv: 'FIRECRAWL_API_KEY',
    exaApiKeyEnv: 'EXA_API_KEY',
    crawl4aiTokenEnv: 'CRAWL4AI_TOKEN',
    searxngUrl: '',
    crawl4aiUrl: '',
  }
  const snap = await buildHealthSnapshot(ctx, cfg, async () => { throw new Error('no fetch') })
  assert.equal(snap.credentials.tavily.status, 'missing')
  assert.equal(snap.endpoints.searxng.status, 'skipped')
  assert.equal(snap.endpoints.crawl4ai.status, 'skipped')
  Object.assign(process.env, prev)
})

test('buildHealthSnapshot pings configured endpoints', async () => {
  const prev = { ...process.env }
  for (const k of ['TAVILY_API_KEY','FIRECRAWL_API_KEY','EXA_API_KEY','CRAWL4AI_TOKEN']) delete process.env[k]

  const ctx = {
    credentials: {
      resolve: async (ref) => (String(ref).includes('TAVILY') ? { value: 'secret' } : null),
    },
  }
  const cfg = {
    tavilyApiKeyEnv: 'TAVILY_API_KEY',
    firecrawlApiKeyEnv: 'FIRECRAWL_API_KEY',
    exaApiKeyEnv: 'EXA_API_KEY',
    crawl4aiTokenEnv: 'CRAWL4AI_TOKEN',
    searxngUrl: 'http://127.0.0.1:9',
    crawl4aiUrl: 'http://127.0.0.1:9',
  }
  const fetchImpl = async () => ({ ok: true, status: 200 })
  const snap = await buildHealthSnapshot(ctx, cfg, fetchImpl)
  assert.equal(snap.credentials.tavily.status, 'present')
  assert.equal(snap.credentials.firecrawl.status, 'missing')
  assert.equal(snap.endpoints.searxng.status, 'ok')
  assert.equal(snap.endpoints.crawl4ai.status, 'ok')
  Object.assign(process.env, prev)
})
