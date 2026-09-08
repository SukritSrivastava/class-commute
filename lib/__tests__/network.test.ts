import { describe, expect, it } from "vitest";
import {
  INTERCHANGES,
  LINES,
  linesFor,
  planInterchanges,
  shareALine,
} from "@/lib/network";
import { STATIONS } from "@/lib/stations";

/** Codes in the committed station bundle, which is what the app can actually offer. */
const BUNDLED = new Set(STATIONS.map((s) => s.code));

describe("the line model", () => {
  it("only names stations that exist in the bundle", () => {
    // A line listing a station the autocomplete cannot produce is dead data at
    // best and a wrong route at worst.
    for (const [line, codes] of Object.entries(LINES)) {
      for (const code of codes) {
        expect(BUNDLED.has(code), `${line} lists unknown station ${code}`).toBe(
          true
        );
      }
    }
  });

  it("has no duplicate stations within a line", () => {
    for (const [line, codes] of Object.entries(LINES)) {
      expect(new Set(codes).size, `${line} repeats a station`).toBe(codes.length);
    }
  });

  it("puts the well-known stations on the right lines", () => {
    expect(linesFor("BVI")).toEqual(["western"]);
    expect(linesFor("CSMT")).toEqual(expect.arrayContaining(["central", "harbour"]));
    expect(linesFor("VSH")).toEqual(
      expect.arrayContaining(["harbour", "trans-harbour"])
    );
  });

  it("keeps Dadar's two codes on their own lines", () => {
    // The Western and Central stations at Dadar are two buildings sharing a
    // footbridge, and Indian Railways gives them different codes. Conflating
    // them would invent direct trains that do not exist.
    expect(linesFor("DDR")).toEqual(["western"]);
    expect(linesFor("DR")).toEqual(["central"]);
  });

  it("puts the Andheri branch stations on both lines that serve them", () => {
    for (const code of ["BA", "KHAR", "STC", "VLP", "ADH"]) {
      expect(linesFor(code)).toEqual(
        expect.arrayContaining(["western", "harbour-andheri"])
      );
    }
  });

  it("is case- and whitespace-insensitive", () => {
    expect(linesFor(" bvi ")).toEqual(linesFor("BVI"));
  });

  it("returns nothing for a station it does not model", () => {
    // Safe degradation: no lines means no interchange plan, which means the app
    // answers direct-only rather than inventing a route.
    expect(linesFor("XXXX")).toEqual([]);
  });
});

describe("every interchange is real", () => {
  it("names stations that exist and sit on the lines claimed", () => {
    for (const interchange of INTERCHANGES) {
      for (const [line, code] of Object.entries(interchange.codes)) {
        expect(BUNDLED.has(code), `${interchange.id}: unknown station ${code}`).toBe(
          true
        );
        expect(
          linesFor(code),
          `${interchange.id}: ${code} is not on ${line}`
        ).toContain(line);
      }
    }
  });

  it("serves at least two lines, or it is not an interchange", () => {
    for (const interchange of INTERCHANGES) {
      if (Object.keys(interchange.codes).length < 2) {
        // Vasai Road is listed for a line this model doesn't carry yet; it must
        // therefore never produce a plan, which planInterchanges enforces.
        expect(interchange.id).toBe("vasai-road");
      }
    }
  });
});

describe("shareALine", () => {
  it("is true for two stations on the same line", () => {
    expect(shareALine("BVI", "CCG")).toBe(true);
    expect(shareALine("TNA", "CSMT")).toBe(true);
  });

  it("is false across lines that never touch except at a change", () => {
    // The journey this whole feature exists for.
    expect(shareALine("BVI", "CSMT")).toBe(false);
  });

  it("is false when either station is unknown", () => {
    expect(shareALine("XXXX", "CCG")).toBe(false);
  });
});

describe("planInterchanges", () => {
  it("routes Western to Central via Dadar, using each line's own code", () => {
    const [plan] = planInterchanges("BVI", "CSMT");

    expect(plan.interchange.id).toBe("dadar");
    // Get off at Dadar Western, walk over, get on at Dadar Central.
    expect(plan.viaFromCode).toBe("DDR");
    expect(plan.viaToCode).toBe("DR");
    expect(plan.fromLine).toBe("western");
    expect(plan.toLine).toBe("central");
  });

  it("routes the other direction symmetrically", () => {
    const [plan] = planInterchanges("CSMT", "BVI");
    expect(plan.viaFromCode).toBe("DR");
    expect(plan.viaToCode).toBe("DDR");
  });

  it("routes Central to Harbour via Kurla", () => {
    // Mulund, not Thane: Thane is also on Trans-Harbour, so Thane→Vashi is a
    // direct journey and needs no change at all.
    const [plan] = planInterchanges("MLND", "VSH");
    expect(plan.interchange.id).toBe("kurla");
    expect(plan.viaFromCode).toBe("CLA");
    expect(plan.viaToCode).toBe("CLA");
  });

  it("knows Andheri to CSMT is a through Harbour service, not a change", () => {
    // Caught against live data: an Andheri train starts at CSMT, so these two
    // share a line. Modelling only the branch made this look like it needed a
    // change at Wadala, which would have spent two calls to plan a journey a
    // single train already makes.
    expect(shareALine("ADH", "CSMT")).toBe(true);
    expect(planInterchanges("ADH", "CSMT")).toEqual([]);
  });

  it("still routes Panvel to Andheri via Wadala Road", () => {
    // The two Harbour arms diverge there, and no train runs through from the
    // Panvel arm to the Andheri arm.
    const [plan] = planInterchanges("PNVL", "ADH");
    expect(plan.interchange.id).toBe("wadala-road");
    expect(plan.viaFromCode).toBe("VDLR");
  });

  it("knows Thane to Panvel is direct on Trans-Harbour", () => {
    // Both sit on the Trans-Harbour line. Planning a change here would spend
    // two upstream calls to reinvent a train that already runs.
    expect(planInterchanges("TNA", "PNVL")).toEqual([]);
    expect(planInterchanges("TNA", "VSH")).toEqual([]);
  });

  it("prefers Dadar when several changes would work", () => {
    // Dadar leads the list because both its lines run the most frequent
    // service, so a missed connection there costs minutes, not a half-hour.
    const plans = planInterchanges("BVI", "GC");
    expect(plans[0].interchange.id).toBe("dadar");
    expect(plans.length).toBeGreaterThan(0);
  });

  it("plans nothing for two stations already on one line", () => {
    // A direct train may or may not run, but that is RailRadar's question —
    // spending two calls on a change here would be waste.
    expect(planInterchanges("BVI", "CCG")).toEqual([]);
    expect(planInterchanges("CSMT", "KYN")).toEqual([]);
  });

  it("plans nothing for a station it does not model", () => {
    expect(planInterchanges("XXXX", "CCG")).toEqual([]);
    expect(planInterchanges("BVI", "XXXX")).toEqual([]);
  });

  it("plans nothing from a station to itself", () => {
    expect(planInterchanges("BVI", "BVI")).toEqual([]);
  });

  it("never changes at the origin or the destination", () => {
    // Starting at Dadar Western and changing at Dadar is not a journey, it is
    // standing still.
    for (const plan of planInterchanges("DDR", "CSMT")) {
      expect(plan.viaFromCode).not.toBe("DDR");
    }
    for (const plan of planInterchanges("BVI", "DR")) {
      expect(plan.viaToCode).not.toBe("DR");
    }
  });

  it("plans nothing when the destination is the far half of an interchange", () => {
    // Borivali to Dadar *Central* is a Western train to Dadar Western and a
    // walk over the footbridge — one train, not two. Proposing a second train
    // from DR to DR would be nonsense, so no plan is the right answer.
    // (The app currently answers "no route" here rather than suggesting the
    // walk; that gap is noted in the README.)
    expect(planInterchanges("BVI", "DR")).toEqual([]);
  });

  it("returns each physical change only once", () => {
    const plans = planInterchanges("BVI", "PNVL");
    const ids = plans.map((p) => p.interchange.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives a plan for the cross-city journeys that matter", () => {
    // A spot-check across the network. Each of these needs a change, and the
    // feature is worthless if any of them comes back empty.
    const journeys: [string, string][] = [
      ["BVI", "CSMT"], // Western → Central
      ["ADH", "GC"], // Western → Central
      ["CSMT", "TUH"], // Central → Trans-Harbour
      ["MLND", "PNVL"], // Central → Harbour
      ["KYN", "VSH"], // Central → Harbour
      ["BVI", "GC"], // Western → Central
      ["VR", "TNA"], // Western → Central
    ];

    for (const [from, to] of journeys) {
      expect(
        planInterchanges(from, to).length,
        `no plan for ${from} → ${to}`
      ).toBeGreaterThan(0);
    }
  });
});
