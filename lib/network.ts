/**
 * A model of the Mumbai suburban network: which line each station sits on, and
 * where the lines meet.
 *
 * ## Why this is hand-authored
 *
 * RailRadar's `/trains/between` returns **direct trains only**. Ask it for
 * Borivali to CSMT and it answers with an empty list, because no train makes
 * that journey — you change at Dadar. To plan that change we have to know that
 * Borivali is on the Western line, CSMT is on the Central line, and that Dadar
 * is where the two touch. No endpoint tells us that, and the naive alternative
 * — probing candidate interchanges to see which one works — would spend the
 * month's entire quota on guesses.
 *
 * So the topology lives here, as static data. It costs nothing, never changes
 * on a timescale that matters (the network gains a station every few years),
 * and turns "which route is even possible" into a local lookup.
 *
 * ## What it is not
 *
 * It is a routing model, not a timetable: it says *where* a change is possible,
 * never *when*. Every time comes from RailRadar.
 *
 * A station that is missing or wrongly assigned here degrades safely — the
 * router simply finds no interchange and the app answers direct-only, exactly
 * as it did before. It never produces a wrong journey; it produces no journey.
 * Stations whose identity in the bundled list is ambiguous are deliberately
 * left out rather than guessed at.
 */

export type LineId =
  | "western"
  | "central"
  | "central-karjat"
  | "harbour"
  | "harbour-andheri"
  | "trans-harbour";

export const LINE_NAMES: Record<LineId, string> = {
  western: "Western",
  central: "Central",
  "central-karjat": "Central (Karjat–Khopoli)",
  harbour: "Harbour",
  "harbour-andheri": "Harbour (Andheri branch)",
  "trans-harbour": "Trans-Harbour",
};

/**
 * Station codes on each line, in geographic order. Order is not used for
 * routing — RailRadar decides what actually runs — but it keeps the lists
 * reviewable against a network map, which is how errors get spotted.
 *
 * Codes are Indian Railways' own and are not always guessable: Dadar is two
 * separate codes, `DDR` on Western and `DR` on Central, because they are two
 * station buildings sharing a footbridge. That distinction is the entire reason
 * `Interchange.codes` below is keyed by line.
 */
export const LINES: Record<LineId, readonly string[]> = {
  western: [
    "CCG", "MEL", "CYR", "GTR", "MMCT", "PL", "PBHD", "DDR", "MRU", "MM",
    "BA", "KHAR", "STC", "VLP", "ADH", "JOS", "RMAR", "GMN", "MDD", "KILE",
    "BVI", "DIC", "MIRA", "BYR", "NIG", "BSR", "NSP", "VR", "VTN", "SAH",
    "KLV", "PLG", "UOI", "BOR", "VGN", "DRD",
  ],
  central: [
    "CSMT", "MSD", "SNRD", "BY", "CHG", "CRD", "PR", "DR", "MTN", "SION",
    "CLA", "VVH", "GC", "VK", "KJRD", "BND", "NHU", "MLND", "TNA", "KLVA",
    "MBQ", "DIVA", "KOPR", "DI", "THK", "KYN", "SHAD", "ABY", "TLA", "KDV",
    "VSD", "ASO", "ATG", "KE", "OMB", "KSRA",
  ],
  // Branches off the Central main line at Kalyan.
  "central-karjat": [
    "KYN", "VLDI", "ULNR", "ABH", "BUD", "VGI", "SHLU", "NRL", "BVS", "KJT",
    "PDI", "KLY", "DLV", "LWJ", "KHPI",
  ],
  harbour: [
    "CSMT", "MSD", "SNRD", "DKRD", "RRD", "CTGN", "SVE", "VDLR", "CHF",
    "CLA", "TKNG", "CMBR", "GV", "MNKD", "VSH", "SNCR", "JNJ", "NEU",
    "SWDK", "BEPR", "KHAG", "MANR", "KNDS", "PNVL",
  ],
  /**
   * The Harbour line's other arm: CSMT to Andheri, diverging from the Panvel
   * arm at Wadala Road and joining the Western alignment at Mahim.
   *
   * It shares the CSMT–Wadala stretch with `harbour` because the *services* run
   * through — an Andheri train starts at CSMT, it does not start at Wadala.
   * Modelling only the branch itself would make Andheri→CSMT look like it needs
   * a change, when a single train does it; and the stations from Bandra north
   * appear on `western` too because both lines call there.
   */
  "harbour-andheri": [
    "CSMT", "MSD", "SNRD", "DKRD", "RRD", "CTGN", "SVE", "VDLR",
    "MM", "BA", "KHAR", "STC", "VLP", "ADH",
  ],
  "trans-harbour": ["TNA", "GNSL", "KPHN", "TUH", "SNCR", "VSH", "JNJ", "NEU", "SWDK", "BEPR", "PNVL"],
};

export interface Interchange {
  id: string;
  /** Shown to the user: "Change at Dadar". */
  name: string;
  /**
   * The station code to use on each line this interchange serves. Keyed by line
   * because the same physical interchange can be a different station code
   * depending on which line you are standing on.
   */
  codes: Partial<Record<LineId, string>>;
  /**
   * Minutes to allow for the change here, overriding the caller's default when
   * this particular interchange is harder than average.
   */
  transferMinutes?: number;
}

/**
 * The interchanges, in preference order.
 *
 * Order matters and is a routing decision: when more than one change would
 * work, the first viable one is the one we spend upstream calls on. Dadar leads
 * because it is where the two busiest lines meet and has the most frequent
 * service in both directions — a missed connection there costs minutes, not a
 * half-hour wait.
 */
export const INTERCHANGES: readonly Interchange[] = [
  {
    id: "dadar",
    name: "Dadar",
    // Two station codes, one footbridge. This is the Western↔Central change
    // essentially every cross-city commute makes.
    codes: { western: "DDR", central: "DR" },
    // The change itself is a staircase and a bridge, but at rush hour the
    // bridge is the bottleneck, not the walk.
    transferMinutes: 10,
  },
  {
    id: "kurla",
    name: "Kurla",
    codes: { central: "CLA", harbour: "CLA" },
  },
  {
    id: "wadala-road",
    name: "Wadala Road",
    codes: { harbour: "VDLR", "harbour-andheri": "VDLR" },
  },
  {
    id: "thane",
    name: "Thane",
    codes: { central: "TNA", "trans-harbour": "TNA" },
  },
  {
    id: "panvel",
    name: "Panvel",
    codes: { harbour: "PNVL", "trans-harbour": "PNVL" },
  },
  {
    id: "vasai-road",
    name: "Vasai Road",
    codes: { western: "BSR" },
  },
  {
    id: "kalyan",
    name: "Kalyan",
    codes: { central: "KYN", "central-karjat": "KYN" },
  },
  {
    id: "bandra",
    name: "Bandra",
    // The Western and the Harbour–Andheri branch share this platform complex,
    // so it is an alternative to Dadar for anything on the Andheri branch.
    codes: { western: "BA", "harbour-andheri": "BA" },
  },
  {
    id: "andheri",
    name: "Andheri",
    codes: { western: "ADH", "harbour-andheri": "ADH" },
  },
];

/** Line membership, built once. A station may sit on several lines. */
const LINES_BY_STATION: ReadonlyMap<string, readonly LineId[]> = (() => {
  const map = new Map<string, LineId[]>();
  for (const [line, codes] of Object.entries(LINES) as [LineId, string[]][]) {
    for (const code of codes) {
      const existing = map.get(code);
      if (existing) existing.push(line);
      else map.set(code, [line]);
    }
  }
  return map;
})();

const normalise = (code: string) => code.trim().toUpperCase();

/** Lines a station sits on. Empty for a station this model doesn't know. */
export function linesFor(code: string): readonly LineId[] {
  return LINES_BY_STATION.get(normalise(code)) ?? [];
}

/**
 * True when the two stations share a line, so a direct train is at least
 * plausible. Not a promise that one runs — only RailRadar knows that.
 */
export function shareALine(fromCode: string, toCode: string): boolean {
  const from = linesFor(fromCode);
  return linesFor(toCode).some((line) => from.includes(line));
}

export interface InterchangePlan {
  interchange: Interchange;
  /** Where to get off. On the same line as the origin. */
  viaFromCode: string;
  /** Where to get on again. On the same line as the destination. */
  viaToCode: string;
  fromLine: LineId;
  toLine: LineId;
}

/**
 * Ways to get from `fromCode` to `toCode` with exactly one change, best first.
 *
 * Returns every viable plan rather than just one so the caller can fall back if
 * a leg turns out to have no service — but the caller is expected to *use* one
 * at a time. Each plan costs two upstream calls; enumerating is free, querying
 * is not.
 *
 * Deliberately limited to a single change. Two changes on this network almost
 * always means a journey better served by a different mode, and each extra leg
 * both doubles the quota cost and multiplies the risk of the whole plan
 * collapsing on one missed train.
 */
export function planInterchanges(
  fromCode: string,
  toCode: string
): InterchangePlan[] {
  const from = normalise(fromCode);
  const to = normalise(toCode);
  if (from === to) return [];

  const fromLines = linesFor(from);
  const toLines = linesFor(to);
  if (fromLines.length === 0 || toLines.length === 0) return [];

  // Already on one line together: whether a train actually runs is RailRadar's
  // question, and it has already been asked. Planning a change here would spend
  // two calls to route CSMT→Kalyan via Kurla, which is absurd — CSMT sits on
  // both Central and Harbour, so a naive line-pairing finds a "change" that
  // exists only in the model, never on the ground.
  if (shareALine(from, to)) return [];

  const plans: InterchangePlan[] = [];

  for (const interchange of INTERCHANGES) {
    for (const fromLine of fromLines) {
      const viaFromCode = interchange.codes[fromLine];
      if (!viaFromCode) continue;

      for (const toLine of toLines) {
        const viaToCode = interchange.codes[toLine];
        if (!viaToCode) continue;

        // Changing onto the line you were already on is not a change.
        if (fromLine === toLine) continue;

        // Changing *at* your origin or destination is not a journey.
        if (viaFromCode === from || viaToCode === to) continue;

        plans.push({ interchange, viaFromCode, viaToCode, fromLine, toLine });
      }
    }
  }

  // One plan per interchange: the same physical change reached via two
  // different line pairings is still the same change.
  const seen = new Set<string>();
  return plans.filter((plan) => {
    const key = `${plan.interchange.id}:${plan.viaFromCode}:${plan.viaToCode}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
