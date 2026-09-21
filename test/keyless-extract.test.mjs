import test from 'node:test'
import assert from 'node:assert/strict'
import { jinaExtract, readabilityExtract } from '../lib/providers.js'

test('jinaExtract disabled', async () => {
  const out = await jinaExtract({}, { jinaEnabled: false }, 'https://example.com', undefined, async () => {
    throw new Error('should not fetch')
  })
  assert.equal(out.ok, false)
  assert.equal(out.provider, 'jina')
})

test('jinaExtract parses text', async () => {
  const out = await jinaExtract({}, { jinaEnabled: true }, 'https://example.com', undefined, async () => ({
    ok: true,
    text: async () => '# Hello\n\nWorld',
  }))
  assert.equal(out.ok, true)
  assert.match(out.markdown, /Hello/)
})

test('readabilityExtract strips html', async () => {
  const out = await readabilityExtract({}, { readabilityEnabled: true }, 'https://example.com', undefined, async () => ({
    ok: true,
    text: async () => `<html><script>x</script><body><h1>Title</h1><p>${'Hello world content here for length. '.repeat(5)}</p></body></html>`,
  }))
  assert.equal(out.ok, true)
  assert.match(out.markdown, /Title/)
  assert.doesNotMatch(out.markdown, /<script/)
})
