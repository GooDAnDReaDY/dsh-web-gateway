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

test('readabilityExtract follows redirect to public url', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url === 'https://example.com/initial') {
      return {
        status: 302,
        ok: false,
        headers: new Map([['location', 'https://example.com/final']]),
      }
    }
    return {
      status: 200,
      ok: true,
      headers: new Map([['content-type', 'text/html']]),
      text: async () => '<html><body><h1>Final Title</h1><p>' + 'Content here for length test. '.repeat(5) + '</p></body></html>',
    }
  }

  const out = await readabilityExtract({}, { readabilityEnabled: true }, 'https://example.com/initial', undefined, fetchImpl)
  assert.equal(out.ok, true)
  assert.match(out.markdown, /Final Title/)
  assert.deepEqual(calls, ['https://example.com/initial', 'https://example.com/final'])
})

test('readabilityExtract blocks redirect to loopback target without fetching it', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url === 'https://example.com/ssrf-trap') {
      return {
        status: 302,
        ok: false,
        headers: new Map([['location', 'http://127.0.0.1/admin']]),
      }
    }
    return { status: 200, ok: true, text: async () => 'admin private data' }
  }

  await assert.rejects(
    () => readabilityExtract({}, { readabilityEnabled: true }, 'https://example.com/ssrf-trap', undefined, fetchImpl),
    (err) => {
      assert.match(err.message, /non-public IP address|invalid URL|cross-origin redirects are not allowed/i)
      return true
    },
  )
  assert.deepEqual(calls, ['https://example.com/ssrf-trap'])
})

test('readabilityExtract rejects redirects exceeding MAX_REDIRECTS', async () => {
  let count = 0
  const fetchImpl = async (url) => {
    count++
    return {
      status: 302,
      ok: false,
      headers: new Map([['location', `https://example.com/step${count}`]]),
    }
  }

  await assert.rejects(
    () => readabilityExtract({}, { readabilityEnabled: true }, 'https://example.com/loop', undefined, fetchImpl),
    (err) => {
      assert.match(err.message, /maximum redirects/i)
      return true
    },
  )
})
