import { TtlCache } from "./cache";
import { recordCall, shouldConserveQuota } from "./quota";

const RAILRADAR_BASE_URL = "https://api.railradar.in/v1";
const REQUEST_TIMEOUT_MS = 8000;

/**
 * A suburban timetable is a published document that changes a few times a
 * year, so six hours of staleness costs the user nothing and saves the month.
 */
const TRAINS_BETWEEN_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * How long past the TTL an entry stays servable. Seven days is deliberately
 * generous: the only situations that reach for it are the upstream being down
 * and the monthly quota running out, and in both a week-old locals timetable is
 * very close to correct and enormously better than an error.
 */
const TRAINS_BETWEEN_STALE_MS = 7 * 24 * 60 * 60 * 1000;

const trainsBetweenCache = new TtlCache<TrainsBetweenResult>(
  TRAINS_BETWEEN_TTL_MS,
  TRAINS_BETWEEN_STALE_MS
);

export interface Station {
  code: string;
  name: string;
  city: string | null;
  popularity: number;
  isActive: boolean;
}

export interface TrainLeg {
  train: {
    number: string;
    name: string;
    type: string;
    runDays: string[];
  };
  from: {
    code: string;
    name: string;
    city: string | null;
    departure: string; // "HH:MM"
    day: number; // 1 = departure day, 2 = next day, etc.
    sequence: number;
  };
  to: {
    code: string;
    name: string;
    city: string | null;
    arrival: string; // "HH:MM"
    day: number;
    sequence: number;
  };
  distance: number;
  duration: number; // minutes
  totalHaltsBetween: number;
}

export interface TrainsBetweenResult {
  from: { code: string; name: string };
  to: { code: string; name: string };
  trains: TrainLeg[];
  count: number;
}

export type RailRadarErrorKind =
  | "TIMEOUT"
  | "NETWORK"
  | "UNAUTHORIZED"
  | "RATE_LIMIT"
  | "VALIDATION"
  | "API_ERROR";

export class RailRadarError extends Error {
  kind: RailRadarErrorKind;

  constructor(kind: RailRadarErrorKind, message: string) {
    super(message);
    this.name = "RailRadarError";
    this.kind = kind;
  }
}

interface RailRadarSuccessEnvelope<T> {
  success: true;
  data: T;
}

interface RailRadarErrorEnvelope {
  success: false;
  error: { code: string; message: string };
}

async function railRadarGet<T>(
  path: string,
  params?: Record<string, string>
): Promise<T> {
  const apiKey = process.env.RAILRADAR_API_KEY;
  if (!apiKey) {
    throw new RailRadarError(
      "API_ERROR",
      "RAILRADAR_API_KEY is not configured on the server."
    );
  }

  const url = new URL(`${RAILRADAR_BASE_URL}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new RailRadarError(
        "TIMEOUT",
        "RailRadar took too long to respond."
      );
    }
    throw new RailRadarError(
      "NETWORK",
      "Could not reach RailRadar. Check your connection and try again."
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401 || response.status === 403) {
    throw new RailRadarError("UNAUTHORIZED", "RailRadar rejected the API key.");
  }
  if (response.status === 429) {
    throw new RailRadarError(
      "RATE_LIMIT",
      "RailRadar's rate limit was hit. Please wait a minute and try again."
    );
  }

  let body: RailRadarSuccessEnvelope<T> | RailRadarErrorEnvelope;
  try {
    body = await response.json();
  } catch {
    throw new RailRadarError(
      "API_ERROR",
      "RailRadar returned an unreadable response."
    );
  }

  if (!body.success) {
    if (body.error.code === "TOO_MANY_REQUESTS") {
      throw new RailRadarError(
        "RATE_LIMIT",
        "RailRadar's rate limit was hit. Please wait a minute and try again."
      );
    }
    if (body.error.code === "VALIDATION_ERROR") {
      throw new RailRadarError("VALIDATION", body.error.message);
    }
    throw new RailRadarError("API_ERROR", body.error.message);
  }

  return body.data;
}

/**
 * Autocomplete search for a station by (partial) name or code.
 *
 * **This costs quota.** It is no longer on the typing path — the autocomplete
 * searches `lib/data/mumbai-stations.json` in the browser — and exists only as
 * a fallback for a station the bundle does not know about yet. If you find
 * yourself calling this per keystroke again, regenerate the bundle instead
 * (`npm run stations:refresh`).
 */
export async function searchStations(query: string): Promise<Station[]> {
  if (!query.trim()) return [];
  try {
    const stations = await railRadarGet<Station[]>(
      "/lookup/search/stations",
      { q: query }
    );
    recordCall("lookup/search/stations", "upstream", `q="${query}"`);
    return stations;
  } catch (err) {
    recordCall("lookup/search/stations", "error", `q="${query}"`);
    throw err;
  }
}

/** A timetable, plus where it came from and how old it is. */
export interface TrainsBetweenLookup {
  result: TrainsBetweenResult;
  /** Epoch ms when this timetable was actually fetched from RailRadar. */
  fetchedAt: number;
  /** True when the answer is past its TTL and served anyway. */
  stale: boolean;
  source: "upstream" | "cache" | "stale-cache";
}

/**
 * Full day's schedule of trains running between two stations, in departure
 * order, behind the in-instance cache described in `lib/cache.ts`.
 *
 * Note: RailRadar returns HTTP 200 with an empty `trains` array (and echoes the
 * given code back as the station name) for a station code it doesn't recognize —
 * it never 404s on an invalid code.
 *
 * The cache key carries the journey date even though the endpoint has no date
 * parameter: the timetable is filtered by `runDays` downstream, so an entry
 * fetched for Monday must not answer a question about Tuesday.
 */
export async function getTrainsBetween(
  fromCode: string,
  toCode: string,
  journeyDate: string
): Promise<TrainsBetweenLookup> {
  const key = `${fromCode.toUpperCase()}:${toCode.toUpperCase()}:${journeyDate}`;
  const endpoint = "trains/between";

  const fresh = trainsBetweenCache.get(key);
  if (fresh) {
    recordCall(endpoint, "cache", key);
    return {
      result: fresh.value,
      fetchedAt: fresh.storedAt,
      stale: false,
      source: "cache",
    };
  }

  // Near the monthly ceiling, a slightly old timetable beats a fresh error.
  // Local timetables barely change, so the user loses almost nothing, while
  // the requests we don't spend here keep the app alive for the pairs that
  // have no cached answer at all.
  if (shouldConserveQuota()) {
    const stale = trainsBetweenCache.getAllowingStale(key);
    if (stale) {
      recordCall(endpoint, "cache", `${key} | conserving quota, serving stale`);
      return {
        result: stale.entry.value,
        fetchedAt: stale.entry.storedAt,
        stale: true,
        source: "stale-cache",
      };
    }
  }

  return trainsBetweenCache.coalesce(key, async () => {
    try {
      const result = await railRadarGet<TrainsBetweenResult>(
        `/trains/between/${encodeURIComponent(fromCode)}/${encodeURIComponent(
          toCode
        )}`
      );
      const entry = trainsBetweenCache.set(key, result);
      recordCall(endpoint, "upstream", key);
      return {
        result,
        fetchedAt: entry.storedAt,
        stale: false,
        source: "upstream" as const,
      };
    } catch (err) {
      recordCall(endpoint, "error", key);

      // The upstream is unreachable, rate limited, or out of quota. If we ever
      // had an answer for this pair, it is far more useful than an error page.
      const stale = trainsBetweenCache.getAllowingStale(key);
      if (stale) {
        recordCall(endpoint, "cache", `${key} | upstream failed, serving stale`);
        return {
          result: stale.entry.value,
          fetchedAt: stale.entry.storedAt,
          stale: true,
          source: "stale-cache" as const,
        };
      }
      throw err;
    }
  });
}

/** Test seam: drops the in-instance timetable cache. Not called by the app. */
export function clearTrainsBetweenCache(): void {
  trainsBetweenCache.clear();
}

/**
 * True when RailRadar actually recognized the station code.
 *
 * **Do not delete this as a redundant check, and do not skip it on a new
 * endpoint.** It defends against a trap in the upstream API: RailRadar does not
 * 404 a station code it has never heard of. It returns a *success* envelope with
 * an empty `trains` array and — the part that makes it dangerous — echoes the
 * invalid code back in the `name` field. So a request for the nonsense code
 * `XXXX` comes back as `{ from: { code: "XXXX", name: "XXXX" }, trains: [] }`,
 * which is indistinguishable from a real station that happens to have no trains.
 *
 * Comparing `name` against `code` is the only signal available. Without it a
 * typo'd station tells the user "no trains found" — sending them to look for a
 * different train — instead of "that isn't a station".
 */
export function isRecognizedStation(station: { code: string; name: string }): boolean {
  return station.name.trim().toUpperCase() !== station.code.trim().toUpperCase();
}
