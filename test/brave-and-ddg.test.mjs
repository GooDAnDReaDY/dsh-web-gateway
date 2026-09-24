import test from 'node:test'
import assert from 'node:assert/strict'
import { braveSearch, duckduckgoSearch } from '../lib/providers.js'

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

test('braveSearch skips without key', async () => {
  const out = await braveSearch(mockCtx(), { braveApiKeyEnv: 'BRAVE_API_KEY' }, 'test query', 5, undefined, async () => {
    throw new Error('should not fetch')
  })
  assert.equal(out.ok, false)
  assert.equal(out.provider, 'brave')
  assert.match(out.reason, /BRAVE_API_KEY/)
})

test('braveSearch parses web results array', async () => {
  const mockFetch = async (url, opts) => {
    assert.match(opts.headers['X-Subscription-Token'], /brave-secret/)
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          web: {
            results: [
              { title: 'Brave Result 1', url: 'https://brave.example.com', description: 'Brave snippet description' },
            ],
          },
        }
      },
    }
  }

  const out = await braveSearch(
    mockCtx({ BRAVE_API_KEY: 'brave-secret' }),
    { braveApiKeyEnv: 'BRAVE_API_KEY' },
    'node test',
    5,
    undefined,
    mockFetch,
  )
  assert.equal(out.ok, true)
  assert.equal(out.provider, 'brave')
  assert.equal(out.results.length, 1)
  assert.equal(out.results[0].title, 'Brave Result 1')
  assert.equal(out.results[0].url, 'https://brave.example.com')
  assert.equal(out.results[0].snippet, 'Brave snippet description')
})

test('duckduckgoSearch skips when disabled', async () => {
  const out = await duckduckgoSearch(mockCtx(), { duckduckgoEnabled: false }, 'query', 3, undefined, async () => {})
  assert.equal(out.ok, false)
  assert.equal(out.provider, 'duckduckgo')
  assert.match(out.reason, /disabled/)
})

test('duckduckgoSearch parses HTML results and resolves redirect links', async () => {
  const sampleHtml = `
    <html>
      <body>
        <div class="results">
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage1&rut=1">Example Title 1</a>
          <a class="result__snippet">This is snippet 1 &amp; info</a>
          <a class="result__a" href="https://example.org/page2">Example Title 2</a>
          <a class="result__snippet">This is snippet 2</a>
        </div>
      </body>
    </html>
  `
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    async text() { return sampleHtml },
  })

  const out = await duckduckgoSearch(mockCtx(), { duckduckgoEnabled: true }, 'ddg query', 5, undefined, mockFetch)
  assert.equal(out.ok, true)
  assert.equal(out.provider, 'duckduckgo')
  assert.equal(out.results.length, 2)
  assert.equal(out.results[0].title, 'Example Title 1')
  assert.equal(out.results[0].url, 'https://example.com/page1')
  assert.equal(out.results[0].snippet, 'This is snippet 1 & info')
  assert.equal(out.results[1].url, 'https://example.org/page2')
})
