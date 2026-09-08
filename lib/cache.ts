/**
 * A tiny TTL cache with request coalescing.
 *
 * ## Which layer is which
 *
 * There are two caches in front of RailRadar, and it matters which one you are
 * reasoning about:
 *
 * 1. **This one — in-memory, per lambda instance.** It lives in module state,
 *    so it is empty on a cold start and is *not* shared between concurrent
 *    instances. Its real job is collapsing the burst: one student submitting
 *    the form twice, or twenty students hitting the same warm instance within
 *    six hours. It is a nice-to-have.
 *
 * 2. **The edge cache — shared, in front of the route.** Set by the
 *    `Cache-Control: public, s-maxage=..., stale-while-revalidate=...` header
 *    on `/api/best-train`. *This is the layer that carries production load.*
 *    Two students on the same line, on different instances, in different
 *    cities, share one upstream call because the CDN answers the second one.
 *
 * If you are optimising quota, optimise the edge layer. This module exists to
 * make the in-instance case correct and to give the stale-serving path
 * something to read from when the quota runs low.
 */

export interface CacheEntry<T> {
  value: T;
  /** Epoch ms when this value was fetched. Surfaced to users as "as of". */
  storedAt: number;
  /** Epoch ms after which the value is stale. */
  expiresAt: number;
}

export interface CacheLookup<T> {
  entry: CacheEntry<T>;
  /** False when the entry is past its TTL but still being offered. */
  fresh: boolean;
}

export class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly ttlMs: number,
    /**
     * Stale entries are kept this much longer than the TTL so they can still be
     * served when the upstream is unreachable or the monthly quota is nearly
     * spent. A day-old local timetable is far more useful than an error page.
     */
    private readonly staleMs: number,
    private readonly maxEntries = 200
  ) {}

  /** A fresh entry, or undefined. */
  get(key: string): CacheEntry<T> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) return undefined;
    return entry;
  }

  /** Any entry still inside the stale window, fresh or not. */
  getAllowingStale(key: string, now = Date.now()): CacheLookup<T> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (now > entry.expiresAt + this.staleMs) {
      this.entries.delete(key);
      return undefined;
    }
    return { entry, fresh: now < entry.expiresAt };
  }

  set(key: string, value: T, now = Date.now()): CacheEntry<T> {
    const entry: CacheEntry<T> = {
      value,
      storedAt: now,
      expiresAt: now + this.ttlMs,
    };
    // Refresh insertion order so the cheapest eviction (oldest key first) drops
    // the least recently written entry rather than a hot one.
    this.entries.delete(key);
    this.entries.set(key, entry);

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    return entry;
  }

  /**
   * Runs `load` for `key`, but only once at a time: N concurrent callers asking
   * the same question produce one upstream call and all receive its answer.
   * Without this, the morning rush — everyone opening the app between 08:00 and
   * 08:15 on the same line — would multiply straight through to RailRadar.
   */
  async coalesce<R>(key: string, load: () => Promise<R>): Promise<R> {
    const existing = this.inFlight.get(key) as Promise<R> | undefined;
    if (existing) return existing;

    const promise = load().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  /** True when a load for this key is already running. Used for logging. */
  isInFlight(key: string): boolean {
    return this.inFlight.has(key);
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
