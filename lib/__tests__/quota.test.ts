import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEGRADE_ABOVE,
  MONTHLY_QUOTA,
  monthlyUpstreamTotal,
  recordCall,
  resetUsage,
  shouldConserveQuota,
  usageReport,
} from "@/lib/quota";

beforeEach(() => {
  resetUsage();
  // The counters log every call; keep the test output readable.
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetUsage();
});

describe("recordCall", () => {
  it("counts an upstream call against the month", () => {
    recordCall("trains/between", "upstream");
    recordCall("trains/between", "upstream");

    expect(monthlyUpstreamTotal()).toBe(2);
  });

  it("does not count a cache hit — that is the whole point", () => {
    recordCall("trains/between", "upstream");
    recordCall("trains/between", "cache");
    recordCall("trains/between", "cache");

    expect(monthlyUpstreamTotal()).toBe(1);

    const [today] = usageReport().days;
    expect(today.byEndpoint["trains/between"]).toEqual({
      upstream: 1,
      cacheHits: 2,
      errors: 0,
    });
  });

  it("counts a failed call as spent, because it was", () => {
    recordCall("trains/between", "error");

    expect(monthlyUpstreamTotal()).toBe(1);
    expect(usageReport().days[0].byEndpoint["trains/between"].errors).toBe(1);
  });

  it("keeps endpoints apart", () => {
    recordCall("trains/between", "upstream");
    recordCall("lookup/search/stations", "upstream");
    recordCall("lookup/search/stations", "upstream");

    const { byEndpoint } = usageReport().days[0];
    expect(byEndpoint["trains/between"].upstream).toBe(1);
    expect(byEndpoint["lookup/search/stations"].upstream).toBe(2);
    expect(monthlyUpstreamTotal()).toBe(3);
  });

  it("logs every call with its cache-hit status", () => {
    const log = vi.mocked(console.log);

    recordCall("trains/between", "upstream", "BVI:CCG:2026-09-08");
    recordCall("trains/between", "cache", "BVI:CCG:2026-09-08");

    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][0]).toContain("UPSTREAM");
    expect(log.mock.calls[0][0]).toContain("BVI:CCG:2026-09-08");
    expect(log.mock.calls[1][0]).toContain("CACHE");
  });
});

describe("day and month rollover", () => {
  it("buckets by the Mumbai date, not the UTC one", () => {
    // 18:35Z is already the next day in Mumbai (00:05 IST).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T18:00:00Z")); // 8 Sep, 23:30 IST
    recordCall("trains/between", "upstream");

    vi.setSystemTime(new Date("2026-09-08T18:35:00Z")); // 9 Sep, 00:05 IST
    recordCall("trains/between", "upstream");

    const dates = usageReport().days.map((d) => d.date);
    expect(dates).toEqual(["2026-09-08", "2026-09-09"]);
  });

  it("forgets last month, because the quota resets", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T06:00:00Z"));
    recordCall("trains/between", "upstream");
    expect(monthlyUpstreamTotal()).toBe(1);

    vi.setSystemTime(new Date("2026-10-01T06:00:00Z"));
    recordCall("trains/between", "upstream");

    expect(monthlyUpstreamTotal()).toBe(1);
    expect(usageReport().days.map((d) => d.date)).toEqual(["2026-10-01"]);
  });
});

describe("shouldConserveQuota", () => {
  const threshold = Math.ceil(MONTHLY_QUOTA * DEGRADE_ABOVE);

  it("stays off well inside the budget", () => {
    for (let i = 0; i < threshold - 1; i++) recordCall("trains/between", "upstream");
    expect(shouldConserveQuota()).toBe(false);
  });

  it("turns on at the threshold", () => {
    for (let i = 0; i < threshold; i++) recordCall("trains/between", "upstream");
    expect(shouldConserveQuota()).toBe(true);
    expect(usageReport().conserving).toBe(true);
  });

  it("leaves real headroom rather than waiting for exhaustion", () => {
    // Degrading only at 100% would mean the first user past the line gets an
    // error instead of a slightly old timetable.
    expect(MONTHLY_QUOTA - threshold).toBeGreaterThanOrEqual(100);
  });
});
