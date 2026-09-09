"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import JourneyPicker from "@/components/JourneyPicker";
import BufferStepper from "@/components/BufferStepper";
import ResultCard from "@/components/ResultCard";
import ErrorCard from "@/components/ErrorCard";
import MumbaiClock from "@/components/MumbaiClock";
import { Press, Reveal, Stagger } from "@/components/motion";
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

/**
 * The shared easing curve and the interface duration, handed to `motion` in the
 * form it wants. Nothing here invents its own timing — these are the same
 * numbers as `--ease-signature` and `--duration-ui` in globals.css.
 */
const EASE_SIGNATURE = [0.16, 1, 0.3, 1] as const;
const FORM_TRANSITION = { duration: 0.2, ease: EASE_SIGNATURE } as const;

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

  /**
   * Swaps the two stations. Used to also bump a counter that was fed to each
   * autocomplete as a `key`, forcing a remount, because the component copied
   * `value` into its own state and would otherwise keep showing the old name.
   * `StationAutocomplete` is properly controlled now, so this is just the swap.
   */
  function swapStations() {
    setHome(college);
    setCollege(home);
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


  const showResults = status === "success" && result !== null;

  /**
   * The form gives up the screen once there is an answer. Everything stays
   * mounted and reachable — the stations are still editable, and one tap brings
   * the time and buffer back — but on a phone the answer gets the viewport,
   * which is the whole point of a one-screen layout.
   */
  const formCollapsed = showResults;

  return (
    <div className="flex flex-1 flex-col items-center px-4 pb-10">
      <header className="flex w-full max-w-md items-baseline justify-between gap-3 pt-6 pb-5">
        <h1 className="type-display text-2xl text-ink">Class Commute</h1>
        <MumbaiClock />
      </header>

      <main className="w-full max-w-md">
        <LayoutGroup>
          <motion.form
            layout
            onSubmit={handleSubmit}
            noValidate
            transition={FORM_TRANSITION}
            className="rounded-2xl border border-hairline bg-night-2/40 p-4"
          >
            <motion.div layout="position" transition={FORM_TRANSITION}>
              <JourneyPicker
                home={home}
                college={college}
                onHomeChange={(station) => {
                  setHome(station);
                  if (station) setFieldErrors((f) => ({ ...f, home: false }));
                }}
                onCollegeChange={(station) => {
                  setCollege(station);
                  if (station) setFieldErrors((f) => ({ ...f, college: false }));
                }}
                onSwap={swapStations}
                homeInvalid={fieldErrors.home}
                collegeInvalid={fieldErrors.college}
                searching={status === "loading"}
              />
            </motion.div>

            {(fieldErrors.home || fieldErrors.college) && (
              <p className="mt-3 text-xs text-magenta" role="alert">
                Pick both stations from the suggestions.
              </p>
            )}

            {/* Collapsed away once the answer is on screen. Animated with
                `layout`, so the cards below move with it rather than jumping
                when a height transition finishes. */}
            <AnimatePresence initial={false}>
              {!formCollapsed && (
                <motion.div
                  key="details"
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={FORM_TRANSITION}
                  className="overflow-hidden"
                >
                  <div className="mt-4 grid grid-cols-[1fr_auto] gap-3">
                    <div>
                      <label
                        htmlFor={timeInputId}
                        className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-dim"
                      >
                        Class starts
                      </label>
                      <input
                        id={timeInputId}
                        type="time"
                        value={classStartTime}
                        onChange={(e) => {
                          setClassStartTime(e.target.value);
                          if (e.target.value) {
                            setFieldErrors((f) => ({ ...f, time: false }));
                          }
                        }}
                        aria-invalid={fieldErrors.time || undefined}
                        className={cn(
                          "type-numeric h-12 w-full rounded-xl border bg-night-2 px-3 text-base text-ink outline-none",
                          fieldErrors.time ? "border-magenta" : "border-hairline"
                        )}
                      />
                      {fieldErrors.time && (
                        <p className="mt-1 text-xs text-magenta" role="alert">
                          Required
                        </p>
                      )}
                    </div>

                    <BufferStepper
                      value={bufferMinutes}
                      onChange={setBufferMinutes}
                    />
                  </div>

                  <div className="mt-3">
                    <span
                      id={dayGroupId}
                      className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-dim"
                    >
                      Class day
                    </span>
                    <div
                      role="radiogroup"
                      aria-labelledby={dayGroupId}
                      className="flex h-12 items-stretch overflow-hidden rounded-xl border border-hairline bg-night-2"
                    >
                      {JOURNEY_DAYS.map((option) => {
                        const selected = journeyDay === option.value;
                        return (
                          <Press
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => setJourneyDayOverride(option.value)}
                            className={cn(
                              "flex-1 text-base font-medium transition-colors",
                              selected
                                ? "bg-gold text-on-accent"
                                : "text-ink-muted hover:bg-night-3 hover:text-ink"
                            )}
                          >
                            {option.label}
                          </Press>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.div layout transition={FORM_TRANSITION} className="mt-4">
              <Press
                type="submit"
                disabled={status === "loading"}
                className="bg-sunset flex h-14 w-full items-center justify-center rounded-xl text-base font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === "loading"
                  ? "Searching the route…"
                  : formCollapsed
                    ? "Search again"
                    : "Find my train"}
              </Press>
            </motion.div>

            {formCollapsed && (
              <button
                type="button"
                onClick={() => {
                  setStatus("idle");
                  setResult(null);
                  setCachedAt(null);
                }}
                className="mt-2 min-h-11 w-full text-xs text-ink-dim underline underline-offset-4 hover:text-ink-muted"
              >
                Change time or buffer
              </button>
            )}
          </motion.form>

          {/* Polite, so an answer is announced without stealing focus from
              whatever a keyboard user was doing. */}
          <motion.div
            layout
            transition={FORM_TRANSITION}
            aria-live="polite"
            className="mt-5 space-y-3"
          >
            {status === "loading" && (
              <p className="type-numeric text-center text-xs text-ink-dim">
                Searching {home?.name ?? "route"} → {college?.name ?? "route"}…
              </p>
            )}

            {status === "error" && errorMessage && (
              <Reveal>
                <ErrorCard kind={errorKind} message={errorMessage} />
              </Reveal>
            )}

            {showResults && result && (
              <Stagger className="space-y-3">
                <Reveal>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm text-ink-muted">
                      {result.from.name} <span className="text-ink-dim">→</span>{" "}
                      {result.to.name}
                    </p>
                    <span className="type-numeric shrink-0 text-xs uppercase tracking-wider text-ink-dim">
                      {result.journeyDay}
                    </span>
                  </div>
                </Reveal>

                {/* This answer came off the device, not the network. Marked
                    rather than passed off as live: the times are almost
                    certainly still right, but the user is the one standing on
                    the platform and gets to decide how far to trust it. */}
                {cachedAt !== null && (
                  <Reveal>
                    <p
                      data-testid="cached-notice"
                      className="flex items-start gap-2 rounded-xl border border-orange/30 bg-orange/5 px-3 py-2 text-xs text-ink-muted"
                    >
                      <span
                        aria-hidden
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-orange"
                      />
                      <span>
                        Saved answer, as of{" "}
                        <span className="type-numeric text-ink">
                          {formatAsOf(cachedAt)}
                        </span>
                        . Check the board when you arrive.
                      </span>
                    </p>
                  </Reveal>
                )}

                {/* A different staleness: the *server* fell back to an old
                    timetable, because RailRadar was unreachable or the monthly
                    quota is nearly spent. Worth saying even on a live answer. */}
                {cachedAt === null && result.stale && result.timetableAsOf && (
                  <Reveal>
                    <p className="rounded-xl border border-orange/30 bg-orange/5 px-3 py-2 text-xs text-ink-muted">
                      Timetable as of{" "}
                      <span className="type-numeric text-ink">
                        {formatAsOf(result.timetableAsOf)}
                      </span>
                      . Times should still be right, but check the board.
                    </p>
                  </Reveal>
                )}

                <Reveal>
                  <ResultCard
                    journey={result.best}
                    variant="best"
                    countdown={result.journeyDay === "today"}
                  />
                </Reveal>

                {result.alternatives.length > 0 && (
                  <Reveal>
                    <div className="pt-1">
                      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-ink-dim">
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
                  </Reveal>
                )}
              </Stagger>
            )}
          </motion.div>
        </LayoutGroup>
      </main>
    </div>
  );
}
