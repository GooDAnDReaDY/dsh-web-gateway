import test from 'node:test'
import assert from 'node:assert/strict'
import { pruneMarkdown, isBoilerplateLine } from '../lib/pruning.js'

test('isBoilerplateLine detects cookies and social notices', () => {
  assert.equal(isBoilerplateLine('We use cookies to improve your experience.'), true)
  assert.equal(isBoilerplateLine('Accept all cookies'), true)
  assert.equal(isBoilerplateLine('Share on Twitter'), true)
  assert.equal(isBoilerplateLine('This is an important article paragraph.'), false)
})

test('pruneMarkdown preserves code blocks without modification', () => {
  const input = [
    '# Title',
    'Some text',
    '```javascript',
    '// Accept all cookies test in code',
    'console.log("hello");',
    '```',
    'Ending paragraph',
  ].join('\n')

  const out = pruneMarkdown(input)
  assert.match(out, /Accept all cookies test in code/)
  assert.match(out, /console\.log\("hello"\);/)
})

test('pruneMarkdown strips cookie banners and collapses blank lines', () => {
  const input = [
    '# Article Title',
    '',
    '',
    '',
    'Accept all cookies to continue',
    '',
    'Real useful content here.',
    '',
    '',
    'Follow us on Twitter',
  ].join('\n')

  const out = pruneMarkdown(input)
  assert.doesNotMatch(out, /Accept all cookies/)
  assert.doesNotMatch(out, /Follow us on Twitter/)
  assert.match(out, /Real useful content here\./)
  assert.doesNotMatch(out, /\n{3,}/)
})

test('pruneMarkdown compact replaces images with text badges', () => {
  const input = 'Look at this diagram: ![Architecture diagram](https://example.com/arch.png)'
  const out = pruneMarkdown(input, { compact: true })
  assert.equal(out, 'Look at this diagram: [Image: Architecture diagram]')
})
