import { describe, expect, it } from "vitest";
import {
  DEFAULT_MINUTES_TO_REACH_STATION,
  pickBestTrain,
  type PickBestTrainInput,
} from "@/lib/bestTrain";
import type { TrainLeg } from "@/lib/railradar";
import { toMinutes } from "@/lib/time";

const EVERY_DAY = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

interface LegSpec {
  number: string;
  departure: string;
  arrival: string;
  /** RailRadar's 1-indexed day counter, measured from the train's own origin. */
  fromDay?: number;
  toDay?: number;
  runDays?: string[];
}

function leg({
  number,
  departure,
  arrival,
  fromDay = 1,
  toDay = 1,
  runDays = EVERY_DAY,
}: LegSpec): TrainLeg {
  return {
    train: {
      number,
      name: `Train ${number}`,
      type: "SUBURBAN",
      runDays,
    },
    from: {
      code: "BVI",
      name: "BORIVALI",
      city: "Mumbai",
      departure,
      day: fromDay,
      sequence: 1,
    },
    to: {
      code: "CCG",
      name: "BMBY CHURCH GTE",
      city: "Mumbai",
      arrival,
      day: toDay,
      sequence: 2,
    },
    distance: 34,
    duration: 60,
    totalHaltsBetween: 12,
  };
}

/** Defaults for a 09:00 class checked at 07:00 on a Tuesday. */
function pick(overrides: Partial<PickBestTrainInput> = {}) {
  return pickBestTrain({
    trains: [],
    classStartTime: "09:00",
    bufferMinutes: 15,
    journeyWeekday: "tue",
    nowMinutes: toMinutes("07:00"),
    ...overrides,
  });
}

describe("pickBestTrain - trains that have already left", () => {
  it("never returns a train that departed before now", () => {
    const result = pick({
      trains: [leg({ number: "A", departure: "06:15", arrival: "07:15" })],
      nowMinutes: toMinutes("08:30"),
      classStartTime: "10:00",
    });

    expect(result).toBeNull();
  });

  it("picks the latest still-boardable train, not the earliest arrival", () => {
    const result = pick({
      trains: [
        leg({ number: "GONE", departure: "06:15", arrival: "07:15" }),
        leg({ number: "CATCHABLE", departure: "08:50", arrival: "09:40" }),
      ],
      nowMinutes: toMinutes("08:30"),
      classStartTime: "10:00",
    });

    expect(result?.best.trainNumber).toBe("CATCHABLE");
    expect(result?.alternatives).toEqual([]);
  });

  it("holds the walk-to-the-station margin exactly at the boundary", () => {
    const nowMinutes = toMinutes("08:00");
    const margin = 10;
    // Departure is exactly now + margin: the last train that is still makeable.
    const onTheLine = leg({
      number: "EXACT",
      departure: "08:10",
      arrival: "08:40",
    });
    // One minute earlier is one minute too late to reach the platform.
    const justMissed = leg({
      number: "MISSED",
      departure: "08:09",
      arrival: "08:39",
    });

    expect(
      pick({
        trains: [onTheLine],
        nowMinutes,
        minutesToReachStation: margin,
        classStartTime: "09:00",
        bufferMinutes: 0,
      })?.best.trainNumber
    ).toBe("EXACT");

    expect(
      pick({
        trains: [justMissed],
        nowMinutes,
        minutesToReachStation: margin,
        classStartTime: "09:00",
        bufferMinutes: 0,
      })
    ).toBeNull();
  });

  it("defaults the margin to ten minutes", () => {
    expect(DEFAULT_MINUTES_TO_REACH_STATION).toBe(10);

    const trains = [leg({ number: "A", departure: "08:05", arrival: "08:35" })];
    // 08:05 is 5 minutes away - inside the default margin, so not catchable.
    expect(
      pick({ trains, nowMinutes: toMinutes("08:00"), bufferMinutes: 0 })
    ).toBeNull();
    // With the margin cut to zero it becomes catchable again.
    expect(
      pick({
        trains,
        nowMinutes: toMinutes("08:00"),
        bufferMinutes: 0,
        minutesToReachStation: 0,
      })?.best.trainNumber
    ).toBe("A");
  });
});

describe("pickBestTrain - ranking", () => {
  it("returns the latest qualifying train, not the first in the list", () => {
    const result = pick({
      trains: [
        leg({ number: "FIRST", departure: "07:10", arrival: "07:50" }),
        leg({ number: "LATEST", departure: "08:20", arrival: "08:44" }),
        leg({ number: "MIDDLE", departure: "07:40", arrival: "08:20" }),
        leg({ number: "TOO_LATE", departure: "08:30", arrival: "08:50" }),
      ],
    });

    // Cutoff is 08:45; TOO_LATE arrives at 08:50 and is out.
    expect(result?.best.trainNumber).toBe("LATEST");
    expect(result?.alternatives.map((a) => a.trainNumber)).toEqual([
      "MIDDLE",
      "FIRST",
    ]);
  });

  it("prefers the later departure even when an earlier train arrives sooner", () => {
    const result = pick({
      trains: [
        leg({ number: "FAST_EARLY", departure: "07:30", arrival: "08:00" }),
        leg({ number: "SLOW_LATE", departure: "07:50", arrival: "08:40" }),
      ],
    });

    expect(result?.best.trainNumber).toBe("SLOW_LATE");
  });

  it("breaks a departure tie on the earlier arrival", () => {
    const result = pick({
      trains: [
        leg({ number: "SLOW", departure: "08:00", arrival: "08:44" }),
        leg({ number: "FAST", departure: "08:00", arrival: "08:30" }),
      ],
    });

    expect(result?.best.trainNumber).toBe("FAST");
  });

  it("caps the backups at three", () => {
    const result = pick({
      trains: [
        leg({ number: "1", departure: "07:00", arrival: "07:40" }),
        leg({ number: "2", departure: "07:15", arrival: "07:55" }),
        leg({ number: "3", departure: "07:30", arrival: "08:10" }),
        leg({ number: "4", departure: "07:45", arrival: "08:25" }),
        leg({ number: "5", departure: "08:00", arrival: "08:40" }),
      ],
    });

    expect(result?.best.trainNumber).toBe("5");
    expect(result?.alternatives.map((a) => a.trainNumber)).toEqual([
      "4",
      "3",
      "2",
    ]);
  });

  it("returns however few backups exist, without padding", () => {
    const result = pick({
      trains: [
        leg({ number: "1", departure: "07:30", arrival: "08:10" }),
        leg({ number: "2", departure: "08:00", arrival: "08:40" }),
      ],
    });

    expect(result?.best.trainNumber).toBe("2");
    expect(result?.alternatives.map((a) => a.trainNumber)).toEqual(["1"]);
  });

  it("returns a best with no backups at all when only one train qualifies", () => {
    const result = pick({
      trains: [leg({ number: "ONLY", departure: "07:30", arrival: "08:10" })],
    });

    expect(result?.best.trainNumber).toBe("ONLY");
    expect(result?.alternatives).toEqual([]);
  });
});

describe("pickBestTrain - run days", () => {
  it("drops trains that do not run on the journey's weekday", () => {
    const result = pick({
      trains: [
        leg({
          number: "WEEKDAYS",
          departure: "08:00",
          arrival: "08:40",
          runDays: ["mon", "tue", "wed", "thu", "fri"],
        }),
        leg({
          number: "WEEKENDS",
          departure: "08:20",
          arrival: "08:44",
          runDays: ["sat", "sun"],
        }),
      ],
    });

    expect(result?.best.trainNumber).toBe("WEEKDAYS");
  });

  it("filters on tomorrow's weekday when the journey is tomorrow", () => {
    const trains = [
      leg({
        number: "TUE_ONLY",
        departure: "08:00",
        arrival: "08:40",
        runDays: ["tue"],
      }),
      leg({
        number: "WED_ONLY",
        departure: "08:20",
        arrival: "08:44",
        runDays: ["wed"],
      }),
    ];

    // Checked late on Tuesday for a Wednesday 09:00 class: it is Wednesday's
    // timetable that matters, and nothing has "already departed" yet.
    const tomorrow = pick({
      trains,
      journeyWeekday: "wed",
      nowMinutes: null,
    });
    expect(tomorrow?.best.trainNumber).toBe("WED_ONLY");

    const today = pick({ trains, journeyWeekday: "tue" });
    expect(today?.best.trainNumber).toBe("TUE_ONLY");
  });

  it("offers a train that already departed today when the journey is tomorrow", () => {
    const result = pick({
      trains: [leg({ number: "EARLY", departure: "06:15", arrival: "07:15" })],
      nowMinutes: null,
      classStartTime: "09:00",
    });

    expect(result?.best.trainNumber).toBe("EARLY");
  });
});

describe("pickBestTrain - the buffer", () => {
  it("reports the minutes left before class", () => {
    const result = pick({
      trains: [leg({ number: "A", departure: "07:30", arrival: "08:10" })],
    });

    expect(result?.best.bufferRemainingMinutes).toBe(50);
  });

  it("accepts a zero buffer, up to arriving exactly at class time", () => {
    const result = pick({
      trains: [
        leg({ number: "ON_THE_BELL", departure: "08:20", arrival: "09:00" }),
        leg({ number: "ONE_LATE", departure: "08:25", arrival: "09:01" }),
      ],
      bufferMinutes: 0,
    });

    expect(result?.best.trainNumber).toBe("ON_THE_BELL");
    expect(result?.best.bufferRemainingMinutes).toBe(0);
  });

  it("returns null when the buffer swallows the whole window", () => {
    const result = pick({
      trains: [
        leg({ number: "A", departure: "07:00", arrival: "07:40" }),
        leg({ number: "B", departure: "08:00", arrival: "08:40" }),
      ],
      bufferMinutes: 240,
    });

    // Cutoff would be 05:00, before either of these trains even runs.
    expect(result).toBeNull();
  });

  it("returns null cleanly rather than throwing when nothing qualifies", () => {
    expect(() => pick({ trains: [] })).not.toThrow();
    expect(pick({ trains: [] })).toBeNull();
    expect(
      pick({
        trains: [leg({ number: "LATE", departure: "09:30", arrival: "10:10" })],
      })
    ).toBeNull();
  });
});

describe("pickBestTrain - journeys that cross midnight", () => {
  it("does not mistake a 23:50 to 00:20 train for an early-morning arrival", () => {
    const result = pick({
      trains: [
        leg({ number: "MORNING", departure: "07:30", arrival: "08:10" }),
        // Arrives at 00:20 the *next* day. Compared as "HH:MM" alone this would
        // look like the earliest arrival of the lot and win outright.
        leg({
          number: "OVERNIGHT",
          departure: "23:50",
          arrival: "00:20",
          toDay: 2,
        }),
      ],
      nowMinutes: null,
    });

    expect(result?.best.trainNumber).toBe("MORNING");
    expect(result?.alternatives).toEqual([]);
  });

  it("sorts a post-midnight arrival after the same evening's trains", () => {
    const result = pick({
      trains: [
        leg({ number: "EVENING", departure: "22:00", arrival: "22:40" }),
        leg({
          number: "OVERNIGHT",
          departure: "23:50",
          arrival: "00:20",
          toDay: 2,
        }),
      ],
      classStartTime: "23:00",
      bufferMinutes: 0,
      nowMinutes: null,
    });

    // Only EVENING arrives before a 23:00 class; OVERNIGHT lands at 00:20 the
    // following day, which is 1460 minutes in, not 20.
    expect(result?.best.trainNumber).toBe("EVENING");
    expect(result?.best.bufferRemainingMinutes).toBe(20);
  });

  it("scores a leg boarded on the train's second day from the boarding time", () => {
    // A long-distance train that left its origin yesterday: it reaches our home
    // station at 05:00 on its day 2 and our college station at 06:00 the same
    // morning. Both stops carry day 2, so the journey is one hour, not 25.
    const result = pick({
      trains: [
        leg({
          number: "OVERNIGHT_EXPRESS",
          departure: "05:00",
          arrival: "06:00",
          fromDay: 2,
          toDay: 2,
        }),
      ],
      nowMinutes: null,
    });

    expect(result?.best.trainNumber).toBe("OVERNIGHT_EXPRESS");
    expect(result?.best.bufferRemainingMinutes).toBe(180);
  });

  it("keeps a day-crossing leg one day long, not two", () => {
    const result = pick({
      trains: [
        leg({
          number: "CROSSES",
          departure: "23:50",
          arrival: "00:20",
          fromDay: 2,
          toDay: 3,
        }),
      ],
      classStartTime: "23:00",
      bufferMinutes: 0,
      nowMinutes: null,
    });

    // Boarding at 23:50 puts the arrival at 00:20 the next day - past a 23:00
    // class either way, so it is rejected rather than rebased onto day 1.
    expect(result).toBeNull();
  });
});

describe("pickBestTrain - the returned shape", () => {
  it("passes the train's own fields through untouched", () => {
    const result = pick({
      trains: [leg({ number: "12345", departure: "07:30", arrival: "08:10" })],
    });

    expect(result?.best).toEqual({
      trainNumber: "12345",
      trainName: "Train 12345",
      trainType: "SUBURBAN",
      departure: "07:30",
      arrival: "08:10",
      bufferRemainingMinutes: 50,
    });
  });

  it("does not mutate the trains it was given", () => {
    const trains = [
      leg({ number: "1", departure: "07:00", arrival: "07:40" }),
      leg({ number: "2", departure: "08:00", arrival: "08:40" }),
    ];
    const snapshot = structuredClone(trains);

    pick({ trains });

    expect(trains).toEqual(snapshot);
  });
});
