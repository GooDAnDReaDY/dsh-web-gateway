import test from 'node:test'
import assert from 'node:assert/strict'
import { getDocumentType, formatDocumentMarkdown } from '../lib/document.js'

test('getDocumentType detects pdf, docx, csv, json, txt by url and content-type', () => {
  assert.equal(getDocumentType('https://example.com/report.pdf'), 'pdf')
  assert.equal(getDocumentType('https://example.com/api/get', 'application/pdf'), 'pdf')
  assert.equal(getDocumentType('https://example.com/data.csv'), 'csv')
  assert.equal(getDocumentType('https://example.com/config.json'), 'json')
  assert.equal(getDocumentType('https://example.com/notes.txt'), 'txt')
  assert.equal(getDocumentType('https://example.com/doc.docx'), 'docx')
  assert.equal(getDocumentType('https://example.com/index.html'), null)
})

test('formatDocumentMarkdown formats csv and json with code blocks', () => {
  const csv = 'id,name,val\n1,alice,100'
  const outCsv = formatDocumentMarkdown('csv', csv, 'https://example.com/data.csv')
  assert.match(outCsv, /```csv/)
  assert.match(outCsv, /alice/)

  const json = '{"status":"ok"}'
  const outJson = formatDocumentMarkdown('json', json, 'https://example.com/status.json')
  assert.match(outJson, /```json/)
})
