import type { TrainLeg } from "./railradar";

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

/** Current day-of-week in Mumbai, as the lowercase 3-letter form RailRadar uses in `runDays`. */
export function todayInMumbai(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
  })
    .format(new Date())
    .slice(0, 3)
    .toLowerCase();
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Minutes since midnight of the journey's day 1, so day-2 (post-midnight) times sort correctly. */
function effectiveMinutes(hhmm: string, day: number): number {
  return toMinutes(hhmm) + (day - 1) * 24 * 60;
}

/**
 * Picks the latest train that still arrives by (classStartTime - bufferMinutes), plus
 * a few earlier backups. Returns null when no train satisfies the deadline.
 */
export function pickBestTrain(
  trains: TrainLeg[],
  classStartTime: string,
  bufferMinutes: number,
  today: string
): BestTrainPick | null {
  const classStartMinutes = toMinutes(classStartTime);
  const cutoff = classStartMinutes - bufferMinutes;

  const candidates = trains
    .filter((leg) => leg.train.runDays.includes(today))
    .map((leg) => ({
      leg,
      arrivalMinutes: effectiveMinutes(leg.to.arrival, leg.to.day),
    }))
    .filter((c) => c.arrivalMinutes <= cutoff)
    .sort((a, b) => b.arrivalMinutes - a.arrivalMinutes);

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
