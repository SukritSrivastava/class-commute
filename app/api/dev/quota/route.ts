import { NextResponse } from "next/server";
import { usageReport } from "@/lib/quota";

/**
 * Development-only view of upstream RailRadar usage.
 *
 * The counters it reports are per lambda instance (see `lib/quota.ts`), which
 * makes them useful for local work and for spotting a leak — "typing in the
 * station box added ten calls" is exactly the kind of regression this catches —
 * and useless as a production ledger. Rather than ship a misleading number, the
 * route simply does not exist outside development.
 */

/** Counters live in module state, so a cached response would be a lie. */
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.json(usageReport(), {
    headers: { "Cache-Control": "no-store" },
  });
}
