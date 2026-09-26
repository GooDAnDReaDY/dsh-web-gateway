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

function parseIpv6Words(host) {
  let str = host.toLowerCase()
  const lastColon = str.lastIndexOf(':')
  if (lastColon !== -1) {
    const tail = str.slice(lastColon + 1)
    if (tail.includes('.')) {
      const parts = tail.split('.').map(Number)
      if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
        const h1 = (((parts[0] << 8) | parts[1]) >>> 0).toString(16)
        const h2 = (((parts[2] << 8) | parts[3]) >>> 0).toString(16)
        str = str.slice(0, lastColon + 1) + h1 + ':' + h2
      } else {
        return null
      }
    }
  }

  const doubleColon = str.indexOf('::')
  let words = []
  if (doubleColon !== -1) {
    if (str.indexOf('::', doubleColon + 2) !== -1) return null
    const left = str.slice(0, doubleColon).split(':').filter(Boolean)
    const right = str.slice(doubleColon + 2).split(':').filter(Boolean)
    const missing = 8 - (left.length + right.length)
    if (missing < 1) return null
    const middle = new Array(missing).fill('0')
    words = [...left, ...middle, ...right]
  } else {
    words = str.split(':')
  }

  if (words.length !== 8) return null
  const parsed = []
  for (const w of words) {
    if (!/^[0-9a-f]{1,4}$/.test(w)) return null
    parsed.push(parseInt(w, 16))
  }
  return parsed
}

function isPublicIpv6(host) {
  const words = parseIpv6Words(host)
  if (!words) return false

  // Unspecified ::/128
  if (words.every((w) => w === 0)) return false

  // Loopback ::1/128
  if (words.slice(0, 7).every((w) => w === 0) && words[7] === 1) return false

  // IPv4-mapped IPv6 ::ffff:0:0/96 or deprecated IPv4-compatible ::0:0/96
  if (
    (words.slice(0, 5).every((w) => w === 0) && words[5] === 0xffff) ||
    (words.slice(0, 6).every((w) => w === 0) && (words[6] !== 0 || words[7] !== 0))
  ) {
    const b0 = (words[6] >> 8) & 0xff
    const b1 = words[6] & 0xff
    const b2 = (words[7] >> 8) & 0xff
    const b3 = words[7] & 0xff
    return isPublicIpv4(`${b0}.${b1}.${b2}.${b3}`)
  }

  // 64:ff9b::/96 (Well-Known Prefix for IPv4/IPv6 translation, RFC 6052)
  if (words[0] === 0x0064 && words[1] === 0xff9b && words.slice(2, 6).every((w) => w === 0)) {
    const b0 = (words[6] >> 8) & 0xff
    const b1 = words[6] & 0xff
    const b2 = (words[7] >> 8) & 0xff
    const b3 = words[7] & 0xff
    return isPublicIpv4(`${b0}.${b1}.${b2}.${b3}`)
  }

  // 6to4 2002::/16 (RFC 3056): embedded IPv4 in words 1 and 2
  if (words[0] === 0x2002) {
    const b0 = (words[1] >> 8) & 0xff
    const b1 = words[1] & 0xff
    const b2 = (words[2] >> 8) & 0xff
    const b3 = words[2] & 0xff
    if (!isPublicIpv4(`${b0}.${b1}.${b2}.${b3}`)) return false
  }

  // Multicast ff00::/8
  if ((words[0] & 0xff00) === 0xff00) return false

  // Link-local unicast fe80::/10 (fe80:: - febf::)
  if ((words[0] & 0xffc0) === 0xfe80) return false

  // Unique local address (ULA) fc00::/7 (fc00:: - fdff::)
  if ((words[0] & 0xfe00) === 0xfc00) return false

  // Documentation 2001:db8::/32
  if (words[0] === 0x2001 && words[1] === 0x0db8) return false

  // Discard prefix 100::/64 (RFC 6666)
  if (words[0] === 0x0100 && words[1] === 0 && words[2] === 0 && words[3] === 0) return false

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
