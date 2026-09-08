import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRANSFER_MINUTES,
  INTERCHANGE_PENALTY_MINUTES,
  MAX_INTERCHANGE_WAIT_MINUTES,
  directJourneys,
  interchangeJourneys,
  pickBestJourney,
  type JourneyContext,
} from "@/lib/journeys";
import type { TrainLeg } from "@/lib/railradar";
import { toMinutes } from "@/lib/time";

const EVERY_DAY = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

interface LegSpec {
  number: string;
  departure: string;
  arrival: string;
  from?: string;
  to?: string;
  fromDay?: number;
  toDay?: number;
  runDays?: string[];
}

function leg({
  number,
  departure,
  arrival,
  from = "BVI",
  to = "CCG",
  fromDay = 1,
  toDay = 1,
  runDays = EVERY_DAY,
}: LegSpec): TrainLeg {
  return {
    train: { number, name: `Train ${number}`, type: "EMU", runDays },
    from: {
      code: from,
      name: from,
      city: "Mumbai",
      departure,
      day: fromDay,
      sequence: 1,
    },
    to: { code: to, name: to, city: "Mumbai", arrival, day: toDay, sequence: 2 },
    distance: 30,
    duration: 45,
    totalHaltsBetween: 10,
  };
}

/** A 09:00 class, checked at 07:00 on a Tuesday, 15 minutes of buffer. */
function context(overrides: Partial<JourneyContext> = {}): JourneyContext {
  return {
    classStartTime: "09:00",
    bufferMinutes: 15,
    journeyWeekday: "tue",
    nowMinutes: toMinutes("07:00"),
    ...overrides,
  };
}

describe("directJourneys", () => {
  it("turns each direct train into a one-leg journey", () => {
    const [candidate] = directJourneys(
      [leg({ number: "A", departure: "07:30", arrival: "08:20" })],
      context()
    );

    expect(candidate.journey.kind).toBe("direct");
    expect(candidate.journey.legs).toHaveLength(1);
    expect(candidate.journey.departure).toBe("07:30");
    expect(candidate.journey.arrival).toBe("08:20");
    expect(candidate.journey.totalMinutes).toBe(50);
    expect(candidate.journey.bufferRemainingMinutes).toBe(40);
  });

  it("drops trains that do not run on the journey's weekday", () => {
    const candidates = directJourneys(
      [leg({ number: "A", departure: "07:30", arrival: "08:20", runDays: ["sat"] })],
      context()
    );
    expect(candidates).toEqual([]);
  });

  it("rebases a leg boarded on the train's second day", () => {
    // Both stops carry day 2, so the journey is one hour, not twenty-five.
    const [candidate] = directJourneys(
      [
        leg({
          number: "A",
          departure: "07:00",
          arrival: "08:00",
          fromDay: 2,
          toDay: 2,
        }),
      ],
      context()
    );
    expect(candidate.journey.totalMinutes).toBe(60);
  });
});

describe("interchangeJourneys", () => {
  const options = { interchangeName: "Dadar" };

  it("joins two legs into one journey with a change", () => {
    const [candidate] = interchangeJourneys(
      [leg({ number: "L1", departure: "07:30", arrival: "07:55", to: "DDR" })],
      [leg({ number: "L2", departure: "08:10", arrival: "08:35", from: "DR" })],
      context(),
      options
    );

    expect(candidate.journey.kind).toBe("interchange");
    expect(candidate.journey.legs.map((l) => l.trainNumber)).toEqual(["L1", "L2"]);
    expect(candidate.journey.departure).toBe("07:30");
    expect(candidate.journey.arrival).toBe("08:35");
    expect(candidate.journey.change).toEqual({ name: "Dadar", waitMinutes: 15 });
    // Door to door, including the wait on the platform.
    expect(candidate.journey.totalMinutes).toBe(65);
  });

  it("refuses a connection that does not allow time to make the change", () => {
    // Off at 07:55, on at 07:59: four minutes across a footbridge in a crowd.
    const candidates = interchangeJourneys(
      [leg({ number: "L1", departure: "07:30", arrival: "07:55", to: "DDR" })],
      [leg({ number: "L2", departure: "07:59", arrival: "08:25", from: "DR" })],
      context(),
      options
    );
    expect(candidates).toEqual([]);
  });

  it("accepts a connection exactly at the transfer minimum", () => {
    const [candidate] = interchangeJourneys(
      [leg({ number: "L1", departure: "07:30", arrival: "07:55", to: "DDR" })],
      [leg({ number: "L2", departure: "08:03", arrival: "08:30", from: "DR" })],
      context(),
      { ...options, transferMinutes: DEFAULT_TRANSFER_MINUTES }
    );
    expect(candidate?.journey.change?.waitMinutes).toBe(8);
  });

  it("honours a harder interchange's longer transfer", () => {
    // Dadar's bridge at rush hour is ten minutes, not eight.
    const candidates = interchangeJourneys(
      [leg({ number: "L1", departure: "07:30", arrival: "07:55", to: "DDR" })],
      [leg({ number: "L2", departure: "08:04", arrival: "08:30", from: "DR" })],
      context(),
      { ...options, transferMinutes: 10 }
    );
    expect(candidates).toEqual([]);
  });

  it("takes the earliest boardable second train, not just any", () => {
    const [candidate] = interchangeJourneys(
      [leg({ number: "L1", departure: "07:30", arrival: "07:55", to: "DDR" })],
      [
        leg({ number: "LATE", departure: "08:20", arrival: "08:45", from: "DR" }),
        leg({ number: "SOON", departure: "08:05", arrival: "08:30", from: "DR" }),
      ],
      context(),
      options
    );

    // A later second leg arrives later for the same departure, so it is
    // dominated and never worth offering.
    expect(candidate.journey.legs[1].trainNumber).toBe("SOON");
  });

  it("refuses to leave someone standing on a platform for half an hour", () => {
    const candidates = interchangeJourneys(
      [leg({ number: "L1", departure: "07:00", arrival: "07:20", to: "DDR" })],
      [leg({ number: "L2", departure: "08:00", arrival: "08:25", from: "DR" })],
      context(),
      options
    );

    // Forty minutes at Dadar is worse than leaving home forty minutes later.
    expect(candidates).toEqual([]);
    expect(MAX_INTERCHANGE_WAIT_MINUTES).toBe(30);
  });

  it("drops a leg that does not run on the journey's weekday", () => {
    expect(
      interchangeJourneys(
        [leg({ number: "L1", departure: "07:30", arrival: "07:55", runDays: ["sat"] })],
        [leg({ number: "L2", departure: "08:10", arrival: "08:35" })],
        context(),
        options
      )
    ).toEqual([]);

    expect(
      interchangeJourneys(
        [leg({ number: "L1", departure: "07:30", arrival: "07:55" })],
        [leg({ number: "L2", departure: "08:10", arrival: "08:35", runDays: ["sat"] })],
        context(),
        options
      )
    ).toEqual([]);
  });

  it("returns nothing when either leg has no service", () => {
    expect(
      interchangeJourneys([], [leg({ number: "L2", departure: "08:10", arrival: "08:35" })], context(), options)
    ).toEqual([]);
    expect(
      interchangeJourneys([leg({ number: "L1", departure: "07:30", arrival: "07:55" })], [], context(), options)
    ).toEqual([]);
  });
});

describe("ranking direct against interchange — the asymmetry", () => {
  const options = { interchangeName: "Dadar" };

  // A 10:00 class, so that every journey built below arrives comfortably before
  // the cutoff and the comparison is purely about ranking, not eligibility.
  const rankCtx = context({ classStartTime: "10:00" });

  /** A direct train departing at `departure`, arriving 40 minutes later. */
  function directAt(departure: string, number = "DIRECT") {
    const [h, m] = departure.split(":").map(Number);
    const arriveMinutes = h * 60 + m + 40;
    const arrival = `${String(Math.floor(arriveMinutes / 60)).padStart(2, "0")}:${String(
      arriveMinutes % 60
    ).padStart(2, "0")}`;
    return directJourneys([leg({ number, departure, arrival })], rankCtx);
  }

  /** An interchange journey departing at `departure`, arriving 40 minutes later. */
  function viaAt(departure: string) {
    const [h, m] = departure.split(":").map(Number);
    const mid = h * 60 + m + 20;
    const midTime = `${String(Math.floor(mid / 60)).padStart(2, "0")}:${String(
      mid % 60
    ).padStart(2, "0")}`;
    const second = mid + 10;
    const secondTime = `${String(Math.floor(second / 60)).padStart(2, "0")}:${String(
      second % 60
    ).padStart(2, "0")}`;
    const end = h * 60 + m + 40;
    const endTime = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(
      end % 60
    ).padStart(2, "0")}`;

    return interchangeJourneys(
      [leg({ number: "VIA1", departure, arrival: midTime, to: "DDR" })],
      [leg({ number: "VIA2", departure: secondTime, arrival: endTime, from: "DR" })],
      rankCtx,
      options
    );
  }

  it("prefers a direct train that leaves only slightly earlier", () => {
    // 08:00 direct vs 08:10 with a change. Ten minutes of extra sleep is not
    // worth a connection that can be missed.
    const pick = pickBestJourney([...directAt("08:00"), ...viaAt("08:10")], rankCtx);

    expect(pick?.best.kind).toBe("direct");
    expect(pick?.best.departure).toBe("08:00");
  });

  it("prefers the interchange once it is substantially better", () => {
    // 08:00 direct vs 08:20 with a change: twenty minutes clears the fifteen
    // minute penalty, so the change genuinely buys something.
    const pick = pickBestJourney([...directAt("08:00"), ...viaAt("08:20")], rankCtx);

    expect(pick?.best.kind).toBe("interchange");
    expect(pick?.best.departure).toBe("08:20");
  });

  it("puts the tipping point exactly at the penalty", () => {
    // At exactly the penalty the two score equal, and the tie-break prefers the
    // earlier arrival, then the journey with fewer things to go wrong.
    const atPenalty = pickBestJourney(
      [
        ...directAt("08:00"),
        ...viaAt(`08:${String(INTERCHANGE_PENALTY_MINUTES).padStart(2, "0")}`),
      ],
      rankCtx
    );
    expect(atPenalty?.best.kind).toBe("direct");

    // One minute past it, the interchange wins.
    const pastPenalty = pickBestJourney(
      [
        ...directAt("08:00"),
        ...viaAt(`08:${String(INTERCHANGE_PENALTY_MINUTES + 1).padStart(2, "0")}`),
      ],
      rankCtx
    );
    expect(pastPenalty?.best.kind).toBe("interchange");
  });

  it("is fifteen minutes, roughly one train's recovery in the peak", () => {
    expect(INTERCHANGE_PENALTY_MINUTES).toBe(15);
  });

  it("still returns an interchange when there is no direct train at all", () => {
    // The journey this feature exists for: RailRadar has nothing, so the change
    // is not competing with anything.
    const pick = pickBestJourney(viaAt("08:00"), rankCtx);

    expect(pick?.best.kind).toBe("interchange");
    expect(pick?.best.change?.name).toBe("Dadar");
  });

  it("does not penalise a direct train into losing to nothing", () => {
    const pick = pickBestJourney(directAt("08:00"), rankCtx);
    expect(pick?.best.kind).toBe("direct");
  });
});

describe("pickBestJourney", () => {
  it("never offers a journey that has already departed", () => {
    const pick = pickBestJourney(
      directJourneys(
        [leg({ number: "GONE", departure: "06:15", arrival: "07:00" })],
        context({ nowMinutes: toMinutes("08:00") })
      ),
      context({ nowMinutes: toMinutes("08:00") })
    );
    expect(pick).toBeNull();
  });

  it("holds the walk-to-the-station margin", () => {
    const ctx = context({ nowMinutes: toMinutes("08:00"), bufferMinutes: 0 });

    expect(
      pickBestJourney(
        directJourneys([leg({ number: "A", departure: "08:10", arrival: "08:50" })], ctx),
        ctx
      )?.best.departure
    ).toBe("08:10");

    expect(
      pickBestJourney(
        directJourneys([leg({ number: "A", departure: "08:09", arrival: "08:50" })], ctx),
        ctx
      )
    ).toBeNull();
  });

  it("offers everything when the journey is a future date", () => {
    const ctx = context({ nowMinutes: null });
    const pick = pickBestJourney(
      directJourneys([leg({ number: "EARLY", departure: "06:15", arrival: "07:00" })], ctx),
      ctx
    );
    expect(pick?.best.departure).toBe("06:15");
  });

  it("returns null cleanly rather than throwing", () => {
    expect(() => pickBestJourney([], context())).not.toThrow();
    expect(pickBestJourney([], context())).toBeNull();
  });

  it("offers one option per departure-and-arrival pair", () => {
    // Seen on live data: two Borivali departures at the same minute catching
    // the same connection at Dadar, rendering as two identical-looking cards.
    const candidates = directJourneys(
      [
        leg({ number: "FAST", departure: "08:00", arrival: "08:40" }),
        leg({ number: "SLOW", departure: "08:00", arrival: "08:40" }),
        leg({ number: "OTHER", departure: "07:30", arrival: "08:10" }),
      ],
      context()
    );

    const pick = pickBestJourney(candidates, context());
    expect(pick?.best.legs[0].trainNumber).toBe("FAST");
    expect(pick?.alternatives).toHaveLength(1);
    expect(pick?.alternatives[0].legs[0].trainNumber).toBe("OTHER");
  });

  it("keeps two options that differ in arrival even at the same departure", () => {
    const candidates = directJourneys(
      [
        leg({ number: "FAST", departure: "08:00", arrival: "08:30" }),
        leg({ number: "SLOW", departure: "08:00", arrival: "08:44" }),
      ],
      context()
    );

    const pick = pickBestJourney(candidates, context());
    expect(pick?.best.legs[0].trainNumber).toBe("FAST");
    expect(pick?.alternatives).toHaveLength(1);
  });

  it("caps the backups at three", () => {
    const candidates = directJourneys(
      [
        leg({ number: "1", departure: "07:00", arrival: "07:40" }),
        leg({ number: "2", departure: "07:15", arrival: "07:55" }),
        leg({ number: "3", departure: "07:30", arrival: "08:10" }),
        leg({ number: "4", departure: "07:45", arrival: "08:25" }),
        leg({ number: "5", departure: "08:00", arrival: "08:40" }),
      ],
      context()
    );

    const pick = pickBestJourney(candidates, context());
    expect(pick?.best.legs[0].trainNumber).toBe("5");
    expect(pick?.alternatives).toHaveLength(3);
  });
});
