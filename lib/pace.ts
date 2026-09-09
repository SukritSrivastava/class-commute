/**
 * Fast or slow.
 *
 * On the Mumbai suburban network this is the single most consequential thing
 * about a train after its departure time. A slow local stops everywhere; a fast
 * skips most of it. Borivali to Churchgate is 65 minutes on a slow and 50 on a
 * fast, over the same 33 kilometres — and that difference decides which train
 * someone runs down the stairs for.
 *
 * ## The rule, calibrated against live data
 *
 * Measured across all 418 trains RailRadar returns for Borivali→Churchgate, the
 * corridor is sharply bimodal rather than a spectrum:
 *
 *              halts/km     km/h      duration
 *   slow         0.61       ~30       64–67 min
 *   fast         0.21       38–48     49–52 min
 *
 * There is nothing in between, which is what makes a label honest here. Two
 * independent signals are used — how often it stops, and how fast it covers the
 * ground — and a train is only labelled when **both agree**. Anything in the gap
 * is left unlabelled rather than guessed at: a wrong FAST badge sends someone
 * sprinting for a train that will not save them any time, which is worse than
 * no badge at all.
 */

export type Pace = "fast" | "slow";

/** The fields this needs from a leg. Kept structural so any leg-shaped thing works. */
export interface PaceInput {
  /** Kilometres between the two stations. */
  distance: number;
  /** Minutes end to end. */
  duration: number;
  /** Stops between the two stations, not counting either end. */
  totalHaltsBetween: number;
}

/**
 * Below this the distinction is noise: over a few kilometres a fast and a slow
 * arrive within a minute or two of each other, and the badge would be true but
 * useless.
 */
const MIN_DISTANCE_KM = 5;

// Midpoints of the two clusters above, with the gap left deliberately wide.
const FAST_MAX_HALTS_PER_KM = 0.4;
const FAST_MIN_KMH = 35;
const SLOW_MIN_HALTS_PER_KM = 0.45;
const SLOW_MAX_KMH = 34;

/**
 * Classifies a leg, or returns null when the data does not support a claim.
 *
 * Null is a real answer and the component must render nothing for it — an
 * unlabelled train is not a slow train.
 */
export function paceOf(leg: PaceInput): Pace | null {
  const { distance, duration, totalHaltsBetween } = leg;

  // Missing or nonsensical data. RailRadar occasionally returns zeroes.
  if (!Number.isFinite(distance) || !Number.isFinite(duration)) return null;
  if (distance < MIN_DISTANCE_KM || duration <= 0) return null;
  if (!Number.isFinite(totalHaltsBetween) || totalHaltsBetween < 0) return null;

  const haltsPerKm = totalHaltsBetween / distance;
  const kmPerHour = distance / (duration / 60);

  if (haltsPerKm <= FAST_MAX_HALTS_PER_KM && kmPerHour >= FAST_MIN_KMH) {
    return "fast";
  }
  if (haltsPerKm >= SLOW_MIN_HALTS_PER_KM && kmPerHour <= SLOW_MAX_KMH) {
    return "slow";
  }

  // The signals disagree, or the train sits in the gap between the clusters.
  return null;
}

/**
 * The pace of a whole journey: the label only survives if every leg agrees.
 *
 * A fast leg followed by a slow one is not a fast journey, and calling it one
 * would be the most misleading label available.
 */
export function journeyPace(legs: (Pace | null)[]): Pace | null {
  if (legs.length === 0) return null;
  const [first, ...rest] = legs;
  if (first === null) return null;
  return rest.every((p) => p === first) ? first : null;
}
