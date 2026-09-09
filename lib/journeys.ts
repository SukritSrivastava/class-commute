import type { TrainLeg } from "./railradar";
import { journeyPace, paceOf, type Pace } from "./pace";
import { effectiveMinutes, toMinutes } from "./time";

/**
 * Ranking journeys, direct and with one change, against each other.
 *
 * The timeline convention is the one from `lib/bestTrain.ts`: every minute
 * count is measured from midnight at the start of the boarding day, so a leg
 * arriving past midnight lands at 1440+ rather than at 20.
 *
 * Pure — the clock is passed in, never read here.
 */

export interface JourneyLeg {
  trainNumber: string;
  trainName: string;
  trainType: string;
  fromCode: string;
  fromName: string;
  departure: string;
  toCode: string;
  toName: string;
  arrival: string;
  /**
   * Fast or slow, or null when the data doesn't support a claim. Derived here
   * rather than in the component so the rule lives in `lib/pace.ts` and is
   * tested — see the calibration note there.
   */
  pace: Pace | null;
}

export interface Journey {
  kind: "direct" | "interchange";
  legs: JourneyLeg[];
  /** Present on an interchange journey: where you change and how long you wait. */
  change?: {
    name: string;
    /** Minutes on the platform between getting off and getting on. */
    waitMinutes: number;
  };
  /** "HH:MM" you leave your home station. */
  departure: string;
  /** "HH:MM" you arrive at your college station. */
  arrival: string;
  /** Minutes spare before class starts. */
  bufferRemainingMinutes: number;
  /** Door to door, including any wait at the change. */
  totalMinutes: number;
  /** The journey's pace, only set when every leg agrees. */
  pace: Pace | null;
}

export interface JourneyContext {
  /** "HH:MM", IST wall clock. */
  classStartTime: string;
  /** Minutes the user wants free before class starts. */
  bufferMinutes: number;
  /** Weekday of the journey date, lowercase 3-letter, to match `runDays`. */
  journeyWeekday: string;
  /**
   * Minutes since midnight on the journey date, or null when the journey is a
   * future date and every train that day is still catchable.
   */
  nowMinutes: number | null;
  /** How long the user needs to get onto their home platform. */
  minutesToReachStation?: number;
}

/**
 * Minutes between opening the app and being on the platform, able to board.
 *
 * This decides which trains are *offered at all*: anything departing sooner than
 * `now + this` is filtered out as uncatchable, so it is the difference between a
 * useful answer and one that tells someone to run for a train they cannot reach.
 *
 * Ten is chosen to be wrong in the safe direction. Too high and the app hides a
 * train that was makeable — an inconvenience, and the next one is along shortly.
 * Too low and it recommends one that is already pulling out, which is the exact
 * failure the whole app exists to prevent. It is a guess about the world, not a
 * measurement, which is why it is a named constant a caller can override via
 * `JourneyContext.minutesToReachStation`.
 */
export const DEFAULT_MINUTES_TO_REACH_STATION = 10;

/**
 * Minutes to allow between getting off one train and boarding the next.
 *
 * Eight is the floor, not the average. Dadar's change is a staircase, a
 * footbridge and another staircase, and at 08:30 the bridge is the bottleneck —
 * `lib/network.ts` raises it to ten there for that reason. Below eight we would
 * be routinely proposing connections that a person carrying a bag, in a crowd,
 * simply cannot make.
 */
export const DEFAULT_TRANSFER_MINUTES = 8;

/**
 * Longer than this at the interchange and it stops being a connection and
 * starts being a wait. Thirty minutes standing on Dadar's bridge is worse than
 * leaving home thirty minutes later, and we would rather find nothing than
 * recommend that.
 */
export const MAX_INTERCHANGE_WAIT_MINUTES = 30;

/**
 * How much later an interchange journey must leave before it beats a direct one.
 *
 * ## The asymmetry, deliberately
 *
 * The app's promise is the *latest* train that still works, so a later
 * departure is normally better — it is more time at home. Ranking on that alone
 * would prefer an interchange leaving 08:10 over a direct leaving 08:00.
 *
 * That comparison is wrong, because the two outcomes are not symmetric:
 *
 *   - Leaving fifteen minutes earlier costs fifteen minutes. It is an
 *     inconvenience, and it is bounded.
 *   - Missing a connection costs the whole journey. You are on a platform at
 *     Dadar watching your train leave, with no plan, and you are late for
 *     class. That is the failure this app exists to prevent, and its cost is
 *     not fifteen minutes.
 *
 * A direct train has no connection to miss. So an interchange has to be
 * *substantially* better, not marginally better, to be worth that risk — and it
 * is scored as though it departed fifteen minutes earlier than it does. An
 * interchange leaving 08:10 loses to a direct leaving 08:00; one leaving 08:20
 * wins, because by then it really is buying you meaningful time.
 *
 * Fifteen is roughly the frequency of a Mumbai local in the peak: it is the
 * cost of the recovery, if the connection fails and you catch the next one.
 */
export const INTERCHANGE_PENALTY_MINUTES = 15;

interface Candidate {
  journey: Journey;
  departureMinutes: number;
  arrivalMinutes: number;
}

/** Runs on the journey day, and rebased onto the boarding day. */
function usableLeg(
  leg: TrainLeg,
  journeyWeekday: string
): { departureMinutes: number; arrivalMinutes: number } | null {
  if (!leg.train.runDays.includes(journeyWeekday)) return null;

  const departureMinutes = toMinutes(leg.from.departure);
  // `day` counts from the train's own origin, which may be earlier than the
  // stop we board at, so rebase the arrival onto the boarding day.
  const arrivalMinutes =
    departureMinutes +
    (effectiveMinutes(leg.to.arrival, leg.to.day) -
      effectiveMinutes(leg.from.departure, leg.from.day));

  return { departureMinutes, arrivalMinutes };
}

function toJourneyLeg(leg: TrainLeg): JourneyLeg {
  return {
    trainNumber: leg.train.number,
    trainName: leg.train.name,
    trainType: leg.train.type,
    fromCode: leg.from.code,
    fromName: leg.from.name,
    departure: leg.from.departure,
    toCode: leg.to.code,
    toName: leg.to.name,
    arrival: leg.to.arrival,
    pace: paceOf(leg),
  };
}

/** Every direct train that runs on the journey day, as a one-leg journey. */
export function directJourneys(
  trains: TrainLeg[],
  context: JourneyContext
): Candidate[] {
  const classStartMinutes = toMinutes(context.classStartTime);

  return trains.flatMap((leg) => {
    const times = usableLeg(leg, context.journeyWeekday);
    if (!times) return [];

    const journeyLeg = toJourneyLeg(leg);

    return [
      {
        journey: {
          kind: "direct" as const,
          legs: [journeyLeg],
          departure: leg.from.departure,
          arrival: leg.to.arrival,
          bufferRemainingMinutes: classStartMinutes - times.arrivalMinutes,
          totalMinutes: times.arrivalMinutes - times.departureMinutes,
          pace: journeyLeg.pace,
        },
        ...times,
      },
    ];
  });
}

export interface InterchangeOptions {
  /** Shown to the user as "Change at …". */
  interchangeName: string;
  /** Minutes needed to make the change on foot. */
  transferMinutes?: number;
  /** Longer waits than this are not offered. */
  maxWaitMinutes?: number;
}

/**
 * Joins two legs' timetables into connections that a person can actually make.
 *
 * For each first leg, this takes only the *earliest* boardable second leg. Any
 * later one arrives later for the same departure, so it is dominated — keeping
 * them would multiply the candidate list without ever producing a better
 * journey, and would fill the alternatives list with the same first train four
 * times over.
 */
export function interchangeJourneys(
  firstLegTrains: TrainLeg[],
  secondLegTrains: TrainLeg[],
  context: JourneyContext,
  options: InterchangeOptions
): Candidate[] {
  const classStartMinutes = toMinutes(context.classStartTime);
  const transfer = options.transferMinutes ?? DEFAULT_TRANSFER_MINUTES;
  const maxWait = options.maxWaitMinutes ?? MAX_INTERCHANGE_WAIT_MINUTES;

  const second = secondLegTrains
    .flatMap((leg) => {
      const times = usableLeg(leg, context.journeyWeekday);
      return times ? [{ leg, ...times }] : [];
    })
    .sort((a, b) => a.departureMinutes - b.departureMinutes);

  const candidates: Candidate[] = [];

  for (const first of firstLegTrains) {
    const firstTimes = usableLeg(first, context.journeyWeekday);
    if (!firstTimes) continue;

    const boardableFrom = firstTimes.arrivalMinutes + transfer;
    const connection = second.find(
      (option) =>
        option.departureMinutes >= boardableFrom &&
        option.departureMinutes - boardableFrom <= maxWait
    );
    if (!connection) continue;

    // Counted from stepping off the first train, so it is the number the user
    // is actually standing there for — not the slack left after the transfer.
    const waitMinutes = connection.departureMinutes - firstTimes.arrivalMinutes;

    const legs = [toJourneyLeg(first), toJourneyLeg(connection.leg)];

    candidates.push({
      journey: {
        kind: "interchange",
        legs,
        change: { name: options.interchangeName, waitMinutes },
        departure: first.from.departure,
        arrival: connection.leg.to.arrival,
        bufferRemainingMinutes: classStartMinutes - connection.arrivalMinutes,
        totalMinutes: connection.arrivalMinutes - firstTimes.departureMinutes,
        // A fast leg followed by a slow one is not a fast journey.
        pace: journeyPace(legs.map((l) => l.pace)),
      },
      departureMinutes: firstTimes.departureMinutes,
      arrivalMinutes: connection.arrivalMinutes,
    });
  }

  return candidates;
}

export interface JourneyPick {
  best: Journey;
  alternatives: Journey[];
}

const MAX_ALTERNATIVES = 3;

/**
 * Picks the latest journey the user can still board that also arrives in time,
 * plus a few earlier backups. Returns null when nothing qualifies.
 *
 * Direct and interchange candidates compete in one list, with the interchange
 * penalty above applied to the comparison but never to the times shown.
 */
export function pickBestJourney(
  candidates: Candidate[],
  context: JourneyContext
): JourneyPick | null {
  const classStartMinutes = toMinutes(context.classStartTime);
  const cutoff = classStartMinutes - context.bufferMinutes;
  const margin =
    context.minutesToReachStation ?? DEFAULT_MINUTES_TO_REACH_STATION;
  const earliestDeparture =
    context.nowMinutes === null ? null : context.nowMinutes + margin;

  const viable = candidates.filter(
    (c) =>
      (earliestDeparture === null || c.departureMinutes >= earliestDeparture) &&
      c.arrivalMinutes <= cutoff
  );

  if (viable.length === 0) return null;

  // The comparison key, not a displayed time: an interchange is judged as
  // though it left earlier than it does. See INTERCHANGE_PENALTY_MINUTES.
  const score = (c: Candidate) =>
    c.departureMinutes -
    (c.journey.kind === "interchange" ? INTERCHANGE_PENALTY_MINUTES : 0);

  viable.sort(
    (a, b) =>
      score(b) - score(a) ||
      // Same score: the one that gets you there sooner, then the one with
      // fewer things that can go wrong.
      a.arrivalMinutes - b.arrivalMinutes ||
      a.journey.legs.length - b.journey.legs.length
  );

  // Two trains can leave at the same minute and arrive at the same minute — a
  // Virar fast and a Borivali slow, both catching the same connection at Dadar.
  // Offering both fills the backup list with what reads as the same option
  // twice. The user is choosing between departure and arrival times, not
  // between train numbers, so one per pair is enough.
  const seen = new Set<string>();
  const distinct = viable.filter((c) => {
    const key = `${c.departureMinutes}:${c.arrivalMinutes}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    best: distinct[0].journey,
    alternatives: distinct.slice(1, 1 + MAX_ALTERNATIVES).map((c) => c.journey),
  };
}
