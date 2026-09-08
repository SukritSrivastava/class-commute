"use client";

import { useEffect, useId, useMemo, useState } from "react";
import StationAutocomplete from "@/components/StationAutocomplete";
import BufferStepper from "@/components/BufferStepper";
import ResultCard from "@/components/ResultCard";
import type { StationOption } from "@/lib/stations";
import type { Journey } from "@/lib/journeys";
import { cn } from "@/lib/cn";
import {
  HHMM_PATTERN,
  guessJourneyDay,
  minutesSinceMidnight,
  type JourneyDay,
} from "@/lib/time";
import {
  requestBestTrain,
  revalidateInBackground,
  type BestTrainParams,
} from "@/lib/requestBestTrain";

interface BestTrainResponse {
  from: { code: string; name: string };
  to: { code: string; name: string };
  journeyDay: JourneyDay;
  /** Set when the timetable was served from cache past its TTL. */
  stale?: boolean;
  /** ISO timestamp of when that cached timetable was fetched. */
  timetableAsOf?: string;
  /** Present when the journey needs a change; the name of the interchange. */
  changeAt?: string;
  best: Journey;
  alternatives: Journey[];
}

const JOURNEY_DAYS: { value: JourneyDay; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
];

interface FieldErrors {
  home?: boolean;
  college?: boolean;
  time?: boolean;
}

type Status = "idle" | "loading" | "success" | "error";

/** The last route this device asked about, so it can be refreshed on open. */
const LAST_ROUTE_KEY = "class-commute:last-route";

/**
 * How old a saved answer has to be before opening the app refreshes it. Fifteen
 * minutes means checking the app repeatedly before a train costs one request
 * rather than one per glance, while still keeping the offline copy current
 * enough to be worth trusting on the platform.
 */
const REVALIDATE_AFTER_MS = 15 * 60 * 1000;

function rememberRoute(params: BestTrainParams): void {
  try {
    localStorage.setItem(LAST_ROUTE_KEY, JSON.stringify(params));
  } catch {
    // Private mode, or storage disabled. Costs a background refresh, nothing more.
  }
}

function recallRoute(): BestTrainParams | null {
  try {
    const raw = localStorage.getItem(LAST_ROUTE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BestTrainParams;
    // Guard against a shape from an older version of the app.
    return parsed?.fromCode && parsed?.toCode && parsed?.classStartTime
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/** Renders a cached answer's age in Mumbai time, since that's the user's clock. */
function formatAsOf(at: string | number): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at));
}

export default function Home() {
  const [home, setHome] = useState<StationOption | null>(null);
  const [college, setCollege] = useState<StationOption | null>(null);
  const [swapCount, setSwapCount] = useState(0);
  const [classStartTime, setClassStartTime] = useState("");
  const [bufferMinutes, setBufferMinutes] = useState(20);
  // null = follow the guess below, which tracks the class time as it changes.
  // Picking a day pins it, so an explicit choice survives editing the time.
  const [journeyDayOverride, setJourneyDayOverride] =
    useState<JourneyDay | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<string | null>(null);
  const [result, setResult] = useState<BestTrainResponse | null>(null);
  /** Epoch ms the shown answer was fetched, when it came from this device. */
  const [cachedAt, setCachedAt] = useState<number | null>(null);

  const timeInputId = useId();
  const dayGroupId = useId();

  // A class time that has already passed in Mumbai means tomorrow's class. The
  // server makes the same call from its own clock; sending it explicitly just
  // keeps what the user sees and what they get in agreement.
  const guessedJourneyDay = useMemo<JourneyDay>(
    () =>
      HHMM_PATTERN.test(classStartTime)
        ? guessJourneyDay(classStartTime, minutesSinceMidnight())
        : "today",
    [classStartTime]
  );
  const journeyDay = journeyDayOverride ?? guessedJourneyDay;

  /**
   * Background freshness.
   *
   * On open, if this device already has a saved answer for the route it last
   * asked about and that answer has gone stale, refresh it quietly. Nothing
   * here touches the screen: the effect runs after paint, the form is already
   * interactive, and a failure is swallowed. The point is that the *saved* copy
   * is current when signal disappears later — a "today" answer decays every
   * minute as trains depart, so a stale one is not merely old, it is wrong.
   *
   * It never fires on a first visit, and never for a route with no saved
   * answer, which is what keeps it inside the project's rule about not calling
   * upstream on mount.
   */
  useEffect(() => {
    const last = recallRoute();
    if (!last) return;

    let cancelled = false;
    void revalidateInBackground<BestTrainResponse>(
      last,
      REVALIDATE_AFTER_MS
    ).then((fresh) => {
      if (cancelled || !fresh) return;
      // Only replace what's on screen if the user is looking at this very
      // route; otherwise the store has been refreshed and that is enough.
      setResult((current) =>
        current &&
        current.from.code === last.fromCode &&
        current.to.code === last.toCode
          ? fresh
          : current
      );
      setCachedAt((current) => (current === null ? null : Date.now()));
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function swapStations() {
    setHome(college);
    setCollege(home);
    setSwapCount((c) => c + 1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const errors: FieldErrors = {
      home: !home,
      college: !college,
      time: !classStartTime,
    };
    setFieldErrors(errors);
    if (errors.home || errors.college || errors.time) return;

    setStatus("loading");
    setErrorMessage(null);
    setErrorKind(null);
    setCachedAt(null);

    const params: BestTrainParams = {
      fromCode: home!.code,
      toCode: college!.code,
      classStartTime,
      bufferMinutes,
      journeyDay,
    };

    // Remembered so the next open can quietly refresh this route while there is
    // still signal — see the revalidation effect above.
    rememberRoute(params);

    // Live answer, else this device's saved one, else an immediate and honest
    // "I don't know". `requestBestTrain` never leaves the caller waiting on a
    // request that cannot succeed.
    const outcome = await requestBestTrain<BestTrainResponse>(params);

    if (outcome.status === "error") {
      setStatus("error");
      setErrorMessage(outcome.message);
      setErrorKind(outcome.kind);
      return;
    }

    setResult(outcome.payload);
    setCachedAt(outcome.status === "cached" ? outcome.fetchedAt : null);
    setStatus("success");
  }

  return (
    <div className="flex flex-1 flex-col items-center px-4 pb-16">
      <header className="w-full max-w-md pt-10 pb-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          Class Commute
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          The latest local that still gets you there on time.
        </p>
      </header>

      <main className="w-full max-w-md">
        <form
          onSubmit={handleSubmit}
          noValidate
          className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
        >
          <div className="relative space-y-4">
            <StationAutocomplete
              key={`home-${swapCount}`}
              label="Home station"
              placeholder="e.g. Borivali"
              value={home}
              onChange={(s) => {
                setHome(s);
                if (s) setFieldErrors((f) => ({ ...f, home: false }));
              }}
              invalid={fieldErrors.home}
            />

            <div className="flex justify-center">
              <button
                type="button"
                onClick={swapStations}
                aria-label="Swap home and college stations"
                className="flex h-11 w-11 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 transition-transform hover:text-teal-600 active:scale-90 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400"
              >
                <svg
                  aria-hidden
                  viewBox="0 0 20 20"
                  fill="none"
                  className="h-4 w-4"
                >
                  <path
                    d="M6 3v11M6 14 3 11m3 3 3-3M14 17V6m0 0 3 3m-3-3-3 3"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>

            <StationAutocomplete
              key={`college-${swapCount}`}
              label="College station"
              placeholder="e.g. Churchgate"
              value={college}
              onChange={(s) => {
                setCollege(s);
                if (s) setFieldErrors((f) => ({ ...f, college: false }));
              }}
              invalid={fieldErrors.college}
            />
          </div>

          {(fieldErrors.home || fieldErrors.college) && (
            <p className="text-xs text-red-600" role="alert">
              Please pick both stations from the suggestions.
            </p>
          )}

          <div>
            <span
              id={dayGroupId}
              className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Class day
            </span>
            <div
              role="radiogroup"
              aria-labelledby={dayGroupId}
              className="flex h-12 items-stretch overflow-hidden rounded-xl border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900"
            >
              {JOURNEY_DAYS.map((option) => {
                const selected = journeyDay === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setJourneyDayOverride(option.value)}
                    className={cn(
                      "flex-1 text-base font-medium transition-colors",
                      selected
                        ? "bg-teal-700 text-white"
                        : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor={timeInputId}
                className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Class start time
              </label>
              <input
                id={timeInputId}
                type="time"
                value={classStartTime}
                onChange={(e) => {
                  setClassStartTime(e.target.value);
                  if (e.target.value) setFieldErrors((f) => ({ ...f, time: false }));
                }}
                aria-invalid={fieldErrors.time || undefined}
                className={cn(
                  "h-12 w-full rounded-xl border bg-white px-3 text-base tabular-nums text-neutral-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/30 dark:bg-neutral-900 dark:text-neutral-100",
                  fieldErrors.time
                    ? "border-red-500"
                    : "border-neutral-300 dark:border-neutral-700"
                )}
              />
              {fieldErrors.time && (
                <p className="mt-1 text-xs text-red-600" role="alert">
                  Required
                </p>
              )}
            </div>

            <BufferStepper value={bufferMinutes} onChange={setBufferMinutes} />
          </div>

          <button
            type="submit"
            disabled={status === "loading"}
            className="flex h-14 w-full items-center justify-center rounded-xl bg-teal-700 text-base font-semibold text-white transition-colors hover:bg-teal-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {status === "loading" ? "Finding your train…" : "Find my train"}
          </button>
        </form>

        <div aria-live="polite" className="mt-6 space-y-3">
          {status === "loading" && (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-20 animate-pulse rounded-2xl bg-neutral-200 dark:bg-neutral-800"
                />
              ))}
            </div>
          )}

          {status === "error" && errorMessage && (
            <div
              role="alert"
              data-testid="result-error"
              className={cn(
                "rounded-2xl border p-4 text-sm",
                errorKind === "RATE_LIMIT"
                  ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-300"
                  : "border-red-200 bg-red-50 text-red-800 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-300"
              )}
            >
              {errorMessage}
            </div>
          )}

          {status === "success" && result && (
            <div className="space-y-3">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                {result.from.name} → {result.to.name}
              </p>

              {/* This answer came off the device, not the network. Marked
                  rather than passed off as live: the times are almost certainly
                  still right, but the user is the one standing on the platform
                  and gets to decide how much to trust a saved answer. */}
              {cachedAt !== null && (
                <p
                  data-testid="cached-notice"
                  className="flex items-center gap-2 rounded-xl border border-hairline bg-night-2 px-3 py-2 text-xs text-ink-muted"
                >
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange"
                  />
                  <span>
                    Saved answer, as of{" "}
                    <span className="type-numeric text-ink">
                      {formatAsOf(cachedAt)}
                    </span>
                    . Check the board when you arrive.
                  </span>
                </p>
              )}

              {/* A different staleness: the *server* fell back to an old
                  timetable, because RailRadar was unreachable or the monthly
                  quota is nearly spent. Worth saying even on a live response. */}
              {cachedAt === null && result.stale && result.timetableAsOf && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Timetable as of {formatAsOf(result.timetableAsOf)}. Times
                  should still be right, but check the board.
                </p>
              )}
              <ResultCard journey={result.best} variant="best" />

              {result.alternatives.length > 0 && (
                <div className="pt-2">
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    Earlier backups
                  </h2>
                  <div className="space-y-2">
                    {result.alternatives.map((alt) => (
                      <ResultCard
                        key={alt.legs.map((l) => l.trainNumber).join("-")}
                        journey={alt}
                        variant="alt"
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
