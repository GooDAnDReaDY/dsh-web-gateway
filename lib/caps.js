import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

function defaultProfileDir() {
  return process.env.DSH_PROFILE_DIR
    || resolve(homedir(), '.dsh', 'profiles', 'web')
}

export function defaultCapsPath() {
  return resolve(defaultProfileDir(), 'data', 'dsh-web-gateway', 'daily-caps.json')
}

function utcDay(now = new Date()) {
  return now.toISOString().slice(0, 10)
}

/**
 * Persistent per-provider daily call counters (UTC calendar day).
 * Cap 0 = unlimited.
 */
export function makeDailyCaps({ path = defaultCapsPath() } = {}) {
  mkdirSync(resolve(path, '..'), { recursive: true })

  function load() {
    try {
      if (!existsSync(path)) return { day: utcDay(), counts: {} }
      const raw = JSON.parse(readFileSync(path, 'utf8'))
      if (!raw || typeof raw !== 'object') return { day: utcDay(), counts: {} }
      if (raw.day !== utcDay()) return { day: utcDay(), counts: {} }
      return { day: raw.day, counts: raw.counts && typeof raw.counts === 'object' ? raw.counts : {} }
    } catch {
      return { day: utcDay(), counts: {} }
    }
  }

  function save(state) {
    const tmp = `${path}.${process.pid}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(state, null, 2))
      renameSync(tmp, path)
    } catch {
      try { writeFileSync(path, JSON.stringify(state)) } catch { /* ignore */ }
    }
  }

  return {
    path,
    snapshot(capConfig = {}) {
      const state = load()
      const out = {}
      for (const [provider, cap] of Object.entries(capConfig)) {
        const used = Number(state.counts[provider] || 0)
        out[provider] = { used, cap: Number(cap) || 0, remaining: Number(cap) > 0 ? Math.max(0, Number(cap) - used) : null }
      }
      return { day: state.day, providers: out }
    },
    /** @returns {{ ok: true } | { ok: false, reason: string }} */
    check(provider, cap) {
      const limit = Number(cap) || 0
      if (limit <= 0) return { ok: true }
      const state = load()
      const used = Number(state.counts[provider] || 0)
      if (used >= limit) {
        return { ok: false, reason: `daily cap reached (${used}/${limit} UTC ${state.day})` }
      }
      return { ok: true }
    },
    record(provider) {
      const state = load()
      state.counts[provider] = Number(state.counts[provider] || 0) + 1
      save(state)
      return state.counts[provider]
    },
  }
}

export function capsFromConfig(cfg) {
  return {
    tavily: Number(cfg.dailyCapTavily) || 0,
    firecrawl: Number(cfg.dailyCapFirecrawl) || 0,
    exa: Number(cfg.dailyCapExa) || 0,
    searxng: Number(cfg.dailyCapSearxng) || 0,
    crawl4ai: Number(cfg.dailyCapCrawl4ai) || 0,
    jina: Number(cfg.dailyCapJina) || 0,
    readability: Number(cfg.dailyCapReadability) || 0,
  }
}
