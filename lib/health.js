// Health snapshot for credentials and optional local endpoints (no secret values).

import { resolveApiKey } from './providers.js'

async function credentialStatus(ctx, ref) {
  const name = String(ref || '').trim()
  if (!name) return { name: '', status: 'missing' }
  const value = await resolveApiKey(ctx, name)
  return { name, status: value ? 'present' : 'missing' }
}

async function pingUrl(url, fetchImpl, signal) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    })
    return { status: res.ok || (res.status >= 300 && res.status < 500) ? 'ok' : 'error', httpStatus: res.status }
  } catch (err) {
    return { status: 'error', reason: String(err?.message || err).slice(0, 120) }
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

/**
 * Build a health snapshot for the settings card.
 */
export async function buildHealthSnapshot(ctx, cfg, fetchImpl = fetch, signal) {
  const credentials = {
    tavily: await credentialStatus(ctx, cfg.tavilyApiKeyEnv),
    firecrawl: await credentialStatus(ctx, cfg.firecrawlApiKeyEnv),
    exa: await credentialStatus(ctx, cfg.exaApiKeyEnv),
    crawl4ai: await credentialStatus(ctx, cfg.crawl4aiTokenEnv),
  }
  if (cfg.braveApiKeyEnv) {
    credentials.brave = await credentialStatus(ctx, cfg.braveApiKeyEnv)
  }

  let searxng = { status: 'skipped', reason: 'not configured' }
  if (cfg.searxngUrl) {
    const base = String(cfg.searxngUrl).replace(/\/$/, '')
    searxng = await pingUrl(`${base}/`, fetchImpl, signal)
  }

  let crawl4ai = { status: 'skipped', reason: 'not configured' }
  if (cfg.crawl4aiUrl) {
    const base = String(cfg.crawl4aiUrl).replace(/\/$/, '')
    crawl4ai = await pingUrl(`${base}/`, fetchImpl, signal)
  }

  return { credentials, endpoints: { searxng, crawl4ai } }
}
