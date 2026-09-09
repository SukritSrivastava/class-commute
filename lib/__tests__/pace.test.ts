import { describe, expect, it } from "vitest";
import { journeyPace, paceOf } from "@/lib/pace";

/**
 * The numbers below are real: measured across the 418 trains RailRadar returns
 * for Borivali→Churchgate. They are the reason the thresholds sit where they do,
 * so if a threshold moves, these tests are what should stop it.
 */

describe("paceOf — against the real Borivali–Churchgate corridor", () => {
  it("calls a 20-stop, 65-minute local slow", () => {
    // The most common shape on the corridor: 0.61 halts/km at 30 km/h.
    expect(paceOf({ distance: 33, duration: 65, totalHaltsBetween: 20 })).toBe(
      "slow"
    );
  });

  it("calls a 7-stop, 49-minute local fast", () => {
    // 0.21 halts/km at 40 km/h. Sixteen minutes quicker over the same track.
    expect(paceOf({ distance: 32.9, duration: 49, totalHaltsBetween: 7 })).toBe(
      "fast"
    );
  });

  it("agrees with the whole observed slow cluster", () => {
    for (const duration of [64, 65, 66, 67]) {
      expect(paceOf({ distance: 33, duration, totalHaltsBetween: 20 })).toBe("slow");
    }
  });

  it("agrees with the whole observed fast cluster", () => {
    for (const [duration, halts] of [
      [52, 7],
      [49, 7],
      [41, 4],
    ] as const) {
      expect(paceOf({ distance: 33, duration, totalHaltsBetween: halts })).toBe(
        "fast"
      );
    }
  });
});

describe("paceOf — refusing to guess", () => {
  it("says nothing when the two signals disagree", () => {
    // Few stops but crawling: something is unusual about this service, and a
    // FAST badge would send someone running for a train that saves them nothing.
    expect(paceOf({ distance: 33, duration: 66, totalHaltsBetween: 6 })).toBeNull();

    // Many stops but quick: equally contradictory.
    expect(paceOf({ distance: 33, duration: 42, totalHaltsBetween: 20 })).toBeNull();
  });

  it("says nothing in the gap between the clusters", () => {
    // 0.42 halts/km at 34 km/h — neither cluster, so no claim.
    expect(paceOf({ distance: 33, duration: 58, totalHaltsBetween: 14 })).toBeNull();
  });

  it("says nothing over a short hop, where the label would be useless", () => {
    // Over four kilometres a fast and a slow arrive within a minute of each
    // other. True, and not worth screen space.
    expect(paceOf({ distance: 4, duration: 8, totalHaltsBetween: 1 })).toBeNull();
  });

  it("survives the zeroes RailRadar sometimes returns", () => {
    expect(paceOf({ distance: 0, duration: 0, totalHaltsBetween: 0 })).toBeNull();
    expect(paceOf({ distance: 33, duration: 0, totalHaltsBetween: 20 })).toBeNull();
    expect(paceOf({ distance: Number.NaN, duration: 50, totalHaltsBetween: 7 })).toBeNull();
    expect(paceOf({ distance: 33, duration: 50, totalHaltsBetween: -1 })).toBeNull();
  });

  it("handles a non-stop run without dividing by nothing", () => {
    expect(paceOf({ distance: 33, duration: 40, totalHaltsBetween: 0 })).toBe("fast");
  });
});

describe("journeyPace", () => {
  it("keeps the label when every leg agrees", () => {
    expect(journeyPace(["fast", "fast"])).toBe("fast");
    expect(journeyPace(["slow"])).toBe("slow");
  });

  it("drops the label when the legs disagree", () => {
    // A fast leg followed by a slow one is not a fast journey, and saying so
    // would be the most misleading label available.
    expect(journeyPace(["fast", "slow"])).toBeNull();
    expect(journeyPace(["slow", "fast"])).toBeNull();
  });

  it("drops the label when any leg is unlabelled", () => {
    expect(journeyPace(["fast", null])).toBeNull();
    expect(journeyPace([null, "fast"])).toBeNull();
  });

  it("has nothing to say about no legs", () => {
    expect(journeyPace([])).toBeNull();
  });
});
