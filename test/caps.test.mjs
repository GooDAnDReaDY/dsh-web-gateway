import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { capsFromConfig, makeDailyCaps } from '../lib/caps.js'

test('daily caps gate and record', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gw-caps-'))
  const path = join(dir, 'daily-caps.json')
  try {
    const caps = makeDailyCaps({ path })
    assert.equal(caps.check('tavily', 0).ok, true)
    assert.equal(caps.check('tavily', 1).ok, true)
    caps.record('tavily')
    const blocked = caps.check('tavily', 1)
    assert.equal(blocked.ok, false)
    assert.match(blocked.reason, /daily cap reached/)
    const snap = caps.snapshot(capsFromConfig({ dailyCapTavily: 1, dailyCapFirecrawl: 0 }))
    assert.equal(snap.providers.tavily.used, 1)
    assert.equal(snap.providers.tavily.cap, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
