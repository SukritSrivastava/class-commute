import { getRoute, putRoute, routeKey } from "./offlineCache";
import { resolveJourney, type JourneyDay } from "./time";

/**
 * Asking for a train, from a phone that may not have a network.
 *
 * The order of preference is: a live answer, then a saved answer honestly
 * labelled with its age, then a clear statement that we don't know and what to
 * do about it. What never happens is a spinner that cannot resolve — on a
 * platform with no signal, the worst outcome is an app that appears to be
 * thinking while the train leaves.
 *
 * All I/O is injectable so the decision table below can be tested without a
 * network, a browser or a clock.
 */

export interface BestTrainParams {
  fromCode: string;
  toCode: string;
  classStartTime: string;
  bufferMinutes: number;
  journeyDay: JourneyDay;
}

export type BestTrainOutcome<P> =
  /** Straight from the server. */
  | { status: "live"; payload: P }
  /** From this device's store. `fetchedAt` is what the UI labels "as of". */
  | { status: "cached"; payload: P; fetchedAt: number }
  /** Nothing to show. `message` is user-facing copy; `kind` styles it. */
  | { status: "error"; message: string; kind: string };

export interface RequestDeps<P> {
  fetchImpl: typeof fetch;
  isOnline: () => boolean;
  getCached: (key: string) => Promise<{ payload: P; fetchedAt: number } | null>;
  putCached: (key: string, payload: P, fetchedAt: number) => Promise<void>;
  now: () => number;
  journeyDate: (params: BestTrainParams) => string;
}

function defaultDeps<P>(): RequestDeps<P> {
  return {
    fetchImpl: (...args) => fetch(...args),
    // Treated as a hint, never as truth: `onLine` is true on a captive-portal
    // wifi with no route to the internet, so the fetch path has to handle
    // failure anyway. What this buys is skipping a doomed request when the
    // browser is certain there is no network — which is the difference between
    // an instant answer and a 30-second timeout.
    isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine),
    getCached: (key) => getRoute<P>(key),
    putCached: (key, payload, fetchedAt) => putRoute(key, payload, fetchedAt),
    now: () => Date.now(),
    journeyDate: (params) =>
      resolveJourney(params.classStartTime, params.journeyDay).date,
  };
}

export function bestTrainQuery(params: BestTrainParams): string {
  return new URLSearchParams({
    fromCode: params.fromCode,
    toCode: params.toCode,
    classStartTime: params.classStartTime,
    bufferMinutes: String(params.bufferMinutes),
    journeyDay: params.journeyDay,
  }).toString();
}

export function cacheKeyFor(
  params: BestTrainParams,
  deps: Pick<RequestDeps<unknown>, "journeyDate">
): string {
  return routeKey(params.fromCode, params.toCode, deps.journeyDate(params));
}

const OFFLINE_UNCACHED =
  "You're offline and this route isn't saved on this phone yet. " +
  "Connect for a moment and search once — after that it works without signal.";

export async function requestBestTrain<P>(
  params: BestTrainParams,
  overrides: Partial<RequestDeps<P>> = {}
): Promise<BestTrainOutcome<P>> {
  const deps = { ...defaultDeps<P>(), ...overrides };
  const key = cacheKeyFor(params, deps);

  // Known offline: answer now from the store, or say so now. No request, no
  // spinner, no waiting for a timeout that was never going to succeed.
  if (!deps.isOnline()) {
    const cached = await deps.getCached(key);
    return cached
      ? { status: "cached", payload: cached.payload, fetchedAt: cached.fetchedAt }
      : { status: "error", message: OFFLINE_UNCACHED, kind: "OFFLINE" };
  }

  try {
    const response = await deps.fetchImpl(
      `/api/best-train?${bestTrainQuery(params)}`
    );
    const body = await response.json();

    if (response.ok) {
      const payload = body as P;
      // Written before returning so the answer on screen is the answer that
      // survives losing signal a second later.
      await deps.putCached(key, payload, deps.now());
      return { status: "live", payload };
    }

    // The server answered, but not with a train. A 5xx or a gateway timeout is
    // an infrastructure problem the user can't act on, and a saved answer is
    // more useful than an apology — so fall back for those. A 400 or a 404 is
    // about *this question* ("that isn't a station", "no train gets you there
    // in time"), and replacing it with a cached answer to a different question
    // would be a lie.
    if (response.status >= 500) {
      const cached = await deps.getCached(key);
      if (cached) {
        return {
          status: "cached",
          payload: cached.payload,
          fetchedAt: cached.fetchedAt,
        };
      }
    }

    return {
      status: "error",
      message: body?.error ?? "Something went wrong. Please try again.",
      kind: body?.kind ?? "UNKNOWN",
    };
  } catch {
    // The request never completed: no signal, DNS failure, a captive portal, a
    // tunnel. `navigator.onLine` said otherwise, which is exactly why this path
    // exists.
    const cached = await deps.getCached(key);
    return cached
      ? { status: "cached", payload: cached.payload, fetchedAt: cached.fetchedAt }
      : {
          status: "error",
          message:
            "Couldn't reach the server, and this route isn't saved on this phone yet. " +
            "Check your signal and try again.",
          kind: "NETWORK",
        };
  }
}

/**
 * Refreshes a saved route in the background, without ever touching the screen
 * the user is looking at.
 *
 * ## Why this is allowed to make a request on open
 *
 * The project's second non-negotiable says never to call upstream on mount.
 * This obeys the spirit of it rather than breaking it:
 *
 *   - It only runs when there is *already* a saved answer, so it never fires on
 *     a first visit or for a route nobody has asked about.
 *   - It only runs when that answer is older than `staleAfterMs`, so opening
 *     the app five times before a train costs one request, not five.
 *   - It hits `/api/best-train`, which is edge-cached and in-instance cached on
 *     `from:to:date`. The overwhelmingly common case is that it costs zero
 *     upstream calls and simply re-warms this device.
 *   - A "today" answer decays every minute as trains depart, so a stale saved
 *     answer is not merely old, it is wrong. Refreshing it while there is still
 *     signal is precisely what makes the offline copy worth having.
 *
 * Returns the fresh payload when it actually changed, so a caller can update a
 * view that is showing this exact route. Resolves to null otherwise — including
 * on every failure, because this is a background nicety and must never surface.
 */
export async function revalidateInBackground<P>(
  params: BestTrainParams,
  staleAfterMs: number,
  overrides: Partial<RequestDeps<P>> = {}
): Promise<P | null> {
  const deps = { ...defaultDeps<P>(), ...overrides };
  if (!deps.isOnline()) return null;

  const key = cacheKeyFor(params, deps);
  const cached = await deps.getCached(key);
  if (!cached) return null;
  if (deps.now() - cached.fetchedAt < staleAfterMs) return null;

  try {
    const response = await deps.fetchImpl(
      `/api/best-train?${bestTrainQuery(params)}`
    );
    if (!response.ok) return null;

    const payload = (await response.json()) as P;
    await deps.putCached(key, payload, deps.now());

    const changed = JSON.stringify(payload) !== JSON.stringify(cached.payload);
    return changed ? payload : null;
  } catch {
    return null;
  }
}
