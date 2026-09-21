import test from 'node:test'
import assert from 'node:assert/strict'
import {
  filterSearchResults,
  freshnessToExaStart,
  freshnessToTavilyDays,
  normalizeFreshness,
  parseDomainList,
} from '../lib/filters.js'

test('parseDomainList strips schemes and paths', () => {
  assert.deepEqual(parseDomainList('https://Example.com/x, foo.org'), ['example.com', 'foo.org'])
})

test('filterSearchResults include/exclude', () => {
  const rows = [
    { title: 'a', url: 'https://docs.example.com/a', snippet: '' },
    { title: 'b', url: 'https://spam.bad/x', snippet: '' },
    { title: 'c', url: 'https://news.other.org/c', snippet: '' },
  ]
  assert.equal(filterSearchResults(rows, 'example.com', '').length, 1)
  assert.equal(filterSearchResults(rows, '', 'bad').length, 2)
})

test('freshness helpers', () => {
  assert.equal(normalizeFreshness('WEEK'), 'week')
  assert.equal(freshnessToTavilyDays('day'), 1)
  assert.ok(freshnessToExaStart('week'))
  assert.equal(freshnessToExaStart('any'), undefined)
})
