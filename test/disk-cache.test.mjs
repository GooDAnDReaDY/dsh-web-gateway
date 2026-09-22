import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeDiskCache, makeLayeredCache } from '../lib/disk-cache.js'
import { makeCache } from '../lib/cache.js'

test('disk cache roundtrip and TTL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gw-cache-'))
  try {
    const c = makeDiskCache({ ttlMs: 60_000, maxEntries: 10, dir })
    c.set('k', { hello: 1 })
    assert.deepEqual(c.get('k'), { hello: 1 })
    assert.equal(c.size(), 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('layered cache promotes disk hits to memory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gw-cache2-'))
  try {
    const disk = makeDiskCache({ ttlMs: 60_000, maxEntries: 10, dir })
    disk.set('x', { v: 2 })
    const layered = makeLayeredCache({ memory: makeCache(60_000), disk })
    assert.deepEqual(layered.get('x'), { v: 2 })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
