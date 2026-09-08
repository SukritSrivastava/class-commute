/**
 * Every Asia/Kolkata concern in the app lives here.
 *
 * Vercel runs in UTC, so nothing else may read the server's local clock: no
 * bare `getDay()`, `getHours()`, or `toLocaleString()` without a `timeZone`.
 * Anything that needs the wall clock imports from this module, and every
 * function takes the instant it should read as a parameter so callers can pass
 * a fixed value in tests.
 *
 * Two kinds of number appear throughout:
 *   - a *wall-clock* minute count, 0..1439, minutes since midnight IST;
 *   - a *timeline* minute count, which may exceed 1439 because it is measured
 *     from midnight at the start of a journey (see `effectiveMinutes`).
 */

/** Matches a 24-hour "HH:MM" wall-clock string. */
export const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const MINUTES_PER_DAY = 24 * 60;

const IST = "Asia/Kolkata";

/** Lowercase 3-letter day names, indexed the way `Date#getUTCDay` numbers them. */
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** Which calendar day the journey happens on, relative to right now in Mumbai. */
export type JourneyDay = "today" | "tomorrow";

/** A moment in Mumbai, broken into the pieces the rest of the app reasons about. */
export interface MumbaiNow {
  /** IST calendar date, "YYYY-MM-DD". */
  date: string;
  /** IST day of week in the lowercase 3-letter form RailRadar uses in `runDays`. */
  weekday: string;
  /** IST wall clock, "HH:MM". */
  hhmm: string;
  /** Minutes since IST midnight, 0..1439. */
  minutes: number;
}

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: IST,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  // h23 rather than `hour12: false`, which renders midnight as "24" on some ICU builds.
  hourCycle: "h23",
});

interface MumbaiParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function mumbaiParts(instant: Date): MumbaiParts {
  const parts = partsFormatter.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

const pad2 = (n: number) => n.toString().padStart(2, "0");

/** The current (or given) moment, as Mumbai wall clock. */
export function nowInMumbai(instant: Date = new Date()): MumbaiNow {
  const { year, month, day, hour, minute } = mumbaiParts(instant);

  return {
    date: `${year}-${pad2(month)}-${pad2(day)}`,
    weekday: WEEKDAYS[shiftedDate(year, month, day).getUTCDay()],
    hhmm: `${pad2(hour)}:${pad2(minute)}`,
    minutes: hour * 60 + minute,
  };
}

/** Minutes since midnight in Mumbai, 0..1439. */
export function minutesSinceMidnight(instant: Date = new Date()): number {
  const { hour, minute } = mumbaiParts(instant);
  return hour * 60 + minute;
}

/**
 * Day of week in Mumbai `offsetDays` calendar days from now, in the lowercase
 * 3-letter form RailRadar uses in `runDays`. `weekdayInMumbai(1)` is tomorrow
 * *in Mumbai*, which is not the same as tomorrow in UTC for 5.5 hours a day.
 */
export function weekdayInMumbai(
  offsetDays = 0,
  instant: Date = new Date()
): string {
  const { year, month, day } = mumbaiParts(instant);
  return WEEKDAYS[shiftedDate(year, month, day + offsetDays).getUTCDay()];
}

/**
 * Mumbai calendar date `offsetDays` from now, "YYYY-MM-DD". Used as part of the
 * upstream cache key, so a cached timetable expires at the Mumbai date change
 * rather than the UTC one.
 */
export function dateInMumbai(
  offsetDays = 0,
  instant: Date = new Date()
): string {
  const { year, month, day } = mumbaiParts(instant);
  const shifted = shiftedDate(year, month, day + offsetDays);
  return `${shifted.getUTCFullYear()}-${pad2(
    shifted.getUTCMonth() + 1
  )}-${pad2(shifted.getUTCDate())}`;
}

/**
 * A Mumbai calendar date as a UTC `Date`. `Date.UTC` is used purely as a
 * calendar calculator — it rolls `day + n` over month and year ends for us —
 * and never as a real instant, so no timezone offset is involved.
 */
function shiftedDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** "HH:MM" wall clock to minutes since midnight. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * A leg time placed on the journey timeline.
 *
 * RailRadar's `day` is 1-indexed from the train's own departure, not a date:
 * `day: 1` is the departure day, `day: 2` the next calendar day. So a train
 * leaving 23:50 and arriving 00:20 has `to.day === 2`, and comparing the two
 * "HH:MM" strings alone would sort the arrival *before* the departure.
 */
export function effectiveMinutes(hhmm: string, day: number): number {
  return toMinutes(hhmm) + (day - 1) * MINUTES_PER_DAY;
}

/**
 * Which day the class is on when the user hasn't said. Once the class start
 * time has passed in Mumbai, the next occurrence of that time is tomorrow —
 * someone checking a 09:00 class at 23:00 on Sunday is asking about Monday.
 */
export function guessJourneyDay(
  classStartTime: string,
  nowMinutes: number
): JourneyDay {
  return toMinutes(classStartTime) <= nowMinutes ? "tomorrow" : "today";
}

/** The journey's day, its weekday, and where "now" sits on it. */
export interface ResolvedJourney {
  day: JourneyDay;
  /** The journey's Mumbai calendar date, "YYYY-MM-DD". Part of the cache key. */
  date: string;
  /** Weekday of the journey date, to match against a train's `runDays`. */
  weekday: string;
  /**
   * Minutes since midnight on the journey date, or `null` when the journey is
   * a future date — on a future date every train of the day is still catchable,
   * so there is no "already departed" line to draw.
   */
  nowMinutes: number | null;
}

/**
 * Resolves the journey date from the class time and the user's optional
 * Today/Tomorrow override. An explicit override always wins; the guess is only
 * a default.
 */
export function resolveJourney(
  classStartTime: string,
  override?: JourneyDay,
  instant: Date = new Date()
): ResolvedJourney {
  const nowMinutes = minutesSinceMidnight(instant);
  const day = override ?? guessJourneyDay(classStartTime, nowMinutes);
  const offsetDays = day === "tomorrow" ? 1 : 0;

  return {
    day,
    date: dateInMumbai(offsetDays, instant),
    weekday: weekdayInMumbai(offsetDays, instant),
    nowMinutes: day === "today" ? nowMinutes : null,
  };
}
