import { describe, expect, it } from "vitest";
// Imported through the `@/` alias on purpose: this test doubles as the check
// that path resolution works under Vitest.
import { formatBufferMinutes, formatTime12h } from "@/lib/format";

describe("formatTime12h", () => {
  it("formats an afternoon time in 12-hour form", () => {
    expect(formatTime12h("14:05")).toBe("2:05 PM");
  });

  // The two hours that a modulo gets wrong: midnight is 12 AM, not 0 AM, and
  // noon is 12 PM, not 0 PM or 12 AM.
  it("calls midnight 12 AM", () => {
    expect(formatTime12h("00:00")).toBe("12:00 AM");
    expect(formatTime12h("00:30")).toBe("12:30 AM");
  });

  it("calls noon 12 PM", () => {
    expect(formatTime12h("12:00")).toBe("12:00 PM");
    expect(formatTime12h("12:30")).toBe("12:30 PM");
  });

  it("formats the last minute of the day", () => {
    expect(formatTime12h("23:59")).toBe("11:59 PM");
  });

  it("keeps a leading zero on the minutes", () => {
    expect(formatTime12h("09:05")).toBe("9:05 AM");
    expect(formatTime12h("13:00")).toBe("1:00 PM");
  });
});

describe("formatBufferMinutes", () => {
  it("leaves a sub-hour buffer in minutes", () => {
    expect(formatBufferMinutes(45)).toBe("45 min");
  });

  it("shows zero minutes rather than nothing", () => {
    expect(formatBufferMinutes(0)).toBe("0 min");
  });

  it("drops the minutes on a whole number of hours", () => {
    expect(formatBufferMinutes(60)).toBe("1h");
    expect(formatBufferMinutes(120)).toBe("2h");
  });

  it("splits hours and minutes past the hour", () => {
    expect(formatBufferMinutes(75)).toBe("1h 15m");
    expect(formatBufferMinutes(59)).toBe("59 min");
  });
});
