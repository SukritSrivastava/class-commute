import { RailRadarError, type RailRadarErrorKind } from "./railradar";

/**
 * What an upstream failure is allowed to say to the person holding the phone.
 *
 * `RailRadarError.message` is written for whoever is reading the server log —
 * and some of it is not ours at all, because the `VALIDATION` and `API_ERROR`
 * branches in `lib/railradar.ts` forward RailRadar's own `body.error.message`
 * verbatim. Both routes used to return that string straight to the client,
 * which meant an anonymous request could be answered with
 *
 *   {"error":"RAILRADAR_API_KEY is not configured on the server.", ...}
 *
 * naming the exact environment variable and the server's configuration state,
 * or with arbitrary text chosen by a third party. It also broke the project's
 * own rule about error copy, because none of it tells a student on a platform
 * what to do next.
 *
 * So the wire copy is keyed off `kind` — the discriminant callers are supposed
 * to switch on — and the real message is logged instead of sent. Adding a kind
 * to `RailRadarErrorKind` without adding a line here is a type error, which is
 * the point: there is no default branch that could quietly start forwarding
 * upstream text again.
 */
const USER_FACING: Record<RailRadarErrorKind, string> = {
  TIMEOUT: "That took too long. Check your signal and try again.",
  NETWORK: "Couldn't reach the train data. Check your connection and try again.",
  // Deliberately indistinguishable from any other server-side fault: whether
  // the key is missing, wrong or rejected is nobody's business but ours, and
  // it is not something the reader can act on either way.
  UNAUTHORIZED: "Train data isn't available right now. Please try again later.",
  RATE_LIMIT: "That's a lot of searches. Please wait a minute and try again.",
  VALIDATION: "Couldn't look up that route. Check the stations and try again.",
  API_ERROR: "Train data isn't available right now. Please try again later.",
};

/** The HTTP status each kind maps to. Unchanged from what the routes did. */
const STATUS: Record<RailRadarErrorKind, number> = {
  TIMEOUT: 504,
  NETWORK: 502,
  UNAUTHORIZED: 502,
  RATE_LIMIT: 429,
  VALIDATION: 502,
  API_ERROR: 502,
};

export interface UpstreamFailure {
  status: number;
  body: { error: string; kind: RailRadarErrorKind };
}

/**
 * Turns an upstream failure into the response the client may see, and puts the
 * detail somewhere only an operator can read it.
 */
export function upstreamFailure(
  err: RailRadarError,
  context: string
): UpstreamFailure {
  console.error(`[${context}] ${err.kind}: ${err.message}`);
  return {
    status: STATUS[err.kind],
    body: { error: USER_FACING[err.kind], kind: err.kind },
  };
}
