// URL policy for web_gateway_extract — block non-http(s) and non-public targets.
import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

export const MAX_URL_LENGTH = 2048
export const MAX_REDIRECTS = 5

export class UrlPolicyError extends Error {
  constructor(message, code = 'WEB_GATEWAY_BLOCKED_URL') {
    super(message)
    this.name = 'UrlPolicyError'
    this.code = code
  }
}

function stripBrackets(host) {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

/** Classify an IPv4/IPv6 textual address as public unicast. */
export function isPublicIpAddress(input) {
  const host = stripBrackets(String(input || ''))
  const family = isIP(host)
  if (family === 4) return isPublicIpv4(host)
  if (family === 6) return isPublicIpv6(host)
  return false
}

function isPublicIpv4(host) {
  const parts = host.split('.').map((p) => Number(p))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = parts
  if (a === 0) return false // "this" network
  if (a === 10) return false // RFC1918
  if (a === 127) return false // loopback
  if (a === 169 && b === 254) return false // link-local / metadata
  if (a === 172 && b >= 16 && b <= 31) return false // RFC1918
  if (a === 192 && b === 168) return false // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return false // CGNAT
  if (a >= 224) return false // multicast / reserved
  return true
}

function isPublicIpv6(host) {
  const h = host.toLowerCase()
  if (h === '::1') return false
  if (h.startsWith('fe80:')) return false // link-local
  if (h.startsWith('fc') || h.startsWith('fd')) return false // ULA
  // IPv4-mapped ::ffff:x.x.x.x
  const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPublicIpv4(mapped[1])
  // Reject unique-local and documentation ranges coarsely via leading bits
  if (h.startsWith('2001:db8:')) return false
  return true
}

export function parseExtractUrl(input) {
  const raw = String(input ?? '').trim()
  if (!raw) throw new UrlPolicyError('url is required', 'WEB_GATEWAY_INVALID_URL')
  if (raw.length > MAX_URL_LENGTH) {
    throw new UrlPolicyError(`URL exceeds the maximum length of ${MAX_URL_LENGTH}`, 'WEB_GATEWAY_INVALID_URL')
  }
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new UrlPolicyError(`invalid URL: ${raw}`, 'WEB_GATEWAY_INVALID_URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlPolicyError(`unsupported URL scheme "${url.protocol}" (only http and https are allowed)`, 'WEB_GATEWAY_INVALID_URL')
  }
  if (url.username || url.password) {
    throw new UrlPolicyError('credentials in URLs are not allowed', 'WEB_GATEWAY_BLOCKED_URL')
  }
  return url
}

/**
 * Resolve hostname and ensure every answer is a public IP unless allowInternal is set.
 * @param {string|URL} input
 * @param {{ allowInternal?: boolean, resolve?: Function, signal?: AbortSignal }} [opts]
 */
export async function assertExtractUrlAllowed(input, opts = {}) {
  const url = typeof input === 'string' || input instanceof URL ? (input instanceof URL ? input : parseExtractUrl(input)) : parseExtractUrl(String(input))
  if (opts.allowInternal) return url

  const hostname = stripBrackets(url.hostname)
  const literal = isIP(hostname)
  const resolve = opts.resolve || ((host) => lookup(host, { all: true, verbatim: true }))

  let addresses
  if (literal) {
    addresses = [{ address: hostname, family: literal }]
  } else {
    try {
      addresses = await resolve(hostname)
    } catch (err) {
      throw new UrlPolicyError(`DNS lookup failed for "${hostname}": ${err?.message || err}`, 'WEB_GATEWAY_DNS_FAILED')
    }
  }

  if (!addresses || addresses.length === 0) {
    throw new UrlPolicyError(`hostname "${hostname}" resolved to no addresses`, 'WEB_GATEWAY_DNS_FAILED')
  }

  for (const entry of addresses) {
    const addr = entry.address || entry
    if (!isPublicIpAddress(addr)) {
      throw new UrlPolicyError(`URL hostname "${hostname}" resolves to a non-public IP address`, 'WEB_GATEWAY_BLOCKED_URL')
    }
  }
  return url
}

export function assertSameOriginRedirect(fromUrl, locationHeader) {
  if (!locationHeader) throw new UrlPolicyError('redirect without Location header', 'WEB_GATEWAY_BLOCKED_URL')
  let next
  try {
    next = new URL(locationHeader, fromUrl)
  } catch {
    throw new UrlPolicyError('invalid redirect Location', 'WEB_GATEWAY_INVALID_URL')
  }
  if (next.protocol !== 'http:' && next.protocol !== 'https:') {
    throw new UrlPolicyError(`redirect to unsupported scheme "${next.protocol}"`, 'WEB_GATEWAY_BLOCKED_URL')
  }
  if (next.username || next.password) {
    throw new UrlPolicyError('credentials in redirect URLs are not allowed', 'WEB_GATEWAY_BLOCKED_URL')
  }
  const same = fromUrl.protocol === next.protocol && fromUrl.hostname === next.hostname && fromUrl.port === next.port
  if (!same) {
    throw new UrlPolicyError('cross-origin redirects are not allowed', 'WEB_GATEWAY_BLOCKED_URL')
  }
  return next
}
