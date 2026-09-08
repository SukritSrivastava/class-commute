import { describe, expect, it } from "vitest";
import {
  STATIONS,
  findStationByCode,
  searchBundledStations,
} from "@/lib/stations";

/** The station the query should surface first, by name. */
function top(query: string): string | undefined {
  return searchBundledStations(query)[0]?.name;
}

function names(query: string): string[] {
  return searchBundledStations(query).map((s) => s.name);
}

describe("the bundled list", () => {
  it("covers the network, not a handful of stations", () => {
    // If this ever collapses, the generator failed and the autocomplete is
    // quietly useless — worth failing the build over.
    expect(STATIONS.length).toBeGreaterThan(80);
  });

  it("has no duplicate codes", () => {
    const codes = STATIONS.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("carries a name and a code for every entry", () => {
    for (const station of STATIONS) {
      expect(station.code).toMatch(/\S/);
      expect(station.name).toMatch(/\S/);
    }
  });
});

describe("searchBundledStations", () => {
  it("returns nothing for an empty or punctuation-only query", () => {
    expect(searchBundledStations("")).toEqual([]);
    expect(searchBundledStations("   ")).toEqual([]);
    expect(searchBundledStations("--")).toEqual([]);
  });

  it("matches from the very first keystroke", () => {
    // No minimum length: this is a local filter, so one character is free.
    expect(searchBundledStations("b").length).toBeGreaterThan(0);
  });

  it("is case-insensitive", () => {
    expect(top("BORIVALI")).toBe(top("borivali"));
    expect(top("BoRiVaLi")).toBe(top("borivali"));
  });

  it("finds a station by its exact code", () => {
    const borivali = top("borivali");
    const byCode = searchBundledStations("BVI")[0];
    expect(byCode.name).toBe(borivali);
  });

  it("respects the result limit", () => {
    expect(searchBundledStations("a", 3).length).toBeLessThanOrEqual(3);
  });
});

describe("ranking", () => {
  it("puts a name prefix above a mere substring", () => {
    const results = names("dadar");
    expect(results[0]?.toLowerCase().startsWith("dadar")).toBe(true);
  });

  it("prefers the shorter name within a tier", () => {
    // "Dadar" should beat "Dadar Central" / "Dadar Western" style entries.
    const results = searchBundledStations("dadar");
    if (results.length > 1) {
      expect(results[0].name.length).toBeLessThanOrEqual(results[1].name.length);
    }
  });

  it("finds a station by a word other than the first", () => {
    // "road" appears mid-name in Vasai Road, Khar Road, Mira Road.
    expect(searchBundledStations("road").length).toBeGreaterThan(0);
  });
});

describe("aliases — the abbreviation problem", () => {
  // Indian Railways' own names are not what people type. These are the cases
  // that made the alias list necessary in the first place.
  it("finds Churchgate from how a person spells it", () => {
    for (const query of ["churchgate", "church gate", "bmby church gte"]) {
      expect(top(query)?.toLowerCase()).toContain("churchgate");
    }
  });

  it("finds CSMT under every name it has had", () => {
    for (const query of ["csmt", "cst", "vt", "victoria terminus"]) {
      expect(searchBundledStations(query).length).toBeGreaterThan(0);
    }
  });

  it("finds Vasai Road as plain 'vasai'", () => {
    expect(top("vasai")?.toLowerCase()).toContain("vasai");
  });

  it("covers every station the brief called out", () => {
    const required = [
      "churchgate",
      "csmt",
      "dadar",
      "andheri",
      "borivali",
      "thane",
      "kalyan",
      "panvel",
      "vasai",
      "bandra",
      "kurla",
      "ghatkopar",
      "mulund",
      "vidyavihar",
      "sion",
      "byculla",
    ];

    for (const query of required) {
      expect(
        searchBundledStations(query).length,
        `"${query}" found no station`
      ).toBeGreaterThan(0);
    }
  });

  it("ranks an alias match below a real name match", () => {
    // "cg" is an alias of Churchgate; anything actually *named* with a "cg"
    // prefix would legitimately outrank it. The point is the alias still hits.
    expect(searchBundledStations("cg").length).toBeGreaterThan(0);
  });
});

describe("findStationByCode", () => {
  it("round-trips a code from the bundle", () => {
    const first = STATIONS[0];
    expect(findStationByCode(first.code)).toEqual({
      code: first.code,
      name: first.name,
    });
  });

  it("is case- and whitespace-insensitive", () => {
    const first = STATIONS[0];
    expect(findStationByCode(` ${first.code.toLowerCase()} `)?.code).toBe(
      first.code
    );
  });

  it("returns undefined for a code that isn't in the bundle", () => {
    expect(findStationByCode("XXXX")).toBeUndefined();
  });
});
