import { describe, expect, it } from "vitest";
import { SlidingWindowRateLimiter, clientKey } from "@/lib/rateLimit";

const WINDOW = 60_000;

describe("SlidingWindowRateLimiter", () => {
  it("allows exactly the limit inside one window", () => {
    const limiter = new SlidingWindowRateLimiter(3, WINDOW);
    const now = Date.now();

    expect(limiter.check("ip", now).ok).toBe(true);
    expect(limiter.check("ip", now + 1).ok).toBe(true);
    expect(limiter.check("ip", now + 2).ok).toBe(true);
    expect(limiter.check("ip", now + 3).ok).toBe(false);
  });

  it("counts down the remaining allowance", () => {
    const limiter = new SlidingWindowRateLimiter(3, WINDOW);
    const now = Date.now();

    expect(limiter.check("ip", now).remaining).toBe(2);
    expect(limiter.check("ip", now + 1).remaining).toBe(1);
    expect(limiter.check("ip", now + 2).remaining).toBe(0);
  });

  it("slides: the oldest hit ages out and frees a slot", () => {
    const limiter = new SlidingWindowRateLimiter(2, WINDOW);
    const now = Date.now();

    limiter.check("ip", now);
    limiter.check("ip", now + 10_000);
    expect(limiter.check("ip", now + 20_000).ok).toBe(false);

    // Just past the first hit's window: one slot back, but not two.
    expect(limiter.check("ip", now + WINDOW + 1).ok).toBe(true);
    expect(limiter.check("ip", now + WINDOW + 2).ok).toBe(false);
  });

  it("reports how long to wait, rounded up to a whole second", () => {
    const limiter = new SlidingWindowRateLimiter(1, WINDOW);
    const now = Date.now();

    limiter.check("ip", now);
    const blocked = limiter.check("ip", now + 20_000);

    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(40);
  });

  it("never reports a zero wait while blocked", () => {
    const limiter = new SlidingWindowRateLimiter(1, WINDOW);
    const now = Date.now();

    limiter.check("ip", now);
    // A hair before the window closes: still blocked, so still >= 1s.
    expect(limiter.check("ip", now + WINDOW - 1).retryAfterSeconds).toBe(1);
  });

  it("keeps clients independent", () => {
    const limiter = new SlidingWindowRateLimiter(1, WINDOW);
    const now = Date.now();

    expect(limiter.check("a", now).ok).toBe(true);
    expect(limiter.check("b", now).ok).toBe(true);
    expect(limiter.check("a", now).ok).toBe(false);
  });

  it("caps how many clients it tracks", () => {
    const limiter = new SlidingWindowRateLimiter(1, WINDOW, 2);
    const now = Date.now();

    limiter.check("a", now);
    limiter.check("b", now);
    limiter.check("c", now);

    // "a" was evicted, so it gets a fresh allowance. The cap trades perfect
    // accounting for a bounded map, which is the right way round here.
    expect(limiter.check("a", now).ok).toBe(true);
    expect(limiter.check("c", now).ok).toBe(false);
  });
});

describe("clientKey", () => {
  it("takes the client from x-forwarded-for, ignoring proxy hops", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178",
    });
    expect(clientKey(headers)).toBe("203.0.113.7");
  });

  it("cannot be re-identified by appending to the header", () => {
    const a = clientKey(new Headers({ "x-forwarded-for": "203.0.113.7" }));
    const b = clientKey(
      new Headers({ "x-forwarded-for": "203.0.113.7, 8.8.8.8" })
    );
    expect(a).toBe(b);
  });

  it("falls back to x-real-ip, then to a shared bucket", () => {
    expect(clientKey(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe(
      "198.51.100.4"
    );
    expect(clientKey(new Headers())).toBe("unknown");
    expect(clientKey(new Headers({ "x-forwarded-for": "  " }))).toBe("unknown");
  });
});
