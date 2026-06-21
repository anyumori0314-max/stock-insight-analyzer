/**
 * Bounded, LRU, in-memory time-to-live cache.
 *
 * Phase 2 uses this to memoize analyzed stock reports so repeated requests for
 * the same ticker do not each consume one of the provider's scarce free-tier
 * calls.
 *
 * Eviction policy — **LRU** (least-recently-used): when the cache is full we
 * first drop any already-expired entry, and otherwise evict the
 * least-recently-accessed one. Rationale: a dashboard exhibits temporal
 * locality — the active ticker and the FANG+ presets are read repeatedly and
 * should stay warm, whereas a one-off lookup should fall out first. FIFO would
 * instead evict a still-hot entry merely because it was inserted earliest, so
 * LRU better matches the access pattern. A JS `Map` preserves insertion order,
 * so "touch on read" (delete + re-insert) keeps the most-recently-used entries
 * at the tail and the LRU victim at the head.
 *
 * The cache only ever stores the normalized report value handed to `set`; it
 * never holds API keys or raw provider responses.
 */

interface CacheEntry<T> {
  value: T;
  /** Epoch ms after which the entry is considered stale. */
  expiresAt: number;
}

export interface TtlCacheOptions {
  /** Entry lifetime in milliseconds. */
  ttlMs: number;
  /** Hard cap on stored entries (> 0). */
  maxEntries: number;
  /** Injectable clock (tests). Defaults to `Date.now`. */
  now?: () => number;
}

export interface TtlCache<T> {
  /** Returns the value (and marks it most-recently-used) or `undefined`. */
  get(key: string): T | undefined;
  /** Like `get` but also returns the entry's absolute expiry (epoch ms). */
  getWithMeta(key: string): { value: T; expiresAt: number } | undefined;
  /** Stores a value and returns its absolute expiry (epoch ms). */
  set(key: string, value: T): number;
  has(key: string): boolean;
  delete(key: string): void;
  clear(): void;
  /** Keys in LRU order: index 0 is the next eviction victim (least recent). */
  keys(): string[];
  readonly size: number;
}

export function createTtlCache<T>(options: TtlCacheOptions): TtlCache<T> {
  const { ttlMs } = options;
  const maxEntries = Math.max(1, Math.floor(options.maxEntries));
  const now = options.now ?? Date.now;
  const store = new Map<string, CacheEntry<T>>();

  function isExpired(entry: CacheEntry<T>): boolean {
    return entry.expiresAt <= now();
  }

  /** Removes one entry to make room: an expired one if any, else the LRU head. */
  function evictOne(): void {
    for (const [key, entry] of store) {
      if (isExpired(entry)) {
        store.delete(key);
        return;
      }
    }
    const oldest = store.keys().next().value;
    if (oldest !== undefined) {
      store.delete(oldest);
    }
  }

  function readFresh(key: string): CacheEntry<T> | undefined {
    const entry = store.get(key);
    if (!entry) {
      return undefined;
    }
    if (isExpired(entry)) {
      store.delete(key);
      return undefined;
    }
    // Touch: move to the tail (most-recently-used) without changing expiry.
    store.delete(key);
    store.set(key, entry);
    return entry;
  }

  return {
    get(key) {
      return readFresh(key)?.value;
    },
    getWithMeta(key) {
      const entry = readFresh(key);
      return entry ? { value: entry.value, expiresAt: entry.expiresAt } : undefined;
    },
    set(key, value) {
      // Re-inserting moves the key to the tail; remove first so capacity logic
      // and ordering are consistent.
      store.delete(key);
      while (store.size >= maxEntries) {
        evictOne();
      }
      const expiresAt = now() + ttlMs;
      store.set(key, { value, expiresAt });
      return expiresAt;
    },
    has(key) {
      return readFresh(key) !== undefined;
    },
    delete(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    keys() {
      return [...store.keys()];
    },
    get size() {
      return store.size;
    },
  };
}
