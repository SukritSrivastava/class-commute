import { NextRequest, NextResponse } from "next/server";
import { upstreamFailure } from "@/lib/upstreamError";
import {
  RailRadarError,
  getTrainsBetween,
  isRecognizedStation,
} from "@/lib/railradar";
import {
  directJourneys,
  interchangeJourneys,
  pickBestJourney,
  type JourneyContext,
} from "@/lib/journeys";
import { planInterchanges } from "@/lib/network";
import { resolveJourney } from "@/lib/time";
import {
  bestTrainQuerySchema,
  bestTrainRequestSchema,
  firstIssueMessage,
  type BestTrainRequest,
} from "@/lib/schemas";
import { formatTime12h } from "@/lib/format";
import { bestTrainLimiter, clientKey } from "@/lib/rateLimit";

/**
 * ## Why there is a GET as well as a POST
 *
 * The edge cache is the layer that actually carries load: it is what makes two
 * students on the same line — different devices, different lambda instances —
 * share one function invocation, and behind it one RailRadar call. But CDNs do
 * not cache POST responses. A `Cache-Control` header on a POST is inert: it
 * looks like caching in the diff and does nothing in production.
 *
 * So the cacheable path is a GET whose query string carries the whole question,
 * and that is what the client calls. The POST is kept for any caller that
 * already speaks it, and is explicitly marked uncacheable rather than being
 * given a header that would quietly do nothing.
 *
 * ## Why the TTL depends on the answer
 *
 * A result for **tomorrow** is stable all day: no train has departed yet, so
 * the same question has the same answer for hours. That earns the long
 * `s-maxage=21600` with a day of `stale-while-revalidate` behind it.
 *
 * A result for **today** decays every minute — it names the latest train you
 * can still catch, and trains keep leaving. Caching that for six hours would
 * hand a student at 10:00 the 08:43 train, which is the exact bug this app
 * exists to avoid. Today's answers get a short window instead: long enough to
 * collapse the morning-rush burst, short enough that nothing on screen has
 * already left.
 *
 * The quota itself is protected a layer lower down, by the timetable cache in
 * `lib/railradar.ts` keyed `from:to:date` — that data really is stable for
 * hours, so a short response TTL costs no upstream calls.
 */
const CACHE_STABLE = "public, s-maxage=21600, stale-while-revalidate=86400";
const CACHE_DECAYS = "public, s-maxage=60, stale-while-revalidate=300";
const CACHE_NONE = "private, no-store";

function validationError(message: string) {
  return NextResponse.json(
    { error: message, kind: "VALIDATION" },
    { status: 400, headers: { "Cache-Control": CACHE_NONE } }
  );
}

/** 429 when this IP is asking too often. See lib/rateLimit.ts for the reasoning. */
function rateLimited(request: NextRequest) {
  const limit = bestTrainLimiter.check(clientKey(request.headers));
  if (limit.ok) return null;

  return NextResponse.json(
    {
      error: "That's a lot of searches. Please wait a minute and try again.",
      kind: "RATE_LIMIT",
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(limit.retryAfterSeconds),
        "Cache-Control": CACHE_NONE,
      },
    }
  );
}

export async function GET(request: NextRequest) {
  const limited = rateLimited(request);
  if (limited) return limited;

  const params = request.nextUrl.searchParams;
  const parsed = bestTrainQuerySchema.safeParse({
    fromCode: params.get("fromCode") ?? "",
    toCode: params.get("toCode") ?? "",
    classStartTime: params.get("classStartTime") ?? "",
    bufferMinutes: params.get("bufferMinutes") ?? "",
    journeyDay: params.get("journeyDay") ?? undefined,
  });

  if (!parsed.success) return validationError(firstIssueMessage(parsed.error));
  return findTrain(parsed.data, true);
}

export async function POST(request: NextRequest) {
  const limited = rateLimited(request);
  if (limited) return limited;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return validationError("Invalid request.");
  }

  const parsed = bestTrainRequestSchema.safeParse(rawBody);
  if (!parsed.success) return validationError(firstIssueMessage(parsed.error));

  // A POST response is never edge-cached, so don't pretend otherwise.
  return findTrain(parsed.data, false);
}

/**
 * Plans a journey with one change, for a pair with no usable direct train.
 *
 * ## What this costs, and why it is worth it
 *
 * Two upstream calls, on top of the one already spent proving no direct train
 * works. Against a budget of ~33 calls a day for the whole user base that is
 * expensive, and it is why this is never called speculatively — only after the
 * cheap answer has been tried and found wanting.
 *
 * What makes it affordable is that the legs are *hub* pairs. Every
 * Western-to-Central commuter in the city produces some variation of
 * `something → DDR` and `DR → something`, so the leg cache
 * (`from:to:date`, six hours) converges far harder than end-to-end pairs ever
 * could: the first person to ask on a given morning pays, and everyone
 * afterwards on that half of the journey does not.
 *
 * ## Why only one plan
 *
 * `planInterchanges` may return several viable changes, and trying the second
 * after the first comes up empty would cost two more calls. On this network the
 * preferred interchange is preferred precisely because it has the most frequent
 * service in both directions, so a second attempt buys very little for double
 * the price. One plan, or nothing.
 */
async function planViaInterchange(
  fromCode: string,
  toCode: string,
  journeyDate: string,
  context: JourneyContext
) {
  const [plan] = planInterchanges(fromCode, toCode);
  if (!plan) return null;

  // In parallel: on a platform with bad signal, two round trips in sequence is
  // a visibly slower answer, and the case where the first leg is empty (which
  // would make the second call wasted) is rare on hub pairs with dense service.
  const [first, second] = await Promise.all([
    getTrainsBetween(fromCode, plan.viaFromCode, journeyDate),
    getTrainsBetween(plan.viaToCode, toCode, journeyDate),
  ]);

  const candidates = interchangeJourneys(
    first.result.trains,
    second.result.trains,
    context,
    {
      interchangeName: plan.interchange.name,
      transferMinutes: plan.interchange.transferMinutes,
    }
  );

  const pick = pickBestJourney(candidates, context);
  if (!pick) return null;

  return {
    candidates,
    pick,
    interchangeName: plan.interchange.name,
    // A journey is only as fresh as its stalest leg.
    stale: first.stale || second.stale,
    fetchedAt: Math.min(first.fetchedAt, second.fetchedAt),
  };
}

async function findTrain(
  input: BestTrainRequest,
  cacheable: boolean
): Promise<NextResponse> {
  const { fromCode, toCode, classStartTime, bufferMinutes } = input;

  // The only clock read in this request. Everything downstream is pure.
  const journey = resolveJourney(classStartTime, input.journeyDay);

  // A future date's answer doesn't decay; today's does. See the note above.
  const cacheControl = !cacheable
    ? CACHE_NONE
    : journey.nowMinutes === null
      ? CACHE_STABLE
      : CACHE_DECAYS;

  try {
    const lookup = await getTrainsBetween(fromCode, toCode, journey.date);
    const result = lookup.result;

    if (!isRecognizedStation(result.from)) {
      return NextResponse.json(
        {
          error: `"${fromCode}" isn't a recognized station. Please pick one from the suggestions.`,
          kind: "INVALID_STATION",
        },
        { status: 400, headers: { "Cache-Control": CACHE_NONE } }
      );
    }
    if (!isRecognizedStation(result.to)) {
      return NextResponse.json(
        {
          error: `"${toCode}" isn't a recognized station. Please pick one from the suggestions.`,
          kind: "INVALID_STATION",
        },
        { status: 400, headers: { "Cache-Control": CACHE_NONE } }
      );
    }

    const context: JourneyContext = {
      classStartTime,
      bufferMinutes,
      journeyWeekday: journey.weekday,
      nowMinutes: journey.nowMinutes,
    };

    // Direct trains first. This request has already been spent, so ranking them
    // is free; only if nothing here works do we consider paying for legs.
    const candidates = directJourneys(result.trains, context);
    let pick = pickBestJourney(candidates, context);
    let changedAt: string | null = null;
    let stale = lookup.stale;
    let fetchedAt = lookup.fetchedAt;

    if (!pick) {
      // No direct train gets there in time — either none runs at all (the
      // Western-to-Central case, where RailRadar returns an empty list because
      // no such train exists) or the ones that do run are too late. Both are
      // reasons to look for a change.
      //
      // This is the only path that spends extra quota, it costs two calls, and
      // it is never taken speculatively: we are here because the cheap answer
      // was already tried and found wanting.
      const viaJourney = await planViaInterchange(
        fromCode,
        toCode,
        journey.date,
        context
      );

      if (viaJourney) {
        pick = viaJourney.pick;
        changedAt = viaJourney.interchangeName;
        stale = stale || viaJourney.stale;
        fetchedAt = Math.min(fetchedAt, viaJourney.fetchedAt);
      }
    }

    if (!pick) {
      // Two different failures, and telling them apart is the difference
      // between a user retrying usefully and a user giving up: "nothing runs
      // between these two, with or without a change" is not the same problem as
      // "trains run, but not late enough for your class".
      const noServiceAtAll =
        result.trains.length === 0 && planInterchanges(fromCode, toCode).length === 0;

      const message = noServiceAtAll
        ? `No route found between ${result.from.name} and ${result.to.name}, direct or with a change.`
        : `No train from ${result.from.name} reaches ${result.to.name} in time for a ${formatTime12h(
            classStartTime
          )} class ${journey.day} with a ${bufferMinutes}-minute buffer. ${
            journey.day === "today"
              ? "Try switching to Tomorrow, an earlier class time, or a smaller buffer."
              : "Try an earlier class time or a smaller buffer."
          }`;

      return NextResponse.json(
        { error: message, kind: "NO_TRAINS" },
        { status: 404, headers: { "Cache-Control": CACHE_NONE } }
      );
    }

    return NextResponse.json(
      {
        from: result.from,
        to: result.to,
        journeyDay: journey.day,
        ...(changedAt ? { changeAt: changedAt } : {}),
        // Only set when a timetable came from cache past its TTL, so the client
        // can say "as of ..." instead of implying it is live. On a two-leg
        // journey this is the *stalest* leg — the answer is only as fresh as
        // the oldest thing it was built from.
        ...(stale
          ? { stale: true, timetableAsOf: new Date(fetchedAt).toISOString() }
          : {}),
        ...pick,
      },
      { headers: { "Cache-Control": cacheControl } }
    );
  } catch (err) {
    if (err instanceof RailRadarError) {
      // The detail goes to the log, not down the wire. See lib/upstreamError.ts.
      const { status, body } = upstreamFailure(err, "best-train");
      return NextResponse.json(body, {
        status,
        headers: { "Cache-Control": CACHE_NONE },
      });
    }
    return NextResponse.json(
      { error: "Something went wrong while finding your train.", kind: "UNKNOWN" },
      { status: 500, headers: { "Cache-Control": CACHE_NONE } }
    );
  }
}
