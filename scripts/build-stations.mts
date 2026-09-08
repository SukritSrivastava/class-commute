/**
 * Builds `lib/data/mumbai-stations.json` — the bundled station list the
 * autocomplete searches client-side.
 *
 * ## Why this exists
 *
 * Station autocomplete used to spend an upstream RailRadar request on every
 * debounced keystroke burst. On a 1,000-request *month* that is the single
 * largest drain in the app, and it buys data that does not change: the Mumbai
 * suburban network is ~115 stations and gains one every few years. So we pay
 * for it once, here, commit the answer, and serve it from the bundle forever.
 *
 * This script is the one place allowed to spend quota on station lookups.
 * Running it costs roughly one request per seed below (~110). That pays for
 * itself in under a day of real autocomplete traffic.
 *
 * ## Running it
 *
 *   npm run stations:refresh                    # resume: only unresolved seeds
 *   npm run stations:refresh -- --all           # re-query every seed
 *   npm run stations:refresh -- --dry-run       # print the plan, spend nothing
 *   npm run stations:refresh -- --aliases-only  # re-apply aliases, spend nothing
 *
 * It writes after every seed, so an interrupted run keeps what it found and the
 * next run picks up where it stopped.
 *
 * ## Why it doesn't import lib/railradar.ts
 *
 * That module is the app's runtime client: it carries the 8s request timeout,
 * the shared cache and the quota counter, all of which are tuned for serving a
 * user standing on a platform. A build tool wants the opposite — slow, patient,
 * throttled well under the per-minute ceiling, and deliberately *not* counted
 * against the runtime quota budget. Keeping them separate keeps both honest.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** The shipped artefact. Imported by `lib/stations.ts`, so every byte reaches the browser. */
const OUTPUT_PATH = join(REPO_ROOT, "lib", "data", "mumbai-stations.json");

/**
 * Resume bookkeeping, kept out of the shipped file on purpose: the seed list is
 * ~2KB that every visitor would otherwise download for nothing. Committed, so a
 * re-run on another machine still resumes instead of re-spending quota.
 */
const PROGRESS_PATH = join(REPO_ROOT, "scripts", "stations-progress.json");

const BASE_URL = "https://api.railradar.in/v1";

// The documented ceiling is 10 requests/minute. 6.5s between calls is ~9.2/min,
// which leaves headroom for a retry without tripping RATE_LIMIT.
const THROTTLE_MS = 6_500;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;

/**
 * One seed per station of the Mumbai suburban network, grouped by line. These
 * are search *substrings*, not official names — RailRadar returns up to 10
 * fuzzy matches per query, so a seed often pulls in its neighbours for free
 * (e.g. "matunga" also returns Matunga Road, "kopar" also returns Kopar
 * Khairane). Everything is deduped by code afterwards, so overlap is harmless
 * and only the seed *count* costs quota.
 */
const SEEDS = [
  // Western line: Churchgate to Dahanu Road.
  "churchgate",
  "marine lines",
  "charni",
  "grant road",
  "mumbai central",
  "mahalaxmi",
  "lower parel",
  "prabhadevi",
  "dadar",
  "matunga",
  "mahim",
  "bandra",
  "khar",
  "santacruz",
  "vile parle",
  "andheri",
  "jogeshwari",
  "ram mandir",
  "goregaon",
  "malad",
  "kandivali",
  "borivali",
  "dahisar",
  "mira road",
  "bhayandar",
  "naigaon",
  "vasai",
  "nallasopara",
  "virar",
  "vaitarna",
  "saphale",
  "kelve",
  "palghar",
  "umroli",
  "boisar",
  "vangaon",
  "dahanu",

  // Central line: CSMT to Kasara and Khopoli.
  "csmt",
  "masjid",
  "sandhurst",
  "byculla",
  "chinchpokli",
  "currey road",
  "parel",
  "sion",
  "kurla",
  "vidyavihar",
  "ghatkopar",
  "vikhroli",
  "kanjurmarg",
  "bhandup",
  "nahur",
  "mulund",
  "thane",
  "kalva",
  "mumbra",
  "diva",
  "kopar",
  "dombivli",
  "thakurli",
  "kalyan",
  "shahad",
  "ambivli",
  "titwala",
  "khadavli",
  "vasind",
  "asangaon",
  "atgaon",
  "khardi",
  "umbermali",
  "kasara",
  "ulhasnagar",
  "vithalwadi",
  "ambernath",
  "badlapur",
  "vangani",
  "shelu",
  "neral",
  "bhivpuri",
  "karjat",
  "palasdhari",
  "kelavli",
  "dolavli",
  "lowjee",
  "khopoli",

  // Harbour line: CSMT to Panvel, and the Andheri branch.
  "dockyard",
  "reay road",
  "cotton green",
  "sewri",
  "vadala",
  "guru tegh bahadur",
  "chunabhatti",
  "tilak nagar",
  "chembur",
  "govandi",
  "mankhurd",
  "vashi",
  "sanpada",
  "juinagar",
  "nerul",
  "seawood",
  "belapur",
  "kharghar",
  "manasarovar",
  "khandeshwar",
  "panvel",

  // Trans-harbour line.
  "airoli",
  "rabale",
  "ghansoli",
  "turbhe",
] as const;

/**
 * Hand-written aliases, keyed by **station code**.
 *
 * Indian Railways' own names are abbreviations nobody types: the record behind
 * "Churchgate" reads `BMBY CHURCH GTE` in timetable data, and CSMT has been VT,
 * CST and CSTM within living memory. Search that only matches the official name
 * fails the user in exactly the moment they are in a hurry. Aliases are matched
 * case-insensitively and rank below name and code matches.
 *
 * Keyed by code rather than by seed on purpose: codes are stable and exact, so
 * this map can be re-applied to an existing bundle with `--aliases-only`, which
 * costs nothing. Editing aliases should never mean re-harvesting.
 */
const ALIASES: Record<string, string[]> = {
  CCG: ["churchgate", "church gate", "bmby church gte", "cg"],
  CSMT: [
    "cst",
    "cstm",
    "vt",
    "victoria terminus",
    "bombay vt",
    "mumbai cst",
    "chhatrapati shivaji",
    "chhatrapati shivaji maharaj terminus",
    "shivaji terminus",
  ],
  DR: ["dadar western", "dadar central", "ddr"],
  ADH: ["andheri"],
  BVI: ["borivli"],
  TNA: ["thana"],
  KYN: ["kalyan"],
  PNVL: ["panvel"],
  BSR: ["vasai", "bassein road"],
  BA: ["bandra", "bandra terminus", "bdts"],
  CLA: ["kurla", "lokmanya tilak", "ltt"],
  GC: ["ghatkopar", "ghat kopar"],
  MLND: ["mulund"],
  VVH: ["vidya vihar"],
  SION: ["shion"],
  BY: ["bhaykhala", "bhayakhala"],
};

interface RailRadarStation {
  code: string;
  name: string;
  city: string | null;
  popularity: number;
  isActive: boolean;
}

/** What we actually bundle. Trimmed to what the autocomplete renders and sends. */
interface BundledStation {
  code: string;
  name: string;
  aliases?: string[];
}

interface StationBundle {
  /** When this file was generated, so a stale bundle is visible in review. */
  generatedAt: string;
  source: string;
  stations: BundledStation[];
}

interface Progress {
  /** Seeds already resolved, so a resumed run doesn't re-spend quota on them. */
  resolvedSeeds: string[];
}

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const refreshAll = args.has("--all");
/** Re-apply the alias map to the committed bundle. Spends no quota. */
const aliasesOnly = args.has("--aliases-only");

function readExistingBundle(): StationBundle {
  try {
    const parsed = JSON.parse(readFileSync(OUTPUT_PATH, "utf8")) as StationBundle;
    // Named explicitly rather than spread, so no bookkeeping field from an older
    // format can survive into the file that ships to the browser.
    return {
      generatedAt: parsed.generatedAt,
      source: parsed.source,
      stations: parsed.stations ?? [],
    };
  } catch {
    return {
      generatedAt: new Date().toISOString(),
      source: `RailRadar ${BASE_URL}/lookup/search/stations`,
      stations: [],
    };
  }
}

function readProgress(): Progress {
  try {
    return JSON.parse(readFileSync(PROGRESS_PATH, "utf8")) as Progress;
  } catch {
    // Older bundles kept the seed list inside the shipped file. Recover it once
    // so an upgrade doesn't look like "nothing has been resolved" and re-spend
    // a hundred requests.
    try {
      const legacy = JSON.parse(readFileSync(OUTPUT_PATH, "utf8")) as {
        resolvedSeeds?: string[];
      };
      if (legacy.resolvedSeeds?.length) {
        return { resolvedSeeds: legacy.resolvedSeeds };
      }
    } catch {
      // No bundle yet either; fall through to a fresh start.
    }
    return { resolvedSeeds: [] };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Strips the decoration Indian Railways puts on station names so a seed can be
 * matched against a name: "Vasai Road" and "Diva Jn" both reduce to their stem.
 */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(jn|junction|halt|p\.?\s*h\.?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * True when a result is the station the seed was aiming at, rather than a
 * same-prefix station on the other side of the country. Requires a whole-word
 * match on the stem, so "sion" accepts "Sion" and "Sion Koliwada" but not
 * "Sionli".
 */
function isSeedTarget(seed: string, name: string): boolean {
  const stem = normalise(seed);
  const target = normalise(name);
  return target === stem || target.startsWith(`${stem} `);
}

async function searchStations(query: string): Promise<RailRadarStation[]> {
  const apiKey = process.env.RAILRADAR_API_KEY;
  if (!apiKey) {
    throw new Error(
      "RAILRADAR_API_KEY is not set. Run via `npm run stations:refresh`, which loads .env.local."
    );
  }

  const url = new URL(`${BASE_URL}/lookup/search/stations`);
  url.searchParams.set("q", query);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.status === 429) {
        // Back off hard: burning through the per-minute ceiling here would
        // also starve the live app if someone is using it.
        const wait = THROTTLE_MS * attempt * 4;
        console.warn(`  rate limited, waiting ${wait / 1000}s`);
        await sleep(wait);
        continue;
      }

      const body = await response.json();
      if (!body?.success) {
        throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
      }
      return (body.data ?? []) as RailRadarStation[];
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) throw err;
      console.warn(`  attempt ${attempt} failed (${String(err)}), retrying`);
      await sleep(THROTTLE_MS * attempt);
    }
  }

  return [];
}

function write(bundle: StationBundle, progress: Progress): void {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  bundle.stations.sort(
    (a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code)
  );
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

  progress.resolvedSeeds.sort();
  writeFileSync(PROGRESS_PATH, `${JSON.stringify(progress, null, 2)}\n`, "utf8");
}

/**
 * Writes the alias map onto the bundle. Purely local, so it runs at the end of
 * every harvest and is also the whole job under `--aliases-only`.
 */
function applyAliases(bundle: StationBundle): void {
  const byCode = new Map(bundle.stations.map((s) => [s.code, s]));

  for (const [code, aliases] of Object.entries(ALIASES)) {
    const station = byCode.get(code);
    if (!station) {
      console.warn(`  ! ${code} is not in the bundle; its aliases were dropped`);
      continue;
    }
    station.aliases = [...new Set(aliases)].sort();
  }

  // Anything left over from an older alias map should not linger.
  for (const station of bundle.stations) {
    if (!ALIASES[station.code] && station.aliases) delete station.aliases;
  }
}

async function main(): Promise<void> {
  const bundle = readExistingBundle();
  const progress = readProgress();
  if (aliasesOnly) {
    applyAliases(bundle);
    write(bundle, progress);
    console.log(
      `Aliases re-applied to ${bundle.stations.length} stations. 0 upstream requests.`
    );
    return;
  }

  const byCode = new Map(bundle.stations.map((s) => [s.code, s]));
  const done = new Set(refreshAll ? [] : progress.resolvedSeeds);
  const todo = SEEDS.filter((seed) => !done.has(seed));

  console.log(`${SEEDS.length} seeds, ${todo.length} to query.`);
  console.log(
    `Estimated upstream cost: ${todo.length} requests, about ${Math.ceil(
      (todo.length * THROTTLE_MS) / 60_000
    )} minutes at ${THROTTLE_MS / 1000}s spacing.`
  );

  if (dryRun) {
    console.log("--dry-run: nothing was requested.");
    return;
  }

  let calls = 0;
  let added = 0;

  for (const [index, seed] of todo.entries()) {
    if (calls > 0) await sleep(THROTTLE_MS);

    process.stdout.write(`[${index + 1}/${todo.length}] ${seed} ... `);
    let results: RailRadarStation[];
    try {
      results = await searchStations(seed);
      calls++;
    } catch (err) {
      console.log(`FAILED (${String(err)})`);
      continue;
    }

    // Keep Mumbai's own stations, plus the station this seed was aiming at —
    // the outer suburban termini (Palghar, Karjat, Kasara) are on the network
    // but sit in their own municipality, and dropping them would leave real
    // commuters unable to pick their home station.
    const keep = results.filter(
      (s) => s.isActive && (s.city === "Mumbai" || isSeedTarget(seed, s.name))
    );

    let newHere = 0;
    for (const station of keep) {
      if (!byCode.has(station.code)) {
        const entry: BundledStation = { code: station.code, name: station.name };
        byCode.set(station.code, entry);
        bundle.stations.push(entry);
        newHere++;
        added++;
      }
    }

    if (!progress.resolvedSeeds.includes(seed)) progress.resolvedSeeds.push(seed);
    bundle.generatedAt = new Date().toISOString();
    write(bundle, progress);

    console.log(`${keep.length} kept, ${newHere} new (total ${byCode.size})`);
  }

  applyAliases(bundle);
  write(bundle, progress);

  console.log(`\nDone. ${calls} upstream requests, ${added} stations added.`);
  console.log(`${byCode.size} stations in ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
