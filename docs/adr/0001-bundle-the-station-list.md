# 1. Bundle the station list instead of searching it upstream

- **Status:** Accepted
- **Date:** 2026-09-09

## Context

The RailRadar free tier allows **1,000 requests a month and 10 a minute** — about
33 a day for the entire user base. That makes the upstream call the scarcest
resource in this project, scarcer than CPU, memory or bundle bytes.

Station autocomplete originally called `/api/stations/search`, which called
RailRadar's station lookup, on a debounce as the user typed. Two station fields
per journey, several typing bursts each: a single student planning a single trip
could spend four to six upstream calls **before** asking for a timetable at all.
At roughly 33 calls a day for everyone, a handful of users typing carefully could
exhaust the day's budget without anyone receiving a train time. It was by a wide
margin the largest drain in the app.

The set being searched is also nearly static. Mumbai's suburban network does not
gain stations between deployments.

## Options considered

1. **Keep the upstream search, tune the debounce.** Cheaper, not cheap. It scales
   the cost with typing speed rather than removing it, and a longer debounce
   makes the field feel broken on exactly the bad connection it needs to survive.
2. **Cache search results server-side.** Helps repeated prefixes, does nothing
   for the long tail, and still spends a call on every genuinely new prefix.
3. **Generate the list at build time and search it in the browser.** Moves the
   cost to build time, where it is paid once, by a developer, on a good network.

## Decision

Option 3. `scripts/build-stations.mts` queries RailRadar on its own throttle and
writes `lib/data/mumbai-stations.json` — **121 stations, 8.7 KB** — which is
committed. `lib/stations.ts` is a pure, synchronous ranked search over it.

Because the search is local there is no debounce and no minimum query length:
matches render on the first keystroke. The generator is the only thing in the
repo allowed to spend quota on station lookups, and it resumes from
`scripts/stations-progress.json` rather than re-spending on seeds it has already
resolved.

A fallback remains at `/api/stations/search`, deliberately hard to reach: it
needs two or more characters, no local match at all, and an explicit tap.

## Consequences

- Typing costs **zero** upstream calls, down from four to six per journey.
- Autocomplete works with no network at all, which is what makes
  [ADR 3](0003-offline-first.md) coherent — the app is useful before a timetable
  request is even attempted.
- The list can go stale. A new or renamed station needs `npm run
  stations:refresh` and a commit. Given the network's rate of change this is a
  non-issue in practice, and the fallback covers the gap.
- 8.7 KB is added to the client bundle, inside a JS chunk. Measured, and not
  worth lazy-loading: the JavaScript around it is an order of magnitude larger.
- The bundled list carries hand-written `aliases`, because the railway's own
  names are abbreviations nobody types — "vt", "cst" and "csmt" all have to find
  the same station, and "churchgate" has to find `BMBY CHURCH GTE`.
