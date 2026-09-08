import { describe, expect, it, vi } from "vitest";
import {
  bestTrainQuery,
  requestBestTrain,
  revalidateInBackground,
  type BestTrainParams,
  type RequestDeps,
} from "@/lib/requestBestTrain";

/**
 * The decision table for "someone is on a platform and the signal is bad".
 * Every path is exercised without a network, a browser or a clock.
 */

const PARAMS: BestTrainParams = {
  fromCode: "BVI",
  toCode: "CCG",
  classStartTime: "10:30",
  bufferMinutes: 20,
  journeyDay: "today",
};

const LIVE = { best: { trainNumber: "90270", departure: "09:17" } };
const SAVED = { best: { trainNumber: "90242", departure: "08:43" } };

type Payload = typeof LIVE;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** A dependency set with nothing cached, online, and a working server. */
function deps(overrides: Partial<RequestDeps<Payload>> = {}) {
  const store = new Map<string, { payload: Payload; fetchedAt: number }>();
  const base: RequestDeps<Payload> = {
    fetchImpl: vi.fn(async () => jsonResponse(LIVE)),
    isOnline: () => true,
    getCached: async (key) => store.get(key) ?? null,
    putCached: async (key, payload, fetchedAt) => {
      store.set(key, { payload, fetchedAt });
    },
    now: () => 1_700_000_000_000,
    journeyDate: () => "2026-09-08",
  };
  return { ...base, ...overrides, store };
}

describe("bestTrainQuery", () => {
  it("carries the whole question in the URL, so the edge can cache it", () => {
    const query = new URLSearchParams(bestTrainQuery(PARAMS));
    expect(Object.fromEntries(query)).toEqual({
      fromCode: "BVI",
      toCode: "CCG",
      classStartTime: "10:30",
      bufferMinutes: "20",
      journeyDay: "today",
    });
  });
});

describe("online, server answers", () => {
  it("returns the live answer", async () => {
    const outcome = await requestBestTrain<Payload>(PARAMS, deps());
    expect(outcome).toEqual({ status: "live", payload: LIVE });
  });

  it("saves it before returning, so losing signal a second later is survivable", async () => {
    const d = deps();
    await requestBestTrain<Payload>(PARAMS, d);

    expect(d.store.get("BVI:CCG:2026-09-08")).toEqual({
      payload: LIVE,
      fetchedAt: 1_700_000_000_000,
    });
  });
});

describe("offline", () => {
  it("answers from the store, labelled with when it was fetched", async () => {
    const d = deps({ isOnline: () => false });
    d.store.set("BVI:CCG:2026-09-08", { payload: SAVED, fetchedAt: 1_699_000_000_000 });

    const outcome = await requestBestTrain<Payload>(PARAMS, d);

    expect(outcome).toEqual({
      status: "cached",
      payload: SAVED,
      fetchedAt: 1_699_000_000_000,
    });
  });

  it("does not even attempt a request it knows cannot succeed", async () => {
    // The failure mode this prevents: a spinner spinning on a platform while
    // a doomed request works through its timeout.
    const d = deps({ isOnline: () => false });
    await requestBestTrain<Payload>(PARAMS, d);

    expect(d.fetchImpl).not.toHaveBeenCalled();
  });

  it("says so immediately when the route was never saved", async () => {
    const outcome = await requestBestTrain<Payload>(
      PARAMS,
      deps({ isOnline: () => false })
    );

    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") throw new Error("unreachable");
    expect(outcome.kind).toBe("OFFLINE");
    // The copy has to say what to do next, not just what broke.
    expect(outcome.message).toMatch(/offline/i);
    expect(outcome.message).toMatch(/search once/i);
  });
});

describe("the network lies", () => {
  it("falls back to the store when a fetch fails despite navigator.onLine", async () => {
    // Captive portal wifi, a dead tunnel, DNS failure: onLine says true and the
    // request still never completes. This path is why onLine is only a hint.
    const d = deps({
      fetchImpl: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });
    d.store.set("BVI:CCG:2026-09-08", { payload: SAVED, fetchedAt: 1_699_000_000_000 });

    const outcome = await requestBestTrain<Payload>(PARAMS, d);
    expect(outcome).toMatchObject({ status: "cached", payload: SAVED });
  });

  it("explains itself when the fetch fails and nothing is saved", async () => {
    const outcome = await requestBestTrain<Payload>(
      PARAMS,
      deps({
        fetchImpl: vi.fn(async () => {
          throw new TypeError("Failed to fetch");
        }),
      })
    );

    expect(outcome).toMatchObject({ status: "error", kind: "NETWORK" });
  });
});

describe("the server answers, but not with a train", () => {
  it("passes a 404 through rather than substituting a saved answer", async () => {
    // "No train reaches you in time for a 10:30 class" is an answer to *this*
    // question. Replacing it with yesterday's answer would be a lie.
    const d = deps({
      fetchImpl: vi.fn(async () =>
        jsonResponse({ error: "No train reaches Churchgate in time.", kind: "NO_TRAINS" }, 404)
      ),
    });
    d.store.set("BVI:CCG:2026-09-08", { payload: SAVED, fetchedAt: 1_699_000_000_000 });

    const outcome = await requestBestTrain<Payload>(PARAMS, d);

    expect(outcome).toEqual({
      status: "error",
      message: "No train reaches Churchgate in time.",
      kind: "NO_TRAINS",
    });
  });

  it("passes a 400 through for the same reason", async () => {
    const d = deps({
      fetchImpl: vi.fn(async () =>
        jsonResponse({ error: "That isn't a station.", kind: "INVALID_STATION" }, 400)
      ),
    });
    d.store.set("BVI:CCG:2026-09-08", { payload: SAVED, fetchedAt: 1_000 });

    expect(await requestBestTrain<Payload>(PARAMS, d)).toMatchObject({
      status: "error",
      kind: "INVALID_STATION",
    });
  });

  it("falls back to the store on a 5xx, which the user cannot act on", async () => {
    const d = deps({
      fetchImpl: vi.fn(async () =>
        jsonResponse({ error: "Something went wrong.", kind: "UNKNOWN" }, 502)
      ),
    });
    d.store.set("BVI:CCG:2026-09-08", { payload: SAVED, fetchedAt: 1_699_000_000_000 });

    expect(await requestBestTrain<Payload>(PARAMS, d)).toMatchObject({
      status: "cached",
      payload: SAVED,
    });
  });

  it("surfaces the 5xx when there is nothing to fall back to", async () => {
    const outcome = await requestBestTrain<Payload>(
      PARAMS,
      deps({
        fetchImpl: vi.fn(async () =>
          jsonResponse({ error: "Upstream is down.", kind: "UNKNOWN" }, 502)
        ),
      })
    );

    expect(outcome).toMatchObject({ status: "error", kind: "UNKNOWN" });
  });
});

describe("revalidateInBackground", () => {
  const STALE_AFTER = 15 * 60 * 1000;

  it("does nothing on a first visit, so it never costs a cold request", async () => {
    const d = deps();
    expect(await revalidateInBackground<Payload>(PARAMS, STALE_AFTER, d)).toBeNull();
    expect(d.fetchImpl).not.toHaveBeenCalled();
  });

  it("does nothing while the saved answer is still fresh", async () => {
    const d = deps();
    d.store.set("BVI:CCG:2026-09-08", {
      payload: SAVED,
      fetchedAt: 1_700_000_000_000 - 60_000,
    });

    expect(await revalidateInBackground<Payload>(PARAMS, STALE_AFTER, d)).toBeNull();
    // Opening the app five times before a train costs one request, not five.
    expect(d.fetchImpl).not.toHaveBeenCalled();
  });

  it("does nothing offline", async () => {
    const d = deps({ isOnline: () => false });
    d.store.set("BVI:CCG:2026-09-08", { payload: SAVED, fetchedAt: 1 });

    expect(await revalidateInBackground<Payload>(PARAMS, STALE_AFTER, d)).toBeNull();
    expect(d.fetchImpl).not.toHaveBeenCalled();
  });

  it("refreshes a stale answer and reports the change", async () => {
    const d = deps();
    d.store.set("BVI:CCG:2026-09-08", { payload: SAVED, fetchedAt: 1 });

    const fresh = await revalidateInBackground<Payload>(PARAMS, STALE_AFTER, d);

    expect(fresh).toEqual(LIVE);
    expect(d.store.get("BVI:CCG:2026-09-08")).toEqual({
      payload: LIVE,
      fetchedAt: 1_700_000_000_000,
    });
  });

  it("reports null when the timetable did not change, but still re-dates it", async () => {
    const d = deps();
    d.store.set("BVI:CCG:2026-09-08", { payload: LIVE, fetchedAt: 1 });

    // Nothing for the UI to do, but the saved copy is now known-current, which
    // is what makes it trustworthy when signal disappears.
    expect(await revalidateInBackground<Payload>(PARAMS, STALE_AFTER, d)).toBeNull();
    expect(d.store.get("BVI:CCG:2026-09-08")?.fetchedAt).toBe(1_700_000_000_000);
  });

  it("stays silent when the refresh fails", async () => {
    const d = deps({
      fetchImpl: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });
    d.store.set("BVI:CCG:2026-09-08", { payload: SAVED, fetchedAt: 1 });

    // A background nicety must never surface as an error.
    await expect(
      revalidateInBackground<Payload>(PARAMS, STALE_AFTER, d)
    ).resolves.toBeNull();
    expect(d.store.get("BVI:CCG:2026-09-08")?.payload).toEqual(SAVED);
  });
});
