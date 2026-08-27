import { NextRequest, NextResponse } from "next/server";
import { RailRadarError, searchStations, type Station } from "@/lib/railradar";

const MAX_RESULTS = 8;

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (query.length < 2) {
    return NextResponse.json({ stations: [] satisfies Station[] });
  }

  try {
    const stations = await searchStations(query);

    // This app only serves the Mumbai suburban network, and RailRadar's
    // fuzzy match otherwise surfaces a lot of unrelated stations for short queries.
    const filtered = stations
      .filter((s) => s.isActive && s.city?.toLowerCase() === "mumbai")
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, MAX_RESULTS);

    return NextResponse.json({ stations: filtered });
  } catch (err) {
    if (err instanceof RailRadarError) {
      const status = err.kind === "RATE_LIMIT" ? 429 : 502;
      return NextResponse.json({ error: err.message, kind: err.kind }, { status });
    }
    return NextResponse.json(
      { error: "Something went wrong while searching for stations.", kind: "UNKNOWN" },
      { status: 500 }
    );
  }
}
