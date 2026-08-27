import { NextRequest, NextResponse } from "next/server";
import { RailRadarError, getTrainsBetween, isRecognizedStation } from "@/lib/railradar";
import { pickBestTrain, todayInMumbai } from "@/lib/bestTrain";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

interface RequestBody {
  fromCode?: unknown;
  toCode?: unknown;
  classStartTime?: unknown;
  bufferMinutes?: unknown;
}

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request.", kind: "VALIDATION" },
      { status: 400 }
    );
  }

  const fromCode = typeof body.fromCode === "string" ? body.fromCode.trim() : "";
  const toCode = typeof body.toCode === "string" ? body.toCode.trim() : "";
  const classStartTime =
    typeof body.classStartTime === "string" ? body.classStartTime.trim() : "";
  const bufferMinutes =
    typeof body.bufferMinutes === "number" ? body.bufferMinutes : NaN;

  if (!fromCode || !toCode) {
    return NextResponse.json(
      {
        error: "Please select both a home and college station from the suggestions.",
        kind: "VALIDATION",
      },
      { status: 400 }
    );
  }
  if (fromCode.toUpperCase() === toCode.toUpperCase()) {
    return NextResponse.json(
      { error: "Home and college station can't be the same.", kind: "VALIDATION" },
      { status: 400 }
    );
  }
  if (!TIME_RE.test(classStartTime)) {
    return NextResponse.json(
      { error: "Please enter a valid class start time.", kind: "VALIDATION" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 240) {
    return NextResponse.json(
      { error: "Buffer time must be between 0 and 240 minutes.", kind: "VALIDATION" },
      { status: 400 }
    );
  }

  try {
    const result = await getTrainsBetween(fromCode, toCode);

    if (!isRecognizedStation(result.from)) {
      return NextResponse.json(
        {
          error: `"${fromCode}" isn't a recognized station. Please pick one from the suggestions.`,
          kind: "INVALID_STATION",
        },
        { status: 400 }
      );
    }
    if (!isRecognizedStation(result.to)) {
      return NextResponse.json(
        {
          error: `"${toCode}" isn't a recognized station. Please pick one from the suggestions.`,
          kind: "INVALID_STATION",
        },
        { status: 400 }
      );
    }

    if (result.trains.length === 0) {
      return NextResponse.json(
        {
          error: `No trains found running between ${result.from.name} and ${result.to.name}.`,
          kind: "NO_TRAINS",
        },
        { status: 404 }
      );
    }

    const pick = pickBestTrain(
      result.trains,
      classStartTime,
      bufferMinutes,
      todayInMumbai()
    );

    if (!pick) {
      return NextResponse.json(
        {
          error: `No train from ${result.from.name} reaches ${result.to.name} in time for a ${classStartTime} class with a ${bufferMinutes}-minute buffer today. Try an earlier class time or a smaller buffer.`,
          kind: "NO_TRAINS",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      from: result.from,
      to: result.to,
      ...pick,
    });
  } catch (err) {
    if (err instanceof RailRadarError) {
      const status =
        err.kind === "RATE_LIMIT" ? 429 : err.kind === "TIMEOUT" ? 504 : 502;
      return NextResponse.json({ error: err.message, kind: err.kind }, { status });
    }
    return NextResponse.json(
      { error: "Something went wrong while finding your train.", kind: "UNKNOWN" },
      { status: 500 }
    );
  }
}
