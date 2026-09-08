import type { TrainLeg } from "./railradar";
import { effectiveMinutes, toMinutes } from "./time";

export interface TrainResult {
  trainNumber: string;
  trainName: string;
  trainType: string;
  departure: string; // "HH:MM" at the home station
  arrival: string; // "HH:MM" at the college station
  bufferRemainingMinutes: number;
}

export interface BestTrainPick {
  best: TrainResult;
  alternatives: TrainResult[];
}

const MAX_ALTERNATIVES = 3;

/** Nobody at home catches a train that leaves in ninety seconds. */
export const DEFAULT_MINUTES_TO_REACH_STATION = 10;

export interface PickBestTrainInput {
  trains: TrainLeg[];
  /** "HH:MM", IST wall clock. */
  classStartTime: string;
  /** Minutes the user wants free before class starts. */
  bufferMinutes: number;
  /** Weekday of the journey date, lowercase 3-letter, to match `runDays`. */
  journeyWeekday: string;
  /**
   * Minutes since midnight on the journey date, or `null` when the journey is
   * a future date and every train that day is still catchable.
   */
  nowMinutes: number | null;
  /** How long the user needs to get from wherever they are onto the platform. */
  minutesToReachStation?: number;
}

/**
 * Picks the latest train the user can still board that also arrives by
 * (classStartTime - bufferMinutes), plus a few earlier backups. Returns null
 * when no train satisfies both ends.
 *
 * ## The journey timeline
 *
 * Every minute count below is measured from midnight at the *start of the
 * journey day* — the day the user boards at their home station. So:
 *
 *   0 ............ departure ...... arrival ...... cutoff .... class ... 1440
 *
 * Departure is always inside `[0, 1440)`. Arrival is offset by
 * `(to.day - from.day)` days, so a train boarded at 23:50 and arriving 00:20
 * lands at 1460, *after* its departure rather than before it. `nowMinutes`,
 * the class start and the cutoff sit on the same axis, which is what lets all
 * four be compared directly — and what keeps them comparable if a filter is
 * later added or removed.
 *
 * This function is pure: the clock is passed in, never read here.
 */
export function pickBestTrain({
  trains,
  classStartTime,
  bufferMinutes,
  journeyWeekday,
  nowMinutes,
  minutesToReachStation = DEFAULT_MINUTES_TO_REACH_STATION,
}: PickBestTrainInput): BestTrainPick | null {
  const classStartMinutes = toMinutes(classStartTime);

  // Latest arrival that still leaves the requested buffer free before class.
  const cutoff = classStartMinutes - bufferMinutes;

  // Earliest departure the user could physically make. `null` now means the
  // journey is on a future date, so nothing has departed yet.
  const earliestDeparture =
    nowMinutes === null ? null : nowMinutes + minutesToReachStation;

  const candidates = trains
    .filter((leg) => leg.train.runDays.includes(journeyWeekday))
    .map((leg) => {
      const departureMinutes = toMinutes(leg.from.departure);
      // Rebase the arrival onto the boarding day: `day` counts from the train's
      // own origin, which may be earlier than the stop we get on at.
      const arrivalMinutes =
        departureMinutes +
        (effectiveMinutes(leg.to.arrival, leg.to.day) -
          effectiveMinutes(leg.from.departure, leg.from.day));

      return { leg, departureMinutes, arrivalMinutes };
    })
    .filter(
      (c) =>
        (earliestDeparture === null ||
          c.departureMinutes >= earliestDeparture) &&
        c.arrivalMinutes <= cutoff
    )
    // Latest departure first: the promise is the most time at home, not the
    // earliest arrival. Same departure, earlier arrival wins.
    .sort(
      (a, b) =>
        b.departureMinutes - a.departureMinutes ||
        a.arrivalMinutes - b.arrivalMinutes
    );

  if (candidates.length === 0) return null;

  const toResult = (c: (typeof candidates)[number]): TrainResult => ({
    trainNumber: c.leg.train.number,
    trainName: c.leg.train.name,
    trainType: c.leg.train.type,
    departure: c.leg.from.departure,
    arrival: c.leg.to.arrival,
    bufferRemainingMinutes: classStartMinutes - c.arrivalMinutes,
  });

  return {
    best: toResult(candidates[0]),
    alternatives: candidates.slice(1, 1 + MAX_ALTERNATIVES).map(toResult),
  };
}
