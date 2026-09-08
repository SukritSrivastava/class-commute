import { z } from "zod";
import { HHMM_PATTERN } from "./time";

/**
 * Request validation for the API routes.
 *
 * Every rule carries its own `error` string because these messages are shown to
 * a student on a platform, not to a developer: zod's defaults ("Invalid input:
 * expected object, received null") are not acceptable user copy.
 * `firstIssueMessage` then takes the first issue in field-declaration order, so
 * the order the fields appear below is the order the user is asked to fix them
 * in.
 */

const INVALID_BODY = "Invalid request.";
const PICK_STATIONS =
  "Please select both a home and college station from the suggestions.";
const VALID_TIME = "Please enter a valid class start time.";
const BUFFER_RANGE = "Buffer time must be between 0 and 240 minutes.";

const stationCode = z
  .string({ error: PICK_STATIONS })
  .trim()
  .min(1, { error: PICK_STATIONS })
  .max(12, { error: PICK_STATIONS });

const classStartTime = z
  .string({ error: VALID_TIME })
  .trim()
  .regex(HHMM_PATTERN, { error: VALID_TIME });

/** Absent means "work it out from the class time" — see `resolveJourney`. */
const journeyDay = z
  .enum(["today", "tomorrow"], {
    error: "Please choose whether your class is today or tomorrow.",
  })
  .optional();

const bufferRules = <T extends z.ZodType<number>>(schema: T) =>
  schema
    .refine((n) => Number.isInteger(n), {
      error: "Buffer time must be a whole number of minutes.",
    })
    .refine((n) => n >= 0 && n <= 240, { error: BUFFER_RANGE });

/** Home and college must differ. Only runs once the fields themselves parse. */
const differentStations = (body: { fromCode: string; toCode: string }) =>
  body.fromCode.toUpperCase() !== body.toCode.toUpperCase();

const DIFFERENT_STATIONS = {
  error: "Home and college station can't be the same.",
} as const;

/** JSON body form, used by the POST handler. */
export const bestTrainRequestSchema = z
  .object(
    {
      fromCode: stationCode,
      toCode: stationCode,
      classStartTime,
      bufferMinutes: bufferRules(z.number({ error: BUFFER_RANGE })),
      journeyDay,
    },
    // Covers a body that isn't an object at all: `null`, a bare string, a list.
    { error: INVALID_BODY }
  )
  .refine(differentStations, DIFFERENT_STATIONS);

/**
 * Query-string form, used by the GET handler. Identical rules, except that
 * `bufferMinutes` arrives as a string and has to be coerced — a URL has no
 * numbers in it. Everything else, including the user-facing copy, is shared
 * with the body schema above so the two cannot drift apart.
 */
export const bestTrainQuerySchema = z
  .object(
    {
      fromCode: stationCode,
      toCode: stationCode,
      classStartTime,
      bufferMinutes: bufferRules(
        z
          .string({ error: BUFFER_RANGE })
          .trim()
          .regex(/^-?\d+$/, { error: BUFFER_RANGE })
          .transform(Number)
      ),
      journeyDay,
    },
    { error: INVALID_BODY }
  )
  .refine(differentStations, DIFFERENT_STATIONS);

export type BestTrainRequest = z.infer<typeof bestTrainRequestSchema>;

export const stationSearchQuerySchema = z.object(
  {
    q: z
      .string({ error: "Please type a station name to search for." })
      .trim()
      // A cap here, not just in the client: an oversized query is never a real
      // station and shouldn't spend one of the month's upstream requests.
      .max(64, { error: "That search is too long. Try a station name." }),
  },
  { error: INVALID_BODY }
);

/**
 * The one message to show the user for a failed parse. Falls back to a generic
 * line rather than exposing a zod default if a rule ever lands without copy.
 */
export function firstIssueMessage(
  error: z.ZodError,
  fallback = "Please check the details and try again."
): string {
  return error.issues[0]?.message ?? fallback;
}
