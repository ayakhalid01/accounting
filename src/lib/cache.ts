// Lightweight localStorage cache used by client components
type CacheEntry<T> = {
  data: T;
  ts: number; // epoch ms
  ttlMs: number;
};

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function setCache<T = any>(key: string, data: T, ttlMs = DEFAULT_TTL_MS) {
  try {
    const entry: CacheEntry<T> = { data, ts: Date.now(), ttlMs };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch (err) {
    // ignore localStorage issues (private mode etc.)
    console.warn('setCache failed', err);
  }
}

export function getCache<T = any>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (!entry || !entry.ts) return null;
    if (Date.now() - entry.ts > (entry.ttlMs || DEFAULT_TTL_MS)) {
      // expired
      localStorage.removeItem(key);
      return null;
    }
    return entry.data;
  } catch (err) {
    console.warn('getCache failed', err);
    return null;
  }
}

export function clearCache(key: string) {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    console.warn('clearCache failed', err);
  }
}
