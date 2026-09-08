import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RailRadarError,
  clearTrainsBetweenCache,
  getTrainsBetween,
} from "@/lib/railradar";
import { recordCall, resetUsage } from "@/lib/quota";

/**
 * These tests are the quota argument in executable form: they assert how many
 * times the app is willing to touch RailRadar for a given sequence of user
 * actions. If one starts failing, the monthly bill has changed.
 */

const TIMETABLE = {
  from: { code: "BVI", name: "Borivali" },
  to: { code: "CCG", name: "Churchgate" },
  count: 1,
  trains: [
    {
      train: { number: "90270", name: "Local", type: "EMU", runDays: ["tue"] },
      from: {
        code: "BVI",
        name: "Borivali",
        city: "Mumbai",
        departure: "09:17",
        day: 1,
        sequence: 1,
      },
      to: {
        code: "CCG",
        name: "Churchgate",
        city: "Mumbai",
        arrival: "10:08",
        day: 1,
        sequence: 2,
      },
      distance: 34,
      duration: 51,
      totalHaltsBetween: 12,
    },
  ],
};

function okResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: TIMETABLE }),
  } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.RAILRADAR_API_KEY = "test-key";
  clearTrainsBetweenCache();
  resetUsage();
  vi.spyOn(console, "log").mockImplementation(() => {});
  fetchMock = vi.fn(async () => okResponse());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearTrainsBetweenCache();
  resetUsage();
});

describe("getTrainsBetween — what it costs", () => {
  it("spends one upstream call and serves the rest from cache", async () => {
    const first = await getTrainsBetween("BVI", "CCG", "2026-09-08");
    const second = await getTrainsBetween("BVI", "CCG", "2026-09-08");
    const third = await getTrainsBetween("BVI", "CCG", "2026-09-08");

    // This is the acceptance criterion: submit, tweak the buffer, submit again.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.source).toBe("upstream");
    expect(second.source).toBe("cache");
    expect(third.source).toBe("cache");
    expect(second.result).toEqual(first.result);
  });

  it("ignores the case of the station codes when caching", async () => {
    await getTrainsBetween("bvi", "ccg", "2026-09-08");
    await getTrainsBetween("BVI", "CCG", "2026-09-08");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not reuse one day's timetable for another", async () => {
    // runDays filtering happens downstream, so a Tuesday answer must not be
    // handed to a Wednesday question.
    await getTrainsBetween("BVI", "CCG", "2026-09-08");
    await getTrainsBetween("BVI", "CCG", "2026-09-09");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not reuse one station pair's timetable for another", async () => {
    await getTrainsBetween("BVI", "CCG", "2026-09-08");
    await getTrainsBetween("ADH", "CCG", "2026-09-08");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("collapses a concurrent burst into a single call", async () => {
    // The morning rush: everyone on the same line opening the app at once.
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        getTrainsBetween("BVI", "CCG", "2026-09-08")
      )
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(20);
    for (const r of results) expect(r.result.trains).toHaveLength(1);
  });
});

describe("getTrainsBetween — degrading instead of failing", () => {
  it("serves the stale timetable with a timestamp when upstream dies", async () => {
    const warm = await getTrainsBetween("BVI", "CCG", "2026-09-08");
    expect(warm.stale).toBe(false);

    // Age the entry past its 6h TTL, then break the upstream.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 7 * 60 * 60 * 1000);
    fetchMock.mockRejectedValue(new Error("network down"));

    const degraded = await getTrainsBetween("BVI", "CCG", "2026-09-08");

    expect(degraded.stale).toBe(true);
    expect(degraded.source).toBe("stale-cache");
    expect(degraded.result).toEqual(warm.result);
    // The "as of" the user is shown is when the data was really fetched.
    expect(degraded.fetchedAt).toBe(warm.fetchedAt);

    vi.useRealTimers();
  });

  it("still fails when there is nothing stale to fall back to", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    await expect(getTrainsBetween("BVI", "CCG", "2026-09-08")).rejects.toBeInstanceOf(
      RailRadarError
    );
  });

  it("prefers a stale answer over a fresh call once the month is nearly spent", async () => {
    await getTrainsBetween("BVI", "CCG", "2026-09-08");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Push this instance past the conservation threshold.
    for (let i = 0; i < 900; i++) recordCall("trains/between", "upstream");

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 7 * 60 * 60 * 1000);

    const conserved = await getTrainsBetween("BVI", "CCG", "2026-09-08");

    // No second call, even though the entry is past its TTL: a slightly old
    // timetable beats spending one of the last requests of the month.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(conserved.stale).toBe(true);
    expect(conserved.source).toBe("stale-cache");

    vi.useRealTimers();
  });

  it("surfaces RailRadar's own rate limit as RATE_LIMIT", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    } as Response);

    await expect(
      getTrainsBetween("BVI", "CCG", "2026-09-08")
    ).rejects.toMatchObject({ kind: "RATE_LIMIT" });
  });
});
