import { describe, expect, it } from "vitest";
import {
  MINUTES_PER_DAY,
  dateInMumbai,
  effectiveMinutes,
  guessJourneyDay,
  minutesSinceMidnight,
  nowInMumbai,
  resolveJourney,
  toMinutes,
  weekdayInMumbai,
} from "@/lib/time";

// Every instant below is written in UTC on purpose. IST is UTC+5:30, so an
// instant late in the UTC day is already the next calendar day in Mumbai —
// which is exactly the window where reading the server's clock goes wrong.
const TUE_2330_IST = new Date("2026-09-08T18:00:00Z"); // Tue 8 Sep, 23:30 IST
const WED_0005_IST = new Date("2026-09-08T18:35:00Z"); // Wed 9 Sep, 00:05 IST (still Tue in UTC)
const TUE_0830_IST = new Date("2026-09-08T03:00:00Z"); // Tue 8 Sep, 08:30 IST
const FRI_0030_IST = new Date("2026-12-31T19:00:00Z"); // Fri 1 Jan 2027, 00:30 IST (still 2026 in UTC)
const SUN_0130_IST = new Date("2026-02-28T20:00:00Z"); // Sun 1 Mar 2026, 01:30 IST

describe("nowInMumbai", () => {
  it("reads the Mumbai wall clock, not the server's", () => {
    expect(nowInMumbai(TUE_2330_IST)).toEqual({
      date: "2026-09-08",
      weekday: "tue",
      hhmm: "23:30",
      minutes: 23 * 60 + 30,
    });
  });

  it("is already on the next calendar day while UTC is not", () => {
    expect(nowInMumbai(WED_0005_IST)).toEqual({
      date: "2026-09-09",
      weekday: "wed",
      hhmm: "00:05",
      minutes: 5,
    });
  });

  it("renders midnight as 00, not 24", () => {
    // 18:30Z is exactly 00:00 IST.
    expect(nowInMumbai(new Date("2026-09-08T18:30:00Z")).hhmm).toBe("00:00");
    expect(nowInMumbai(new Date("2026-09-08T18:30:00Z")).minutes).toBe(0);
  });
});

describe("minutesSinceMidnight", () => {
  it("counts from Mumbai midnight", () => {
    expect(minutesSinceMidnight(TUE_0830_IST)).toBe(510);
    expect(minutesSinceMidnight(WED_0005_IST)).toBe(5);
  });
});

describe("weekdayInMumbai", () => {
  it("returns the lowercase 3-letter form runDays uses", () => {
    expect(weekdayInMumbai(0, TUE_0830_IST)).toBe("tue");
  });

  it("advances to tomorrow in Mumbai", () => {
    expect(weekdayInMumbai(1, TUE_2330_IST)).toBe("wed");
  });

  it("uses the Mumbai date, not the UTC one, near midnight", () => {
    // UTC still says Tuesday here; Mumbai is on Wednesday, so tomorrow is Thursday.
    expect(weekdayInMumbai(0, WED_0005_IST)).toBe("wed");
    expect(weekdayInMumbai(1, WED_0005_IST)).toBe("thu");
  });

  it("rolls over a year boundary", () => {
    expect(weekdayInMumbai(0, FRI_0030_IST)).toBe("fri");
    expect(weekdayInMumbai(1, FRI_0030_IST)).toBe("sat");
  });

  it("rolls over a month boundary", () => {
    expect(weekdayInMumbai(0, SUN_0130_IST)).toBe("sun");
    expect(weekdayInMumbai(1, SUN_0130_IST)).toBe("mon");
  });
});

describe("dateInMumbai", () => {
  it("returns the Mumbai calendar date, not the UTC one", () => {
    expect(dateInMumbai(0, TUE_2330_IST)).toBe("2026-09-08");
    // UTC still says 8 Sep here; Mumbai has already turned over.
    expect(dateInMumbai(0, WED_0005_IST)).toBe("2026-09-09");
  });

  it("advances by whole calendar days", () => {
    expect(dateInMumbai(1, TUE_2330_IST)).toBe("2026-09-09");
    expect(dateInMumbai(1, WED_0005_IST)).toBe("2026-09-10");
  });

  it("rolls over month and year ends", () => {
    expect(dateInMumbai(0, FRI_0030_IST)).toBe("2027-01-01");
    expect(dateInMumbai(1, FRI_0030_IST)).toBe("2027-01-02");
    expect(dateInMumbai(0, SUN_0130_IST)).toBe("2026-03-01");
  });

  it("agrees with the date nowInMumbai reports", () => {
    for (const instant of [TUE_2330_IST, WED_0005_IST, FRI_0030_IST, SUN_0130_IST]) {
      expect(dateInMumbai(0, instant)).toBe(nowInMumbai(instant).date);
    }
  });
});

describe("toMinutes", () => {
  it("parses a 24-hour wall clock string", () => {
    expect(toMinutes("00:00")).toBe(0);
    expect(toMinutes("09:05")).toBe(545);
    expect(toMinutes("23:59")).toBe(1439);
  });
});

describe("effectiveMinutes", () => {
  it("leaves day 1 alone", () => {
    expect(effectiveMinutes("23:50", 1)).toBe(1430);
  });

  it("pushes a day-2 time past midnight rather than before the departure", () => {
    expect(effectiveMinutes("00:20", 2)).toBe(MINUTES_PER_DAY + 20);
    expect(effectiveMinutes("00:20", 2)).toBeGreaterThan(
      effectiveMinutes("23:50", 1)
    );
  });
});

describe("guessJourneyDay", () => {
  it("stays on today while the class is still ahead", () => {
    expect(guessJourneyDay("09:00", toMinutes("08:30"))).toBe("today");
  });

  it("rolls to tomorrow once the class time has passed", () => {
    expect(guessJourneyDay("09:00", toMinutes("23:00"))).toBe("tomorrow");
  });

  it("treats a class starting exactly now as tomorrow's", () => {
    expect(guessJourneyDay("09:00", toMinutes("09:00"))).toBe("tomorrow");
  });
});

describe("resolveJourney", () => {
  it("keeps a still-upcoming class on today, with now on the timeline", () => {
    expect(resolveJourney("10:00", undefined, TUE_0830_IST)).toEqual({
      day: "today",
      date: "2026-09-08",
      weekday: "tue",
      nowMinutes: 510,
    });
  });

  it("moves a passed class to tomorrow and drops now", () => {
    // 23:30 Tuesday, asking about a 09:00 class: that class is Wednesday's.
    expect(resolveJourney("09:00", undefined, TUE_2330_IST)).toEqual({
      day: "tomorrow",
      // The journey date advances with the day, which is what the upstream
      // cache is keyed on — Tuesday's timetable must not answer Wednesday.
      date: "2026-09-09",
      weekday: "wed",
      nowMinutes: null,
    });
  });

  it("lets an explicit override beat the guess in both directions", () => {
    expect(resolveJourney("09:00", "today", TUE_2330_IST)).toEqual({
      day: "today",
      date: "2026-09-08",
      weekday: "tue",
      nowMinutes: 1410,
    });
    expect(resolveJourney("10:00", "tomorrow", TUE_0830_IST)).toEqual({
      day: "tomorrow",
      date: "2026-09-09",
      weekday: "wed",
      nowMinutes: null,
    });
  });
});
