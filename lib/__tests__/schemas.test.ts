import { describe, expect, it } from "vitest";
import {
  bestTrainQuerySchema,
  bestTrainRequestSchema,
  firstIssueMessage,
  stationSearchQuerySchema,
} from "@/lib/schemas";

const VALID = {
  fromCode: "BVI",
  toCode: "CCG",
  classStartTime: "09:00",
  bufferMinutes: 20,
};

function messageFor(body: unknown): string {
  const parsed = bestTrainRequestSchema.safeParse(body);
  expect(parsed.success).toBe(false);
  if (parsed.success) throw new Error("unreachable");
  return firstIssueMessage(parsed.error);
}

describe("bestTrainRequestSchema", () => {
  it("accepts a well-formed request and leaves journeyDay optional", () => {
    const parsed = bestTrainRequestSchema.safeParse(VALID);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.journeyDay).toBeUndefined();
  });

  it("trims the station codes and the class time", () => {
    const parsed = bestTrainRequestSchema.safeParse({
      ...VALID,
      fromCode: "  BVI ",
      classStartTime: " 09:00 ",
    });

    expect(parsed.success && parsed.data.fromCode).toBe("BVI");
    expect(parsed.success && parsed.data.classStartTime).toBe("09:00");
  });

  it("accepts either journey day", () => {
    for (const journeyDay of ["today", "tomorrow"] as const) {
      const parsed = bestTrainRequestSchema.safeParse({ ...VALID, journeyDay });
      expect(parsed.success && parsed.data.journeyDay).toBe(journeyDay);
    }
  });

  it("rejects anything else as a journey day", () => {
    expect(messageFor({ ...VALID, journeyDay: "someday" })).toBe(
      "Please choose whether your class is today or tomorrow."
    );
  });

  // The messages below go straight onto a student's screen, so they are asserted
  // verbatim: a zod default leaking through here would be a user-visible bug.
  it("asks for both stations when one is missing or blank", () => {
    const expected =
      "Please select both a home and college station from the suggestions.";

    expect(messageFor({ ...VALID, fromCode: undefined })).toBe(expected);
    expect(messageFor({ ...VALID, toCode: "   " })).toBe(expected);
    expect(messageFor({ ...VALID, fromCode: 42 })).toBe(expected);
  });

  it("rejects two identical stations, case-insensitively", () => {
    expect(messageFor({ ...VALID, toCode: "bvi" })).toBe(
      "Home and college station can't be the same."
    );
  });

  it("rejects a class time that is not a 24-hour HH:MM", () => {
    const expected = "Please enter a valid class start time.";

    expect(messageFor({ ...VALID, classStartTime: "" })).toBe(expected);
    expect(messageFor({ ...VALID, classStartTime: "9:00" })).toBe(expected);
    expect(messageFor({ ...VALID, classStartTime: "24:00" })).toBe(expected);
    expect(messageFor({ ...VALID, classStartTime: "09:60" })).toBe(expected);
    expect(messageFor({ ...VALID, classStartTime: "0900" })).toBe(expected);
  });

  it("accepts the ends of the clock", () => {
    for (const classStartTime of ["00:00", "23:59"]) {
      expect(
        bestTrainRequestSchema.safeParse({ ...VALID, classStartTime }).success
      ).toBe(true);
    }
  });

  it("holds the buffer between 0 and 240 minutes", () => {
    const expected = "Buffer time must be between 0 and 240 minutes.";

    expect(messageFor({ ...VALID, bufferMinutes: -1 })).toBe(expected);
    expect(messageFor({ ...VALID, bufferMinutes: 241 })).toBe(expected);
    expect(messageFor({ ...VALID, bufferMinutes: "20" })).toBe(expected);
    expect(messageFor({ ...VALID, bufferMinutes: Number.NaN })).toBe(expected);

    for (const bufferMinutes of [0, 240]) {
      expect(
        bestTrainRequestSchema.safeParse({ ...VALID, bufferMinutes }).success
      ).toBe(true);
    }
  });

  it("rejects a fractional buffer", () => {
    expect(messageFor({ ...VALID, bufferMinutes: 20.5 })).toBe(
      "Buffer time must be a whole number of minutes."
    );
  });

  it("rejects a body that is not an object at all", () => {
    for (const body of [null, "hello", 7, ["BVI", "CCG"]]) {
      expect(messageFor(body)).toBe("Invalid request.");
    }
  });
});

describe("bestTrainQuerySchema", () => {
  // The GET form is what the client actually calls, because only a GET can be
  // edge-cached. It must accept the same things and reject the same things.
  const VALID_QUERY = { ...VALID, bufferMinutes: "20" };

  function queryMessage(query: unknown): string {
    const parsed = bestTrainQuerySchema.safeParse(query);
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("unreachable");
    return firstIssueMessage(parsed.error);
  }

  it("coerces the buffer out of the query string", () => {
    const parsed = bestTrainQuerySchema.safeParse(VALID_QUERY);
    expect(parsed.success && parsed.data.bufferMinutes).toBe(20);
    expect(parsed.success && typeof parsed.data.bufferMinutes).toBe("number");
  });

  it("accepts the ends of the buffer range", () => {
    for (const bufferMinutes of ["0", "240"]) {
      expect(
        bestTrainQuerySchema.safeParse({ ...VALID, bufferMinutes }).success
      ).toBe(true);
    }
  });

  it("rejects a buffer that is not a plain integer", () => {
    const expected = "Buffer time must be between 0 and 240 minutes.";

    for (const bufferMinutes of ["", "abc", "20.5", "1e3", "  ", "NaN"]) {
      expect(queryMessage({ ...VALID, bufferMinutes })).toBe(expected);
    }
    expect(queryMessage({ ...VALID, bufferMinutes: "241" })).toBe(expected);
    expect(queryMessage({ ...VALID, bufferMinutes: "-1" })).toBe(expected);
  });

  it("shares its user-facing copy with the body form", () => {
    expect(queryMessage({ ...VALID_QUERY, classStartTime: "9:00" })).toBe(
      "Please enter a valid class start time."
    );
    expect(queryMessage({ ...VALID_QUERY, toCode: "bvi" })).toBe(
      "Home and college station can't be the same."
    );
    expect(queryMessage({ ...VALID_QUERY, fromCode: "" })).toBe(
      "Please select both a home and college station from the suggestions."
    );
  });

  it("treats a missing journeyDay as 'work it out'", () => {
    const parsed = bestTrainQuerySchema.safeParse({
      ...VALID_QUERY,
      journeyDay: undefined,
    });
    expect(parsed.success && parsed.data.journeyDay).toBeUndefined();
  });
});

describe("stationSearchQuerySchema", () => {
  it("trims the query", () => {
    const parsed = stationSearchQuerySchema.safeParse({ q: "  bori " });
    expect(parsed.success && parsed.data.q).toBe("bori");
  });

  it("allows an empty query through for the route to short-circuit", () => {
    expect(stationSearchQuerySchema.safeParse({ q: "" }).success).toBe(true);
  });

  it("rejects an absurdly long query rather than spending an upstream call", () => {
    const parsed = stationSearchQuerySchema.safeParse({ q: "a".repeat(65) });

    expect(parsed.success).toBe(false);
    expect(!parsed.success && firstIssueMessage(parsed.error)).toBe(
      "That search is too long. Try a station name."
    );
  });
});

describe("firstIssueMessage", () => {
  it("falls back rather than exposing a zod default", () => {
    const parsed = bestTrainRequestSchema.safeParse(VALID);
    expect(parsed.success).toBe(true);

    const empty = bestTrainRequestSchema.safeParse({ ...VALID, fromCode: "" });
    expect(empty.success).toBe(false);
    if (!empty.success) {
      empty.error.issues.length = 0;
      expect(firstIssueMessage(empty.error)).toBe(
        "Please check the details and try again."
      );
    }
  });
});
