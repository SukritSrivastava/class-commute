const RAILRADAR_BASE_URL = "https://api.railradar.in/v1";
const REQUEST_TIMEOUT_MS = 8000;

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

type RailRadarErrorKind =
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

/** Autocomplete search for a station by (partial) name or code. */
export async function searchStations(query: string): Promise<Station[]> {
  if (!query.trim()) return [];
  return railRadarGet<Station[]>("/lookup/search/stations", { q: query });
}

/**
 * Full day's schedule of trains running between two stations, in departure order.
 * Note: RailRadar returns HTTP 200 with an empty `trains` array (and echoes the
 * given code back as the station name) for a station code it doesn't recognize —
 * it never 404s on an invalid code.
 */
export async function getTrainsBetween(
  fromCode: string,
  toCode: string
): Promise<TrainsBetweenResult> {
  return railRadarGet<TrainsBetweenResult>(
    `/trains/between/${encodeURIComponent(fromCode)}/${encodeURIComponent(
      toCode
    )}`
  );
}

/** True when RailRadar actually recognized the station code (name differs from the raw code). */
export function isRecognizedStation(station: { code: string; name: string }): boolean {
  return station.name.trim().toUpperCase() !== station.code.trim().toUpperCase();
}
