import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { runProviderRace, runProviderAggregate } from '../lib/chain.js'
import { normalizeSearchQuery } from '../lib/filters.js'
import { firecrawlExtract, crawl4aiExtract, readabilityExtract, persistScreenshot } from '../lib/providers.js'
import { makeTelemetry } from '../lib/telemetry.js'
import { parseProxyUrl, getSafeDispatcher } from '../lib/url-policy.js'
import { buildHealthSnapshot } from '../lib/health.js'

test('#28 runProviderRace returns fastest non-empty result and aborts slower competitors', async () => {
  let slowAborted = false
  const out = await runProviderRace([
    {
      name: 'slow',
      run: async (signal) => {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 500)
          signal?.addEventListener('abort', () => {
            slowAborted = true
            clearTimeout(timer)
            resolve()
          }, { once: true })
        })
        return { ok: true, provider: 'slow', results: [{ url: 'https://slow.example.com', title: 'Slow' }] }
      },
    },
    {
      name: 'fast',
      run: async () => {
        await new Promise((r) => setTimeout(r, 15))
        return { ok: true, provider: 'fast', results: [{ url: 'https://fast.example.com', title: 'Fast' }] }
      },
    },
  ], { concurrency: 2 })

  assert.equal(out.ok, true)
  assert.equal(out.provider, 'fast')
  assert.equal(out.payload.results.length, 1)
  assert.equal(out.payload.results[0].url, 'https://fast.example.com')
  assert.equal(slowAborted, true)
})

test('#28 runProviderAggregate merges results and deduplicates URLs across providers', async () => {
  const out = await runProviderAggregate([
    {
      name: 'p1',
      run: async () => ({
        ok: true,
        provider: 'p1',
        results: [
          { url: 'https://example.com/a', title: 'A from p1' },
          { url: 'https://example.com/b', title: 'B from p1' },
        ],
      }),
    },
    {
      name: 'p2',
      run: async () => ({
        ok: true,
        provider: 'p2',
        results: [
          { url: 'https://example.com/a/', title: 'A duplicate from p2' },
          { url: 'https://example.com/c', title: 'C from p2' },
        ],
      }),
    },
  ], { concurrency: 2 })

  assert.equal(out.ok, true)
  assert.equal(out.provider, 'p1+p2')
  assert.equal(out.payload.results.length, 3)
  assert.deepEqual(
    out.payload.results.map((r) => r.title),
    ['A from p1', 'B from p1', 'C from p2'],
  )
})

test('#29 normalizeSearchQuery produces canonical key for word permutations while preserving quotes and operators', () => {
  const k1 = normalizeSearchQuery('Node.js   async/await!')
  const k2 = normalizeSearchQuery('async/await, node.js?')
  assert.equal(k1, k2)

  const qWithOps = normalizeSearchQuery('site:github.com -legacy "exact phrase" alpha beta')
  const qWithOpsReordered = normalizeSearchQuery('beta alpha "exact phrase" -legacy site:github.com')
  assert.equal(qWithOps, qWithOpsReordered)
  assert.ok(qWithOps.includes('"exact phrase"'))
  assert.ok(qWithOps.includes('-legacy'))
  assert.ok(qWithOps.includes('site:github.com'))
})

test('#30 firecrawlExtract and crawl4aiExtract support takeScreenshot and persistScreenshot saves PNG', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-shot-'))
  try {
    const fakeCtx = {
      credentials: {
        resolve: async () => ({ value: 'fc-key' }),
      },
    }
    let fcBody = null
    const fcMockFetch = async (_url, init) => {
      fcBody = JSON.parse(init.body)
      return new Response(JSON.stringify({
        data: {
          markdown: '# Hello Firecrawl',
          screenshot: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          metadata: { title: 'FC Page' },
        },
      }), { status: 200 })
    }

    const fcRes = await firecrawlExtract(
      fakeCtx,
      { firecrawlApiKeyEnv: 'FIRECRAWL_API_KEY' },
      'https://example.com',
      undefined,
      fcMockFetch,
      { takeScreenshot: true, dir: tmpDir },
    )
    assert.deepEqual(fcBody.formats, ['markdown', 'screenshot'])
    assert.equal(fcRes.ok, true)
    assert.ok(fcRes.screenshot)
    assert.ok(fcRes.screenshot.dataUri.startsWith('data:image/png;base64,'))
    assert.ok(fs.existsSync(fcRes.screenshot.screenshotPath))

    let c4aBody = null
    const c4aMockFetch = async (_url, init) => {
      c4aBody = JSON.parse(init.body)
      return new Response(JSON.stringify({
        result: {
          markdown: '# Hello Crawl4AI',
          screenshot: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        },
      }), { status: 200 })
    }

    const c4aRes = await crawl4aiExtract(
      fakeCtx,
      { crawl4aiUrl: 'https://crawl.example.com', crawl4aiTokenEnv: 'CRAWL4AI_TOKEN' },
      'https://example.com',
      undefined,
      c4aMockFetch,
      { takeScreenshot: true, dir: tmpDir },
    )
    assert.equal(c4aBody.screenshot, true)
    assert.equal(c4aRes.ok, true)
    assert.ok(c4aRes.screenshot)
    assert.ok(c4aRes.screenshot.dataUri.startsWith('data:image/png;base64,'))

    const remoteSaved = persistScreenshot('https://cdn.example.com/shot.png', 'https://example.com/test', { dir: tmpDir })
    assert.equal(remoteSaved.screenshotUrl, 'https://cdn.example.com/shot.png')
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('#31 makeTelemetry computes p50/p95 latencies, estimates USD costs, and supports reset', () => {
  const tel = makeTelemetry()
  for (const ms of [100, 120, 140, 160, 180, 200, 220, 240, 260, 900]) {
    tel.record('tavily', ms, true)
  }
  tel.record('searxng', 45, true)

  const snap = tel.snapshot({
    providers: {
      tavily: { used: 10, cap: 100 },
      searxng: { used: 1, cap: 0 },
    },
  })

  assert.equal(snap.providers.tavily.calls, 10)
  assert.equal(snap.providers.tavily.p50Ms, 180)
  assert.equal(snap.providers.tavily.p95Ms, 900)
  assert.equal(snap.providers.tavily.estimatedUsd, 0.05)
  assert.equal(snap.providers.searxng.estimatedUsd, 0)
  assert.equal(snap.totalEstimatedUsd, 0.05)

  tel.reset()
  const afterReset = tel.snapshot()
  assert.equal(afterReset.providers.tavily.calls, 0)
  assert.equal(afterReset.providers.tavily.p50Ms, 0)
})

test('#32 parseProxyUrl, getSafeDispatcher with proxyUrl, and SSRF check before proxy', async () => {
  assert.equal(parseProxyUrl('http://127.0.0.1:8888/').href, 'http://127.0.0.1:8888/')
  assert.throws(() => parseProxyUrl('ftp://127.0.0.1:21'), /unsupported egressProxyUrl scheme/)

  const disp = getSafeDispatcher({ allowInternal: false, proxyUrl: 'http://127.0.0.1:8888' })
  assert.ok(disp)

  await assert.rejects(
    () => readabilityExtract(
      {},
      { allowInternalUrls: false, egressProxyUrl: 'http://proxy.example.com:8080' },
      'http://127.0.0.1:8080/admin',
      undefined,
      async () => new Response('<html><body>secret</body></html>', { status: 200 }),
    ),
    /non-public IP address/,
  )

  const health = await buildHealthSnapshot(
    {},
    { egressProxyUrl: 'http://127.0.0.1:8888' },
    async () => new Response('ok', { status: 200 }),
  )
  assert.equal(health.endpoints.egressProxy.status, 'ok')
})
