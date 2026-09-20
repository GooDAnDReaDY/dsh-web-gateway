import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertExtractUrlAllowed,
  isPublicIpAddress,
  parseExtractUrl,
  UrlPolicyError,
} from '../lib/url-policy.js'

test('parseExtractUrl accepts http(s) only', () => {
  assert.equal(parseExtractUrl('https://example.com/a').hostname, 'example.com')
  assert.throws(() => parseExtractUrl('file:///etc/passwd'), UrlPolicyError)
  assert.throws(() => parseExtractUrl('ftp://example.com'), UrlPolicyError)
  assert.throws(() => parseExtractUrl('https://user:pass@example.com'), UrlPolicyError)
})

test('isPublicIpAddress blocks private and loopback', () => {
  assert.equal(isPublicIpAddress('8.8.8.8'), true)
  assert.equal(isPublicIpAddress('1.1.1.1'), true)
  assert.equal(isPublicIpAddress('127.0.0.1'), false)
  assert.equal(isPublicIpAddress('10.0.0.1'), false)
  assert.equal(isPublicIpAddress('192.168.1.1'), false)
  assert.equal(isPublicIpAddress('172.16.5.5'), false)
  assert.equal(isPublicIpAddress('169.254.169.254'), false)
  assert.equal(isPublicIpAddress('::1'), false)
  assert.equal(isPublicIpAddress('fe80::1'), false)
  assert.equal(isPublicIpAddress('fc00::1'), false)
  assert.equal(isPublicIpAddress('::ffff:127.0.0.1'), false)
})

test('assertExtractUrlAllowed blocks literal private hosts', async () => {
  await assert.rejects(
    () => assertExtractUrlAllowed('http://127.0.0.1/secret'),
    (err) => err instanceof UrlPolicyError && err.code === 'WEB_GATEWAY_BLOCKED_URL',
  )
  await assert.rejects(
    () => assertExtractUrlAllowed('http://192.168.0.10/x'),
    UrlPolicyError,
  )
  await assert.rejects(
    () => assertExtractUrlAllowed('http://169.254.169.254/latest/meta-data'),
    UrlPolicyError,
  )
})

test('assertExtractUrlAllowed blocks DNS answers that are private', async () => {
  const resolve = async () => [{ address: '10.1.2.3', family: 4 }]
  await assert.rejects(
    () => assertExtractUrlAllowed('https://evil.example', { resolve }),
    UrlPolicyError,
  )
})

test('assertExtractUrlAllowed allows public DNS answers', async () => {
  const resolve = async () => [{ address: '93.184.216.34', family: 4 }]
  const url = await assertExtractUrlAllowed('https://example.com/path', { resolve })
  assert.equal(url.hostname, 'example.com')
})

test('allowInternal skips public-IP policy', async () => {
  const url = await assertExtractUrlAllowed('http://127.0.0.1/local', { allowInternal: true })
  assert.equal(url.hostname, '127.0.0.1')
})
