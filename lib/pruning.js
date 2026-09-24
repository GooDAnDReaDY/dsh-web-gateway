// Markdown content pruning and noise removal for web_gateway_extract.
// Strips cookie notices, navigation link lists, social widgets, and collapses whitespace.

const COOKIE_PATTERNS = [
  /accept (all )?cookies/i,
  /we use cookies/i,
  /cookie (policy|settings|preferences|notice)/i,
  /privacy (policy|notice)/i,
  /gdpr/i,
]

const SOCIAL_PATTERNS = [
  /share on (twitter|facebook|linkedin|reddit|x)/i,
  /follow us on/i,
]

export function isBoilerplateLine(line) {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (COOKIE_PATTERNS.some((p) => p.test(trimmed)) && trimmed.length < 200) return true
  if (SOCIAL_PATTERNS.some((p) => p.test(trimmed)) && trimmed.length < 150) return true
  return false
}

export function pruneMarkdown(rawMarkdown, opts = {}) {
  if (!rawMarkdown || typeof rawMarkdown !== 'string') return ''
  const compact = opts.compact !== false

  const codeBlocks = []
  let text = rawMarkdown.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match)
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`
  })

  const lines = text.split('\n')
  const outLines = []

  let consecutiveLinks = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (isBoilerplateLine(trimmed)) continue

    const isSingleLink = /^[-*]\s*\[.+?\]\(.+?\)$/.test(trimmed) || /^\[.+?\]\(.+?\)$/.test(trimmed)
    if (isSingleLink) {
      consecutiveLinks++
      if (consecutiveLinks > 4 && compact) {
        continue
      }
    } else {
      consecutiveLinks = 0
    }

    let processedLine = line
    if (compact) {
      processedLine = processedLine.replace(/!\[(.*?)\]\(.*?\)/g, (_m, alt) => {
        return alt ? `[Image: ${alt}]` : ''
      })
    }

    outLines.push(processedLine)
  }

  let result = outLines.join('\n')

  result = result.replace(/__CODE_BLOCK_(\d+)__/g, (_m, index) => {
    return codeBlocks[Number(index)] || ''
  })

  result = result.replace(/\n{3,}/g, '\n\n')
  result = result.replace(/^#{1,6}\s*$/gm, '')

  return result.trim()
}
