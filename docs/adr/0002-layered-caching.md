# 2. Layer the caches, and know which layer carries production

- **Status:** Accepted
- **Date:** 2026-09-09

## Context

With [ADR 1](0001-bundle-the-station-list.md) removing the typing cost, the
remaining upstream spend is the timetable lookup itself — and 1,000 requests a
month still has to cover every user. Two students on the same line asking the
same question at the same time is the common case here, not the edge case: a
college draws from a corridor, and everyone is trying to arrive by nine.

## Options considered

1. **One cache.** Simplest, but any single layer is wrong somewhere. An
   in-process cache does nothing across instances; a CDN cache does nothing for a
   burst that arrives before the first response is cached; neither bounds a
   hostile caller.
2. **A shared cache (Redis or similar).** Correct across instances, and more
   moving parts than the thing it protects — this app has no database, no auth
   and no state worth that operational surface.
3. **Layers, cheapest first, each absorbing what it is actually good at.**

## Decision

Option 3. Five layers stand between a user and RailRadar:

| # | Layer | Scope | What it buys |
|---|---|---|---|
| 1 | Bundled station list | The browser | Autocomplete for free ([ADR 1](0001-bundle-the-station-list.md)) |
| 2 | **Edge cache** (`Cache-Control`) | **The whole fleet** | **Carries production load** |
| 3 | In-instance cache (`lib/cache.ts`) | One lambda instance | Absorbs a burst; enables coalescing |
| 4 | Rate limiter (`lib/rateLimit.ts`) | One lambda instance | Bounds a hostile caller |
| 5 | Stale-serving (`lib/quota.ts`) | One lambda instance | An honest old answer instead of an error |

**The distinction that matters most is between layers 2 and 3, and it is easy to
get backwards.** The in-instance cache is *per lambda instance*: it helps a burst
that hits one warm instance, and does nothing for the instance next door. It is
not what carries production. **The edge cache is** — the CDN answers the second
student from the first student's response, without any function running at all.
When reasoning about scale, layer 2 is the one that counts. Layer 3 is a burst
absorber, and the thing that makes in-flight coalescing possible: N concurrent
identical requests become one upstream call rather than N.

The edge TTL varies with the answer, because staleness is not uniform. A
*tomorrow* result is stable for hours (`s-maxage=21600`); a *today* result decays
every minute as trains depart (`s-maxage=60`).

## Consequences

- Two students on one line cost one upstream call, and the second is served
  without invoking a function at all.
- The quota counters in `lib/quota.ts` are per instance, so they are a **floor**
  on real usage, not a ledger. `/api/dev/quota` reports them and 404s in
  production precisely because they would mislead there.
- The rate limiter shares that limitation: a distributed caller spread across
  warm instances gets a multiple of the limit. It bounds the blast radius rather
  than enforcing an exact ceiling, which is the honest goal for an app with no
  auth and no shared store.
- `GET` rather than `POST` on the main route is a caching decision, not a REST
  one — a `Cache-Control` header on a POST is inert.
- Every upstream call is logged with its cache-hit status, so the layering can be
  checked against reality rather than assumed:

  ```
  [railradar] UPSTREAM trains/between | month 1/1000 | today 1 upstream, 0 cached | BVI:CCG:2026-09-08
  [railradar] CACHE    trains/between | month 1/1000 | today 1 upstream, 1 cached | BVI:CCG:2026-09-08
  ```
