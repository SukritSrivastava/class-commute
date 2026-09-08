import { describe, expect, it, vi } from "vitest";
import { TtlCache } from "@/lib/cache";

const MINUTE = 60_000;

describe("TtlCache", () => {
  it("returns a value inside its TTL and drops it after", () => {
    const cache = new TtlCache<string>(10 * MINUTE, 0);
    const now = Date.now();

    cache.set("k", "v", now);
    expect(cache.get("k")?.value).toBe("v");

    vi.setSystemTime(now + 11 * MINUTE);
    expect(cache.get("k")).toBeUndefined();
    vi.useRealTimers();
  });

  it("records when a value was stored, for the 'as of' timestamp", () => {
    const cache = new TtlCache<string>(MINUTE, 0);
    const now = 1_700_000_000_000;

    const entry = cache.set("k", "v", now);
    expect(entry.storedAt).toBe(now);
    expect(entry.expiresAt).toBe(now + MINUTE);
  });

  it("keeps serving a stale value inside the stale window", () => {
    const cache = new TtlCache<string>(MINUTE, 10 * MINUTE);
    const now = Date.now();
    cache.set("k", "v", now);

    // Past the TTL but inside the stale window: available, flagged not fresh.
    const stale = cache.getAllowingStale("k", now + 5 * MINUTE);
    expect(stale?.entry.value).toBe("v");
    expect(stale?.fresh).toBe(false);

    // Still fresh a moment after writing.
    expect(cache.getAllowingStale("k", now + 1)?.fresh).toBe(true);
  });

  it("drops a value once even the stale window has passed", () => {
    const cache = new TtlCache<string>(MINUTE, MINUTE);
    const now = Date.now();
    cache.set("k", "v", now);

    expect(cache.getAllowingStale("k", now + 3 * MINUTE)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("evicts the least recently written entry past the cap", () => {
    const cache = new TtlCache<string>(MINUTE, 0, 2);

    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");

    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")?.value).toBe("2");
    expect(cache.get("c")?.value).toBe("3");
  });

  it("re-writing a key refreshes its eviction order", () => {
    const cache = new TtlCache<string>(MINUTE, 0, 2);

    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("a", "1 again");
    cache.set("c", "3");

    // "b" is now the oldest write, so it goes rather than "a".
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")?.value).toBe("1 again");
  });
});

describe("TtlCache.coalesce", () => {
  it("collapses concurrent loads of the same key into one call", async () => {
    const cache = new TtlCache<string>(MINUTE, 0);
    let calls = 0;
    const load = () => {
      calls++;
      return new Promise<string>((resolve) => setTimeout(() => resolve("v"), 5));
    };

    const results = await Promise.all([
      cache.coalesce("k", load),
      cache.coalesce("k", load),
      cache.coalesce("k", load),
    ]);

    expect(calls).toBe(1);
    expect(results).toEqual(["v", "v", "v"]);
  });

  it("keeps different keys independent", async () => {
    const cache = new TtlCache<string>(MINUTE, 0);
    let calls = 0;
    const load = (value: string) => async () => {
      calls++;
      return value;
    };

    const [a, b] = await Promise.all([
      cache.coalesce("a", load("1")),
      cache.coalesce("b", load("2")),
    ]);

    expect(calls).toBe(2);
    expect([a, b]).toEqual(["1", "2"]);
  });

  it("releases the key once the load settles, so the next caller retries", async () => {
    const cache = new TtlCache<string>(MINUTE, 0);
    let calls = 0;
    const load = async () => {
      calls++;
      return "v";
    };

    await cache.coalesce("k", load);
    expect(cache.isInFlight("k")).toBe(false);
    await cache.coalesce("k", load);

    expect(calls).toBe(2);
  });

  it("shares a rejection with every waiter and does not wedge the key", async () => {
    const cache = new TtlCache<string>(MINUTE, 0);
    let calls = 0;
    const failing = () => {
      calls++;
      return Promise.reject(new Error("upstream down"));
    };

    const results = await Promise.allSettled([
      cache.coalesce("k", failing),
      cache.coalesce("k", failing),
    ]);

    expect(calls).toBe(1);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(cache.isInFlight("k")).toBe(false);

    await expect(cache.coalesce("k", async () => "recovered")).resolves.toBe(
      "recovered"
    );
  });
});
