import { nowInMumbai } from "./time";

/**
 * Upstream-call accounting for the RailRadar free tier.
 *
 * The plan allows 1,000 requests a *month* and 10 a minute. That is ~33 a day
 * for the entire user base, which makes the upstream call the scarcest
 * resource in this project — scarcer than CPU, memory or bundle bytes. You
 * cannot manage what you cannot see, so every call through `lib/railradar.ts`
 * is counted here and logged with whether it was served from cache.
 *
 * ## What this is not
 *
 * These counters live in module state, which on Vercel means **per running
 * instance**. Scale to three warm instances and each has its own tally, so the
 * numbers here are a floor on real usage, not a ledger. That is the right
 * trade for the job they do — spotting a runaway caller and deciding when to
 * start degrading gracefully — but do not bill anyone from them. A real ledger
 * would need shared storage, which this app deliberately does not have.
 */

/** The free tier's monthly request ceiling. */
export const MONTHLY_QUOTA = 1_000;

/**
 * Above this fraction of the monthly ceiling the app stops making optional
 * calls and prefers stale cache. 85% leaves ~150 requests of headroom, enough
 * for a few days of genuinely new station pairs at the end of a bad month.
 */
export const DEGRADE_ABOVE = 0.85;

export interface EndpointUsage {
  /** Calls that actually left the process. */
  upstream: number;
  /** Calls answered from cache — the ones that cost nothing. */
  cacheHits: number;
  /** Calls that left the process and failed. */
  errors: number;
}

interface DayUsage {
  /** IST calendar date, "YYYY-MM-DD". */
  date: string;
  byEndpoint: Record<string, EndpointUsage>;
}

/** Keyed by IST date. Trimmed to the current month, which is all we bill against. */
const days = new Map<string, DayUsage>();

/** Start of the process, so the report can say how much of the month it saw. */
const startedAt = new Date().toISOString();

function emptyUsage(): EndpointUsage {
  return { upstream: 0, cacheHits: 0, errors: 0 };
}

function usageFor(date: string, endpoint: string): EndpointUsage {
  let day = days.get(date);
  if (!day) {
    day = { date, byEndpoint: {} };
    days.set(date, day);

    // Keep only the current month: the quota resets monthly, and an unbounded
    // map in a long-lived instance is a slow leak.
    const month = date.slice(0, 7);
    for (const key of days.keys()) {
      if (key.slice(0, 7) !== month) days.delete(key);
    }
  }
  return (day.byEndpoint[endpoint] ??= emptyUsage());
}

export type CallOutcome = "upstream" | "cache" | "error";

/**
 * Records one attempt to answer a RailRadar question, and logs it. The log line
 * is the primary artefact: it is what lets someone reading production output
 * count real upstream calls without trusting a counter.
 */
export function recordCall(
  endpoint: string,
  outcome: CallOutcome,
  detail?: string
): void {
  const { date } = nowInMumbai();
  const usage = usageFor(date, endpoint);

  if (outcome === "cache") usage.cacheHits++;
  else {
    usage.upstream++;
    if (outcome === "error") usage.errors++;
  }

  const monthly = monthlyUpstreamTotal();
  console.log(
    `[railradar] ${outcome.toUpperCase().padEnd(8)} ${endpoint}` +
      ` | month ${monthly}/${MONTHLY_QUOTA}` +
      ` | today ${usage.upstream} upstream, ${usage.cacheHits} cached` +
      (detail ? ` | ${detail}` : "")
  );
}

/** Upstream calls this instance has made in the current IST month. */
export function monthlyUpstreamTotal(): number {
  const month = nowInMumbai().date.slice(0, 7);
  let total = 0;
  for (const day of days.values()) {
    if (!day.date.startsWith(month)) continue;
    for (const usage of Object.values(day.byEndpoint)) total += usage.upstream;
  }
  return total;
}

/**
 * True once this instance has spent enough of the month that it should stop
 * making calls it could avoid, and serve slightly stale data instead. See
 * `DEGRADE_ABOVE` for why the line sits where it does.
 */
export function shouldConserveQuota(): boolean {
  return monthlyUpstreamTotal() >= MONTHLY_QUOTA * DEGRADE_ABOVE;
}

export interface UsageReport {
  startedAt: string;
  today: string;
  month: string;
  monthlyUpstream: number;
  monthlyQuota: number;
  conserving: boolean;
  days: DayUsage[];
}

/** Snapshot for the dev-only usage route. */
export function usageReport(): UsageReport {
  const today = nowInMumbai().date;
  return {
    startedAt,
    today,
    month: today.slice(0, 7),
    monthlyUpstream: monthlyUpstreamTotal(),
    monthlyQuota: MONTHLY_QUOTA,
    conserving: shouldConserveQuota(),
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** Test seam. Not called by the app. */
export function resetUsage(): void {
  days.clear();
}
