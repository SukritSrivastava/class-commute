import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import {
  MAX_AGE_MS,
  clearRoutes,
  evictExpired,
  getRoute,
  putRoute,
  routeKey,
} from "@/lib/offlineCache";

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  // A fresh database per test: these all share one origin otherwise.
  globalThis.indexedDB = new IDBFactory();
});

afterEach(async () => {
  await clearRoutes();
});

describe("routeKey", () => {
  it("is the same shape the server keys its cache on", () => {
    expect(routeKey("BVI", "CCG", "2026-09-08")).toBe("BVI:CCG:2026-09-08");
  });

  it("normalises case and whitespace, so one route is one entry", () => {
    expect(routeKey(" bvi ", "ccg", "2026-09-08")).toBe(
      routeKey("BVI", "CCG", "2026-09-08")
    );
  });

  it("keeps the two directions apart", () => {
    expect(routeKey("BVI", "CCG", "2026-09-08")).not.toBe(
      routeKey("CCG", "BVI", "2026-09-08")
    );
  });

  it("keeps two dates apart", () => {
    // A Tuesday answer must never be handed back for a Wednesday question.
    expect(routeKey("BVI", "CCG", "2026-09-08")).not.toBe(
      routeKey("BVI", "CCG", "2026-09-09")
    );
  });
});

describe("storing and reading back", () => {
  it("round-trips a payload with the moment it was fetched", async () => {
    const at = Date.now();
    await putRoute("BVI:CCG:2026-09-08", { best: { trainNumber: "90270" } }, at);

    const entry = await getRoute<{ best: { trainNumber: string } }>(
      "BVI:CCG:2026-09-08"
    );
    expect(entry?.payload.best.trainNumber).toBe("90270");
    // This timestamp is the whole basis of the "as of" label the user sees.
    expect(entry?.fetchedAt).toBe(at);
  });

  it("returns null for a route never asked about", async () => {
    expect(await getRoute("ADH:CCG:2026-09-08")).toBeNull();
  });

  it("overwrites rather than accumulating", async () => {
    const now = Date.now();
    await putRoute("k", { v: 1 }, now - 1000);
    await putRoute("k", { v: 2 }, now);

    const entry = await getRoute<{ v: number }>("k", now);
    expect(entry?.payload.v).toBe(2);
    expect(entry?.fetchedAt).toBe(now);
  });
});

describe("the seven-day bound", () => {
  it("hides an entry older than the limit rather than labelling it", async () => {
    const now = Date.now();
    await putRoute("old", { v: 1 }, now - MAX_AGE_MS - 1);

    // A timetable this old is not something to show under a reassuring
    // "as of" — it reads as current data and isn't.
    expect(await getRoute("old", now)).toBeNull();
  });

  it("still serves an entry just inside the limit", async () => {
    const now = Date.now();
    await putRoute("fresh", { v: 1 }, now - MAX_AGE_MS + 1000);

    expect(await getRoute("fresh", now)).not.toBeNull();
  });

  it("is seven days", () => {
    expect(MAX_AGE_MS).toBe(7 * DAY);
  });

  it("evicts only what has expired", async () => {
    const now = Date.now();
    await putRoute("stale-1", { v: 1 }, now - 8 * DAY);
    await putRoute("stale-2", { v: 2 }, now - 30 * DAY);
    await putRoute("keep", { v: 3 }, now - 2 * DAY);

    expect(await evictExpired(now)).toBe(2);

    expect(await getRoute("stale-1", now)).toBeNull();
    expect(await getRoute("stale-2", now)).toBeNull();
    expect(await getRoute("keep", now)).not.toBeNull();
  });

  it("is safe to run on an empty store", async () => {
    await expect(evictExpired()).resolves.toBe(0);
  });
});

describe("when IndexedDB is not available", () => {
  it("degrades to a cache miss rather than throwing", async () => {
    // Private windows, storage-blocked embedded webviews, some enterprise
    // policies. A missing cache means the app needs a network; a thrown error
    // means the app doesn't render.
    const real = globalThis.indexedDB;
    // @ts-expect-error deliberately removing the global for this test
    delete globalThis.indexedDB;

    await expect(putRoute("k", { v: 1 })).resolves.toBeUndefined();
    await expect(getRoute("k")).resolves.toBeNull();
    await expect(evictExpired()).resolves.toBe(0);
    await expect(clearRoutes()).resolves.toBeUndefined();

    globalThis.indexedDB = real;
  });
});
