/** Simple in-memory TTL cache. */
export function makeCache(ttlMs) {
  const store = new Map()
  return {
    get(key) {
      const hit = store.get(key)
      if (!hit) return undefined
      if (Date.now() - hit.ts > ttlMs) {
        store.delete(key)
        return undefined
      }
      return hit.value
    },
    set(key, value) {
      if (ttlMs <= 0) return
      if (store.size > 512) store.clear()
      store.set(key, { ts: Date.now(), value })
    },
    clear() {
      store.clear()
    },
    size() {
      return store.size
    },
  }
}
