/**
 * Bounded in-process cache + in-flight dedup for public media-provider search.
 *
 * Scope: read-only third-party catalog search only. Never used for auth
 * tokens, user-scoped reads, or mutations. Fetch-level `cache: "no-store"`
 * stays as-is (opts out of Next's fetch cache); this layer adds a short TTL
 * so repeated identical searches (keystrokes, retries, navigation) and
 * concurrent identical in-flight searches share one network call.
 */

const DEFAULT_TTL_MS = 60_000;
const MAX_ENTRIES = 200;

type CacheEntry = { expiresAt: number; value: unknown };

const store = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<unknown>>();

export function normalizeSearchKey(
  provider: string,
  query: string,
  extra = "",
): string {
  return `${provider}|${query.trim().toLowerCase()}|${extra}`;
}

/** Test/ops escape hatch — clears stored values and in-flight waiters. */
export function clearSearchCache(): void {
  store.clear();
  pending.clear();
}

function evictOldest(): void {
  const oldest = store.keys().next().value;
  if (oldest !== undefined) store.delete(oldest);
}

export async function cachedSearch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS,
): Promise<T> {
  const hit = store.get(key);
  if (hit) {
    if (hit.expiresAt > Date.now()) return hit.value as T;
    store.delete(key);
  }

  const flight = pending.get(key);
  if (flight) return flight as Promise<T>;

  const run = fetcher().then(
    (value) => {
      if (!store.has(key) && store.size >= MAX_ENTRIES) evictOldest();
      store.set(key, { expiresAt: Date.now() + ttlMs, value });
      pending.delete(key);
      return value;
    },
    (err) => {
      pending.delete(key);
      throw err;
    },
  );
  pending.set(key, run);
  return run;
}
