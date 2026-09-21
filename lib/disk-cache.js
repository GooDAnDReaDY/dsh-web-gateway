import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, resolve } from 'node:path'

function defaultProfileDir() {
  return process.env.DSH_PROFILE_DIR
    || resolve(homedir(), '.dsh', 'profiles', 'web')
}

export function defaultCacheDir() {
  return resolve(defaultProfileDir(), 'data', 'dsh-web-gateway', 'cache')
}

function hashKey(key) {
  return createHash('sha256').update(String(key)).digest('hex')
}

/**
 * Disk-backed TTL cache with soft max entry count.
 * Survives process restarts. Not shared across hosts.
 */
export function makeDiskCache({ ttlMs = 600000, maxEntries = 500, dir = defaultCacheDir() } = {}) {
  if (ttlMs <= 0) {
    return {
      get() { return undefined },
      set() {},
      clear() {},
      size() { return 0 },
      dir,
    }
  }

  mkdirSync(dir, { recursive: true })

  function pathFor(key) {
    return resolve(dir, `${hashKey(key)}.json`)
  }

  function pruneIfNeeded() {
    let entries
    try {
      entries = readdirSync(dir).filter((f) => f.endsWith('.json'))
    } catch {
      return
    }
    if (entries.length <= maxEntries) return
    const ranked = entries.map((f) => {
      const p = resolve(dir, f)
      try {
        return { p, mtime: statSync(p).mtimeMs }
      } catch {
        return { p, mtime: 0 }
      }
    }).sort((a, b) => a.mtime - b.mtime)
    const drop = ranked.slice(0, Math.max(0, ranked.length - maxEntries))
    for (const item of drop) {
      try { unlinkSync(item.p) } catch { /* ignore */ }
    }
  }

  return {
    dir,
    get(key) {
      const p = pathFor(key)
      if (!existsSync(p)) return undefined
      try {
        const raw = JSON.parse(readFileSync(p, 'utf8'))
        if (!raw || typeof raw.ts !== 'number') {
          unlinkSync(p)
          return undefined
        }
        if (Date.now() - raw.ts > ttlMs) {
          unlinkSync(p)
          return undefined
        }
        return raw.value
      } catch {
        try { unlinkSync(p) } catch { /* ignore */ }
        return undefined
      }
    },
    set(key, value) {
      const p = pathFor(key)
      const tmp = `${p}.${process.pid}.tmp`
      const payload = JSON.stringify({ ts: Date.now(), value })
      try {
        writeFileSync(tmp, payload)
        renameSync(tmp, p)
        pruneIfNeeded()
      } catch {
        try { unlinkSync(tmp) } catch { /* ignore */ }
      }
    },
    clear() {
      try {
        for (const f of readdirSync(dir)) {
          if (f.endsWith('.json')) unlinkSync(resolve(dir, f))
        }
      } catch { /* ignore */ }
    },
    size() {
      try {
        return readdirSync(dir).filter((f) => f.endsWith('.json')).length
      } catch {
        return 0
      }
    },
  }
}

/**
 * Two-level cache: memory L1 + disk L2.
 */
export function makeLayeredCache({ memory, disk }) {
  return {
    get(key) {
      const m = memory.get(key)
      if (m !== undefined) return m
      const d = disk.get(key)
      if (d !== undefined) {
        memory.set(key, d)
        return d
      }
      return undefined
    },
    set(key, value) {
      memory.set(key, value)
      disk.set(key, value)
    },
    clear() {
      memory.clear()
      disk.clear()
    },
  }
}
