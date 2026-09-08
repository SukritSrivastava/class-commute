/**
 * Durable, labelled cache of answered routes, in IndexedDB.
 *
 * ## Why this exists on top of the service worker's cache
 *
 * The service worker already keeps a copy of `/api/best-train` responses, and
 * that copy is what makes a repeat request fast. It cannot do this job though:
 * a `Cache` entry is a `Response`, so the app can read it back but not easily
 * ask *when* it arrived, and there is nowhere to hang an eviction policy the
 * user's browser will honour. This store keeps the answer alongside the moment
 * it was fetched, which is the whole basis of the promise the UI makes —
 * stale data, honestly labelled, beats an error screen, but only if the label
 * is accurate.
 *
 * Everything here is best-effort. IndexedDB is unavailable in private windows
 * on some browsers, can be evicted under storage pressure, and throws in a few
 * embedded webviews. Every function resolves rather than rejects, because a
 * cache miss is a normal Tuesday and must never be the reason the app fails to
 * answer.
 */

const DB_NAME = "class-commute";
const DB_VERSION = 1;
const STORE = "best-train";

/** Entries older than this are dropped on the next open. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedRoute<T = unknown> {
  /** `FROM:TO:YYYY-MM-DD` — the same shape the server keys its cache on. */
  key: string;
  /** The `/api/best-train` response body, exactly as it arrived. */
  payload: T;
  /** Epoch ms when this answer was fetched. Shown to the user as "as of". */
  fetchedAt: number;
}

/** Builds the cache key. Case-normalised so `bvi` and `BVI` are one route. */
export function routeKey(
  fromCode: string,
  toCode: string,
  journeyDate: string
): string {
  return `${fromCode.trim().toUpperCase()}:${toCode.trim().toUpperCase()}:${journeyDate}`;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      // Some embedded webviews throw on open rather than returning an error.
      return resolve(null);
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        // Indexed so eviction is a range scan rather than a full read.
        store.createIndex("fetchedAt", "fetchedAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function promisify<T>(request: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

/** Stores an answer. Resolves either way; a failed write is not the app's problem. */
export async function putRoute<T>(
  key: string,
  payload: T,
  fetchedAt = Date.now()
): Promise<void> {
  const db = await openDb();
  if (!db) return;

  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ key, payload, fetchedAt } satisfies CachedRoute<T>);
    await new Promise((resolve) => {
      tx.oncomplete = resolve;
      tx.onerror = resolve;
      tx.onabort = resolve;
    });
  } catch {
    // Quota exceeded, or the store vanished mid-session. Nothing to do.
  } finally {
    db.close();
  }
}

/**
 * Reads an answer back, or null. An entry past `MAX_AGE_MS` is treated as
 * absent — a timetable that old is no longer something to show someone under a
 * reassuring "as of" label.
 */
export async function getRoute<T>(
  key: string,
  now = Date.now()
): Promise<CachedRoute<T> | null> {
  const db = await openDb();
  if (!db) return null;

  try {
    const tx = db.transaction(STORE, "readonly");
    const entry = (await promisify(
      tx.objectStore(STORE).get(key)
    )) as CachedRoute<T> | null;

    if (!entry) return null;
    if (now - entry.fetchedAt > MAX_AGE_MS) return null;
    return entry;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/**
 * Drops entries older than `MAX_AGE_MS`. Called once when the app opens rather
 * than on a timer: the store is small, and doing it on open means the bound is
 * enforced on exactly the devices that keep using the app.
 */
export async function evictExpired(now = Date.now()): Promise<number> {
  const db = await openDb();
  if (!db) return 0;

  try {
    const tx = db.transaction(STORE, "readwrite");
    const index = tx.objectStore(STORE).index("fetchedAt");
    const range = IDBKeyRange.upperBound(now - MAX_AGE_MS);

    let removed = 0;
    await new Promise<void>((resolve) => {
      const cursorRequest = index.openCursor(range);
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return resolve();
        cursor.delete();
        removed++;
        cursor.continue();
      };
      cursorRequest.onerror = () => resolve();
    });

    return removed;
  } catch {
    return 0;
  } finally {
    db.close();
  }
}

/** Test seam, and the honest way to answer "clear my data". */
export async function clearRoutes(): Promise<void> {
  const db = await openDb();
  if (!db) return;

  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    await new Promise((resolve) => {
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch {
    // Nothing to clear.
  } finally {
    db.close();
  }
}
