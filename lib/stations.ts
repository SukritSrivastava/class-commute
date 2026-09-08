import bundle from "./data/mumbai-stations.json";

/**
 * Client-side station search over the bundled Mumbai list.
 *
 * The list is generated and committed by `scripts/build-stations.mts`, so this
 * runs entirely in the browser: no network, no quota, no debounce, no minimum
 * query length. A match appears on the first keystroke. That is both the
 * largest saving against the 1,000-request month and — because a local filter
 * over ~115 rows is instant — the largest perceived-speed win in the app.
 */

/** What the form needs from a station. Deliberately smaller than RailRadar's row. */
export interface StationOption {
  code: string;
  name: string;
}

interface BundledStation extends StationOption {
  aliases?: string[];
}

export const STATION_BUNDLE_GENERATED_AT: string = bundle.generatedAt;

/**
 * The whole list, shipped to the browser. It is ~1KB gzipped — less than a
 * single round-trip to ask the server about one query, never mind one per
 * keystroke. The generator keeps its resume bookkeeping in a separate file so
 * none of it ends up here.
 */
export const STATIONS: readonly BundledStation[] =
  bundle.stations as BundledStation[];

/**
 * Reduces a string to bare alphanumerics so spacing and punctuation stop
 * mattering: "church gate", "Churchgate" and "CHURCH-GATE" all squash to the
 * same thing. Indian Railways' own naming is inconsistent enough that this is
 * the difference between finding a station and not.
 */
function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface IndexedStation {
  station: BundledStation;
  name: string;
  nameSquashed: string;
  /** Each word of the name, so "road" finds "Mira Road". */
  words: string[];
  code: string;
  aliases: string[];
}

/** Built once at module load: ~115 rows, so this is microseconds. */
const INDEX: IndexedStation[] = STATIONS.map((station) => ({
  station,
  name: station.name.toLowerCase(),
  nameSquashed: squash(station.name),
  words: station.name.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean),
  code: station.code.toLowerCase(),
  aliases: (station.aliases ?? []).map(squash),
}));

/**
 * Match tiers, best first. The ordering is the brief's: a prefix match beats a
 * substring match beats an alias match, because someone typing "band" wants
 * Bandra before Bandra Terminus and long before anything that merely contains
 * "band" in an alias.
 */
const TIER = {
  EXACT_CODE: 0,
  NAME_PREFIX: 1,
  CODE_PREFIX: 2,
  WORD_PREFIX: 3,
  NAME_SUBSTRING: 4,
  ALIAS_PREFIX: 5,
  ALIAS_SUBSTRING: 6,
} as const;

function tierFor(entry: IndexedStation, query: string, squashed: string): number {
  if (entry.code === squashed) return TIER.EXACT_CODE;
  if (entry.nameSquashed.startsWith(squashed)) return TIER.NAME_PREFIX;
  if (entry.code.startsWith(squashed)) return TIER.CODE_PREFIX;
  if (entry.words.some((word) => word.startsWith(query))) return TIER.WORD_PREFIX;
  if (entry.nameSquashed.includes(squashed)) return TIER.NAME_SUBSTRING;

  let aliasTier = Number.POSITIVE_INFINITY;
  for (const alias of entry.aliases) {
    if (alias.startsWith(squashed)) return TIER.ALIAS_PREFIX;
    if (alias.includes(squashed)) aliasTier = TIER.ALIAS_SUBSTRING;
  }
  return aliasTier;
}

export const DEFAULT_SEARCH_LIMIT = 8;

/**
 * Ranked matches for `query`. Pure and synchronous — call it straight from an
 * onChange handler.
 */
export function searchBundledStations(
  query: string,
  limit = DEFAULT_SEARCH_LIMIT
): StationOption[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];

  const squashed = squash(trimmed);
  if (!squashed) return [];

  const scored: { entry: IndexedStation; tier: number }[] = [];
  for (const entry of INDEX) {
    const tier = tierFor(entry, trimmed, squashed);
    if (Number.isFinite(tier)) scored.push({ entry, tier });
  }

  scored.sort(
    (a, b) =>
      a.tier - b.tier ||
      // Within a tier, the shorter name is the more likely intent: "Dadar"
      // before "Dadar Central".
      a.entry.name.length - b.entry.name.length ||
      a.entry.name.localeCompare(b.entry.name)
  );

  return scored.slice(0, limit).map(({ entry }) => ({
    code: entry.station.code,
    name: entry.station.name,
  }));
}

/** Looks a station up by exact code, for validating a restored selection. */
export function findStationByCode(code: string): StationOption | undefined {
  const wanted = code.trim().toLowerCase();
  const found = INDEX.find((entry) => entry.code === wanted);
  return found && { code: found.station.code, name: found.station.name };
}
