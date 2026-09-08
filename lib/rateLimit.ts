/**
 * Per-IP sliding-window rate limiting for this app's own routes.
 *
 * The threat is mundane and cheap to mount: `/api/best-train` turns one
 * anonymous POST into one RailRadar request, and the free tier is 1,000 a
 * month. A single loop with `curl` drains the month in about a minute and the
 * app is dead for everyone until it resets. The caching in front of the route
 * blunts a *repeated* request, but varying the station pair defeats that, so
 * the limiter is what actually bounds the damage.
 *
 * An in-memory window is proportionate here: this is a free-tier student tool
 * with no auth and no database, and the alternative — a shared store — is more
 * moving parts than the thing it protects. The honest limitation is that the
 * window is per lambda instance, so a distributed caller spread across warm
 * instances gets a multiple of the limit. That still bounds the blast radius
 * to something the monthly quota survives, which is the goal.
 */

export interface RateLimitResult {
  ok: boolean;
  /** Requests still allowed in the current window. */
  remaining: number;
  /** Seconds until the window frees up. Only meaningful when `ok` is false. */
  retryAfterSeconds: number;
}

interface Window {
  /** Epoch ms of each request still inside the window, oldest first. */
  hits: number[];
}

export class SlidingWindowRateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    /** Cap on tracked clients, so a spray of spoofed IPs can't grow the map. */
    private readonly maxClients = 5_000
  ) {}

  check(key: string, now = Date.now()): RateLimitResult {
    const cutoff = now - this.windowMs;
    const window = this.windows.get(key) ?? { hits: [] };

    // Drop everything that has aged out of the window.
    while (window.hits.length > 0 && window.hits[0] <= cutoff) {
      window.hits.shift();
    }

    if (window.hits.length >= this.limit) {
      const oldest = window.hits[0];
      this.windows.set(key, window);
      return {
        ok: false,
        remaining: 0,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((oldest + this.windowMs - now) / 1000)
        ),
      };
    }

    window.hits.push(now);

    // Refresh insertion order so eviction drops the least recently seen client.
    this.windows.delete(key);
    this.windows.set(key, window);
    while (this.windows.size > this.maxClients) {
      const oldest = this.windows.keys().next();
      if (oldest.done) break;
      this.windows.delete(oldest.value);
    }

    return {
      ok: true,
      remaining: this.limit - window.hits.length,
      retryAfterSeconds: 0,
    };
  }

  clear(): void {
    this.windows.clear();
  }
}

/**
 * Identifies the caller. Vercel sets `x-forwarded-for` with the client first;
 * everything after it is proxy hops and must be ignored, or a caller could
 * spoof a new identity per request by appending to the header.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  // No identifying header at all (local development, or a proxy that strips
  // them). Everyone lands in one shared bucket, which fails closed: the limiter
  // gets stricter, never laxer, when it cannot tell callers apart.
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * `/api/best-train` is the expensive one: each miss can cost an upstream call.
 * 12 a minute is far above what the form can produce by hand (submit, tweak the
 * buffer, submit again) and far below what a script needs to be a problem.
 */
export const bestTrainLimiter = new SlidingWindowRateLimiter(12, 60_000);

/**
 * `/api/stations/search` is now only a fallback for a stale bundle, so it
 * should see almost no traffic. A low ceiling makes an unexpected flood
 * obvious instead of expensive.
 */
export const stationSearchLimiter = new SlidingWindowRateLimiter(20, 60_000);
