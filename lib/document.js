// Document extraction support for web_gateway_extract.
// Detects document types and converts structured text (csv, json, txt) to markdown.

export function getDocumentType(url, contentType = '') {
  let pathname = ''
  try {
    pathname = (new URL(url)).pathname.toLowerCase()
  } catch {}

  const ct = String(contentType || '').toLowerCase()
  if (pathname.endsWith('.pdf') || ct.includes('application/pdf')) return 'pdf'
  if (pathname.endsWith('.docx') || ct.includes('wordprocessingml')) return 'docx'
  if (pathname.endsWith('.csv') || ct.includes('text/csv')) return 'csv'
  if (pathname.endsWith('.json') || ct.includes('application/json')) return 'json'
  if (pathname.endsWith('.txt') || ct.includes('text/plain')) return 'txt'
  return null
}

export function formatDocumentMarkdown(type, content, url) {
  const text = String(content || '').trim()
  if (type === 'csv') {
    return `### Data Document: ${url}\n\n\`\`\`csv\n${text.slice(0, 30000)}\n\`\`\``
  }
  if (type === 'json') {
    return `### JSON Document: ${url}\n\n\`\`\`json\n${text.slice(0, 30000)}\n\`\`\``
  }
  if (type === 'txt') {
    return `### Document: ${url}\n\n${text.slice(0, 30000)}`
  }
  return text
}
