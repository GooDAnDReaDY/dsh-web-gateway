import test from 'node:test'
import assert from 'node:assert/strict'
import { tavilySearch, exaSearch, searxngSearch } from '../lib/providers.js'

function mockCtx(keys = {}) {
  return {
    credentials: {
      async resolve(ref) {
        const name = typeof ref === 'string' ? ref : ref?.name || ref?.ref || String(ref)
        if (keys[name]) return { value: keys[name] }
        throw new Error('missing')
      },
    },
  }
}

test('tavilySearch maps news category to topic news', async () => {
  let capturedBody = null
  const mockFetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body)
    return {
      ok: true,
      status: 200,
      async json() { return { results: [{ title: 'T', url: 'https://t.test', content: 'c' }] } },
    }
  }

  await tavilySearch(
    mockCtx({ TAVILY_API_KEY: 'test' }),
    { tavilyApiKeyEnv: 'TAVILY_API_KEY' },
    'breaking news',
    5,
    'basic',
    undefined,
    mockFetch,
    { category: 'news' },
  )
  assert.equal(capturedBody.topic, 'news')
})

test('exaSearch maps code and academic categories to exa categories', async () => {
  let capturedBody = null
  const mockFetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body)
    return {
      ok: true,
      status: 200,
      async json() { return { results: [{ title: 'E', url: 'https://e.test', text: 't' }] } },
    }
  }

  await exaSearch(
    mockCtx({ EXA_API_KEY: 'test' }),
    { exaApiKeyEnv: 'EXA_API_KEY' },
    'deepseek repo',
    5,
    undefined,
    mockFetch,
    { category: 'code' },
  )
  assert.equal(capturedBody.category, 'github')

  await exaSearch(
    mockCtx({ EXA_API_KEY: 'test' }),
    { exaApiKeyEnv: 'EXA_API_KEY' },
    'transformers paper',
    5,
    undefined,
    mockFetch,
    { category: 'academic' },
  )
  assert.equal(capturedBody.category, 'research paper')
})

test('searxngSearch maps categories to searxng category params', async () => {
  let capturedUrl = null
  const mockFetch = async (url) => {
    capturedUrl = url
    return {
      ok: true,
      status: 200,
      async json() { return { results: [{ title: 'S', url: 'https://s.test', content: 's' }] } },
    }
  }

  await searxngSearch(
    mockCtx(),
    { searxngUrl: 'http://localhost:8888' },
    'code snippet',
    5,
    undefined,
    mockFetch,
    { category: 'code' },
  )
  assert.match(capturedUrl, /categories=it/)
})
