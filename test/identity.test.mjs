import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('public package and host bundle identities match', async () => {
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  const patch = await readFile(resolve(root, 'cordis.patch.yml'), 'utf8')
  const client = await readFile(resolve(root, 'lib/client.js'), 'utf8')
  const { name } = await import('../lib/index.js')
  assert.equal(pkg.name, '@goodandready/dsh-web-gateway')
  assert.equal(name, '@goodandready/dsh-web-gateway')
  assert.match(patch, /name: '@goodandready\/dsh-web-gateway'/)
  assert.match(client, /id: '@goodandready\/dsh-web-gateway'/)
  assert.doesNotMatch(patch, /@goodandready-private/)
  assert.doesNotMatch(client, /@goodandready-private/)
})

test('source has no machine-specific infrastructure references', async () => {
  const source = await readFile(resolve(root, 'lib/index.js'), 'utf8')
  assert.doesNotMatch(source, /\/home\/|192\.168\.|codex_migrate|MiniAI|MiniPC|vadim@/)
})

test('README uses public install route', async () => {
  const readme = await readFile(resolve(root, 'README.md'), 'utf8')
  assert.match(readme, /add @goodandready\/dsh-web-gateway/)
  assert.doesNotMatch(readme, /@goodandready-private/)
  assert.doesNotMatch(readme, /add file:/)
})

test('updater metadata matches package identity and preserves release-age guard', async () => {
  const updater = await readFile(resolve(root, 'lib/updater.js'), 'utf8')
  assert.match(updater, /@goodandready\/dsh-web-gateway/)
  assert.doesNotMatch(updater, /@goodandready\/dsh-usage-guard/)
  assert.doesNotMatch(updater, /minimumReleaseAge/)
})
