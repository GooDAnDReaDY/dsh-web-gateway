import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Config, readConfig } from '../lib/index.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Mirrors DSH settings' own volatileForm(): a namespace's form is built from the
// volatile fields of its profile entry schema, and a schema with no volatile
// field yields no form at all. DSH reads type/dict/meta off the Schema instance.
function volatileKeys(schema = Config) {
  if (schema.meta?.volatile) return []
  if (schema.type !== 'object') return []
  return Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
    const nested = volatileKeys(child)
    return nested.length === 0 && child.meta?.volatile ? [key] : nested
  })
}

test('schema serves a settings form, so a card can ever mount', () => {
  assert.ok(
    volatileKeys().length > 0,
    'Config needs at least one .volatile() field or DSH serves no form for this namespace',
  )
})

test('every field the settings card writes is served by the form', async () => {
  const client = await readFile(resolve(root, 'lib/client.js'), 'utf8')
  const start = client.indexOf('const defaults = {')
  assert.notEqual(start, -1, 'card must declare its default field set')
  const body = client.slice(start, client.indexOf('}', start))
  const keys = [...body.matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:/g)].map((m) => m[1]).filter((k) => k !== 'defaults')
  assert.ok(keys.length > 20, `expected the card field set, parsed ${keys.length}`)
  const served = new Set(volatileKeys())
  assert.deepEqual(keys.filter((key) => !served.has(key)), [], 'card writes fields DSH does not expose in the form')
})

test('volatile boxes unwrap to plain values the plugin can use', () => {
  const raw = Config({ timeoutMs: 1234, defaultLimit: 7 })
  assert.equal(typeof raw.timeoutMs.get, 'function', 'volatile fields hold a Volatile box')
  const live = readConfig({ timeoutMs: 1234, defaultLimit: 7 })
  assert.equal(live.timeoutMs, 1234)
  assert.equal(live.defaultLimit, 7)
})

test('defaults survive for fields the profile never set', () => {
  const live = readConfig({})
  assert.equal(live.defaultLimit, 5)
  assert.equal(live.timeoutMs, 30000)
  assert.equal(live.diskCacheEnabled, true)
  assert.equal(live.searchProviderOrder, 'tavily,brave,firecrawl,exa,searxng,duckduckgo')
})

test('card mounts on seats that exist in 0.1.7-rc.2 and 0.2.0', async () => {
  const client = await readFile(resolve(root, 'lib/client.js'), 'utf8')
  assert.match(client, /'plugins\.item'/)
  assert.match(client, /'plugins\.row\.config'/)
  assert.doesNotMatch(client, /'settings\.plugin\.item'/, 'settings.plugin.item was retired before 0.1.7-rc.2')
})

test('card reads the form through getSnapshot/subscribe, which both releases share', async () => {
  const client = await readFile(resolve(root, 'lib/client.js'), 'utf8')
  assert.match(client, /getSnapshot/)
  assert.match(client, /\.subscribe\(/)
  assert.doesNotMatch(client, /scope\.get\(\)/, 'ConfigForm has no get() in 0.1.7-rc.2 or 0.2.0')
  assert.doesNotMatch(client, /scope\.watch\(/, 'ConfigForm has no watch() in 0.1.7-rc.2 or 0.2.0')
})

test('host re-reads volatile config instead of the removed settings.register', async () => {
  const source = await readFile(resolve(root, 'lib/index.js'), 'utf8')
  assert.match(source, /loader\/volatile-update/)
  assert.doesNotMatch(source, /settings\?\.register|settings\.register\(/, 'settings.register exists in neither release')
})

test('peer ranges accept the 0.1.7 and 0.2.0 DSH package lines', async () => {
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  const semver = await import('semver')
  for (const [name, range] of Object.entries(pkg.peerDependencies)) {
    if (name === '@deepseek-ai/cordis' || name === '@deepseek-ai/schemastery') continue
    assert.ok(semver.satisfies('0.1.7-rc.2', range), `${name} ${range} must accept 0.1.7-rc.2`)
    assert.ok(semver.satisfies('0.2.0-rc.1', range), `${name} ${range} must accept 0.2.0-rc.1`)
  }
  assert.ok(
    semver.satisfies('3.18.4', pkg.peerDependencies['@deepseek-ai/schemastery']),
    'schemastery must accept the version that provides .volatile()',
  )
  assert.ok(
    !semver.satisfies('3.18.1', pkg.peerDependencies['@deepseek-ai/schemastery']),
    'schemastery 3.18.1 lacks .volatile() and must not be accepted',
  )
})
