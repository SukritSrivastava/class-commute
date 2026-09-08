@AGENTS.md

# Class Commute

A single-page tool for Mumbai students: pick your home station, your college
station, your class start time and a buffer, and it tells you the **latest**
local train that still gets you there on time — plus a few earlier backups.
It reads live schedule data from the RailRadar API through a thin server-side
layer; there is no database, no auth, and no persisted state.

## Non-negotiables

**1. `RAILRADAR_API_KEY` is server-side only.**
It is read in exactly one place — `lib/railradar.ts` — via `process.env`.
It must never be referenced in a client component, never be prefixed
`NEXT_PUBLIC_`, never be echoed in a response body or an error message, and
never be passed as a prop. If a client needs data from RailRadar, it goes
through a route in `app/api/`. No exceptions.

**2. The free tier is 1,000 requests/month and 10/minute.**
That is roughly 33 requests a day for the entire user base, which makes the
upstream call the scarcest resource in this project — scarcer than CPU, memory
or bundle bytes. **Cached or bundled data always wins over a fresh call.**

Five layers stand between a user and RailRadar, cheapest first. Know which one
should absorb your case before you add a call:

1. **The bundled station list** (`lib/data/mumbai-stations.json`). Autocomplete
   is answered in the browser, so typing costs nothing. This was the single
   largest drain before it existed. Regenerate with `npm run stations:refresh`;
   never put station lookup back on the typing path.
2. **The edge cache** — the `Cache-Control` header on `/api/best-train`. *This
   is the layer that carries production load*: two students on the same line
   share one upstream call because the CDN answers the second.
3. **The in-instance cache** (`lib/cache.ts`), 6h TTL keyed
   `from:to:journeyDate`, with an in-flight map so N concurrent identical
   requests make one call rather than N. Per lambda instance, so it helps the
   burst, not the fleet.
4. **The rate limiter** (`lib/rateLimit.ts`). One anonymous POST can cost one
   upstream call; without this a `curl` loop drains the month in a minute.
5. **Graceful degradation** (`lib/quota.ts`). Past 85% of the month, and
   whenever upstream fails, a stale cached timetable is served with an "as of"
   timestamp instead of an error.

Concretely: never call upstream on mount or on render, never call it in a loop
over stations, and never call it to validate something you can validate
locally. Every call goes through `lib/railradar.ts` so it lands in the counter;
a burst past 10/minute returns `RATE_LIMIT`, which surfaces as a dead app.

**3. All date and time reasoning uses `Asia/Kolkata`, explicitly.**
Vercel runs in UTC, so `new Date().getDay()`, `getHours()`, `toLocaleString()`
without a `timeZone`, and anything else that reads the server's local clock are
all wrong here — silently, and only for the ~5.5 hours a day where UTC and IST
fall on different calendar days. **Every Asia/Kolkata concern lives in
`lib/time.ts`** — `nowInMumbai`, `weekdayInMumbai`, `minutesSinceMidnight`,
`resolveJourney` — and nothing else may read the wall clock. Scattering this
logic is how the app once recommended a train that had already left. Train
`HH:MM` strings from RailRadar are already IST wall clock — treat them as plain
strings and compare them as minute offsets, never by constructing a `Date`.

**4. This is a tool used in a hurry, on a phone, on bad signal.**
Someone is standing on a platform deciding whether to run. Speed to first
useful answer beats everything else: beats visual polish, beats animation,
beats completeness of information, beats clever features. Guard every kilobyte
added to the client bundle and every millisecond added to the critical path.
When a tradeoff is unclear, pick the one that shows a train number sooner.

## Architecture

Four layers, with a strict one-way dependency: `app/api/*` → `lib/*`, never
the reverse, and `lib/bestTrain.ts` never imports `lib/railradar.ts` for
anything but types.

**`lib/time.ts` — the only place that knows about Asia/Kolkata.**
Owns the wall clock (`nowInMumbai`, `minutesSinceMidnight`), the calendar
(`weekdayInMumbai(offsetDays)`), the `HH:MM` arithmetic (`toMinutes`,
`effectiveMinutes`), and the journey-date rule (`guessJourneyDay`,
`resolveJourney`). Every function takes the instant it should read as a
parameter, defaulting to `new Date()`, so callers can pin it in tests. It
imports nothing.

**`lib/stations.ts` + `lib/data/mumbai-stations.json` — the free path.**
The committed station list and a pure, synchronous ranked search over it (name
and code prefix beat substring beat alias). No network, so the autocomplete has
no debounce and no minimum query length. `scripts/build-stations.mts` generates
the JSON and is the only thing allowed to spend quota on station lookups;
`aliases` there is what makes "churchgate" find `BMBY CHURCH GTE`.

**`lib/cache.ts` — TTL cache and request coalescing.** Read its header comment
before reasoning about caching: it explains which layer is the in-instance one
and which is the edge one, and why only the second matters at scale.

**`lib/quota.ts` — upstream call accounting.** Counts calls by endpoint and IST
day, logs every one with its cache-hit status, and decides when to start
serving stale. Counters are per instance, so they are a floor on real usage,
not a ledger. `/api/dev/quota` reports them, and 404s in production.

**`lib/rateLimit.ts` — per-IP sliding window** over this app's own routes.

**`lib/railradar.ts` — the only place that talks to the network.**
Owns the base URL, the API key, the 8s timeout, the `Authorization` header, and
the unwrapping of RailRadar's `{ success, data }` / `{ success, error }`
envelope. Every failure leaves this module as a `RailRadarError` carrying a
`kind` discriminant (`TIMEOUT`, `NETWORK`, `UNAUTHORIZED`, `RATE_LIMIT`,
`VALIDATION`, `API_ERROR`). Callers switch on `kind`, never on message text.
New upstream endpoints get a new exported function here, not an inline `fetch`
somewhere else.

**`lib/bestTrain.ts` — pure ranking logic.**
No I/O, no `fetch`, no `process.env`, and **no clock reads**. `pickBestTrain`
takes the train list, the class time, the buffer, the journey weekday and
`nowMinutes` as arguments and returns a pick. Passing the clock in is what
keeps it deterministic and testable without mocking time. Keep it that way.

Its one internal convention is the **journey timeline**: every minute count is
measured from midnight at the start of the boarding day, so departure, arrival,
`nowMinutes`, the cutoff and the class time are all directly comparable and an
arrival past midnight lands at 1440+ rather than at 20. `nowMinutes: null`
means the journey is a future date, where nothing has departed yet.

**`lib/schemas.ts` — zod request schemas.**
Both routes parse their input here. Every rule carries an explicit `error`
string: these messages reach a student on a platform, so a zod default leaking
through is a user-visible bug. `firstIssueMessage()` picks the one line to
show, in field-declaration order.

**`app/api/*` — thin handlers.**
Validate input, delegate to `lib/`, map errors to status codes, return. No
ranking logic, no date math, no `fetch` to RailRadar. The mapping today:
`RATE_LIMIT` → 429, `TIMEOUT` → 504, other `RailRadarError` → 502,
validation → 400, no usable result → 404, unknown → 500.

**`app/sw.ts` + `lib/offlineCache.ts` — working without a network.**
The app is opened on a platform where signal is the thing most likely to be
missing. `app/sw.ts` precaches the shell (and, inside its JS chunk, the station
list) so the app loads and autocomplete works with no connection at all;
`lib/offlineCache.ts` keeps answered routes in IndexedDB alongside *when* they
were fetched, which is what lets the UI label a saved answer honestly instead of
passing it off as live. Entries expire after 7 days.

`lib/requestBestTrain.ts` holds the decision table — live, else saved-and-
labelled, else an immediate statement of what is wrong and what to do. **Never
show a spinner that cannot resolve**: when the browser knows it is offline, no
request is made at all.

**`components/*` — client components.** They call `/api/*` on the same origin
and nothing else — and `StationAutocomplete` now calls nothing at all unless
the user explicitly asks to search beyond the bundle.

**`scripts/*` — build-time tools.** Not app code: they may talk to RailRadar
directly, on their own throttle, and are deliberately outside the runtime quota
counter. Run them by hand, commit what they generate.

## Conventions

- **Pure functions take `now`/`today` as parameters.** Anything that would
  otherwise read the clock accepts it as an argument so tests can pass a fixed
  value. Same for anything that would otherwise read `process.env`.
- **Every error response is `{ error, kind }`.** The client styles by `kind`
  (a `RATE_LIMIT` is amber and means "wait a minute"; a `NETWORK` is red and
  means "check your signal"). Adding a route without `kind` breaks that.
- **Error copy tells the user what to do next, not what broke.** "Please wait a
  minute and try again", not "upstream returned 429". Never leak an internal
  identifier, a URL, or a stack into user-facing text.
- **Tailwind v4 tokens live in `@theme` in `app/globals.css`.** There is no
  `tailwind.config.js` and there should not be one. Add a design token by
  adding a CSS variable in the `@theme` block.
- **Dark is the only theme.** The palette is neon on near-black and has no light
  counterpart, so `dark:` is pinned on via `@custom-variant` rather than
  following the system preference. Don't add a light mode or a theme toggle.
- **Every text colour in the palette clears WCAG AA on every surface.** That is
  a property of the token set, not of any one screen: `ink` / `ink-muted` /
  `ink-dim` are 16.17 / 6.86 / 5.04 against the lightest surface. `violet` is a
  gradient anchor, never text (3.06). Filled accents take `on-accent`
  (near-black) — white on magenta is 3.22 and fails. Measure before adding a
  colour; don't add one that only passes in one place.
- **One easing curve and two durations.** `--ease-signature` for everything;
  `--duration-ui` (200ms) for interface feedback, `--duration-content` (600ms)
  for content arriving. Nothing invents its own, and there is no third duration.
- **Motion may accompany information appearing; it may never gate it.** The
  primitives in `components/motion/` all render their children immediately,
  animate only opacity and transform, and degrade to the final still state with
  no JavaScript and under `prefers-reduced-motion`. A new animation that can
  leave content invisible is a bug, not a preference.
- **Conditional classes go through `cn()`** (`lib/cn.ts`). A ternary inside a
  template literal emits both sides and leaves the winner to stylesheet order.
- **Cached data is labelled, never disguised.** A saved answer always carries
  the moment it was fetched. The promise is "stale but honest beats an error",
  and that only holds while the label is accurate.
- **The service worker is built, not hand-edited.** `app/sw.ts` is the source;
  `public/sw.js` is generated by `npm run build` and gitignored. Serwist runs in
  configurator mode (`serwist.config.mjs`) because `@serwist/next`'s webpack
  plugin does not support Turbopack, which Next 16 uses by default.
- **Icons are generated too** — `npm run icons:build` renders `public/icons/`
  from the mark defined in `scripts/build-icons.mts`. Those PNGs *are*
  committed; edit the script, not the output.
- **Station data is generated, not hand-edited.** Change
  `scripts/build-stations.mts` — its seed list or its alias map — and re-run
  `npm run stations:refresh`, which resumes rather than re-spending quota on
  seeds it already resolved.
- **`@/` maps to the repo root** (`tsconfig.json` paths). Import as
  `@/lib/bestTrain`, not by relative path from a route.

## Data gotchas

These are non-obvious, cost real time to rediscover, and have all bitten this
codebase already.

**RailRadar matches Indian Railways' literal abbreviated station names.**
The names in the data are the railway's own shorthand, not the names people
use. Searching "Churchgate" returns nothing; the actual record is
`BMBY CHURCH GTE`. Expect `BDTS`-style truncation and dropped vowels
throughout. Never hardcode a human-friendly station name and assume it will
match, and never "fix" a search that returns empty by assuming the API is
broken — check the real abbreviation first.

**RailRadar returns HTTP 200 for station codes it does not recognize.**
It does not 404. It returns a success envelope with an empty `trains` array
and — the trap — it echoes the invalid code back in the `name` field. So a
request for the nonsense code `XXXX` comes back as
`{ from: { code: "XXXX", name: "XXXX" }, trains: [] }`, which looks like a
valid station that simply has no trains. `isRecognizedStation()` exists purely
to detect this, by checking that `name` differs from `code`. **Do not remove
it, and do not skip it on a new endpoint** — without it, a typo'd station shows
the user "no trains found" instead of "that isn't a station".

**`runDays` is a lowercase 3-letter array**, e.g. `["mon","tue","wed"]`.
Compare against the same form — `weekdayInMumbai()` produces it. A capitalized
or full-length day name silently matches nothing, which reads as "no trains
run today". Compare against the **journey** date's weekday, not today's: at
23:00 on Sunday, a 09:00 class is Monday's.

**A leg's `day` field is 1-indexed from departure, not a date.**
`day: 1` is the departure day, `day: 2` is the next calendar day, and so on.
A train leaving 23:50 and arriving 00:20 has `to.day === 2`. Sorting or
comparing arrival times by `HH:MM` alone puts that train first instead of last;
convert to absolute minutes with `(day - 1) * 1440` first, as
`effectiveMinutes()` does. This matters for late-evening journeys and is
invisible in daytime testing.
