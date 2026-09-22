import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_EXTRACT_ORDER,
  DEFAULT_SEARCH_ORDER,
  EXTRACT_PROVIDER_IDS,
  SEARCH_PROVIDER_IDS,
  parseProviderOrder,
  runProviderChain,
} from '../lib/chain.js'

test('parseProviderOrder falls back to defaults on empty', () => {
  assert.deepEqual(parseProviderOrder('', SEARCH_PROVIDER_IDS), [...SEARCH_PROVIDER_IDS])
  assert.deepEqual(parseProviderOrder('  ', EXTRACT_PROVIDER_IDS), [...EXTRACT_PROVIDER_IDS])
})

test('parseProviderOrder keeps known ids, drops unknown, dedupes', () => {
  assert.deepEqual(
    parseProviderOrder('exa, tavily, nope, exa, firecrawl', SEARCH_PROVIDER_IDS),
    ['exa', 'tavily', 'firecrawl'],
  )
})

test('default order strings match allow-lists', () => {
  assert.equal(DEFAULT_SEARCH_ORDER, SEARCH_PROVIDER_IDS.join(','))
  assert.equal(DEFAULT_EXTRACT_ORDER.split(',').sort().join(','), [...EXTRACT_PROVIDER_IDS].sort().join(','))
  assert.ok(DEFAULT_EXTRACT_ORDER.includes('jina'))
})

test('runProviderChain returns skipped reasons and first success', async () => {
  const outcome = await runProviderChain([
    { name: 'a', run: async () => ({ ok: false, provider: 'a', reason: 'no key' }) },
    { name: 'b', run: async () => { throw new Error('HTTP 429') } },
    { name: 'c', run: async () => ({ ok: true, provider: 'c', results: [{ title: 't', url: 'u', snippet: 's' }] }) },
  ])
  assert.equal(outcome.ok, true)
  assert.equal(outcome.provider, 'c')
  assert.deepEqual(outcome.skipped, [
    { provider: 'a', reason: 'no key' },
    { provider: 'b', reason: 'HTTP 429' },
  ])
  assert.equal(outcome.payload.results.length, 1)
})

test('runProviderChain fails with all skipped', async () => {
  const outcome = await runProviderChain([
    { name: 'a', run: async () => ({ ok: false, provider: 'a', reason: 'empty' }) },
  ])
  assert.equal(outcome.ok, false)
  assert.deepEqual(outcome.skipped, [{ provider: 'a', reason: 'empty' }])
})
