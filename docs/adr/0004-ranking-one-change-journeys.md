# 4. Rank one-change journeys against direct ones, with a penalty

- **Status:** Accepted
- **Date:** 2026-09-09

## Context

RailRadar's `/trains/between` returns **direct trains only**. Ask it for Borivali
to CSMT and it answers with an empty list, because no such train exists — you
change at Dadar. Western-to-Central is a huge share of real Mumbai commutes, so
"no trains found" would be wrong for a large fraction of the people this app is
for.

Planning the change ourselves raises a ranking question the app did not have
before: when a direct train and a one-change journey both work, which is *best*?

The app's promise is the **latest** train that still gets you there on time, so a
later departure is normally better — it is more time at home. Ranking on that
alone would prefer an interchange leaving 08:10 over a direct leaving 08:00.

## Options considered

1. **Direct only.** Correct for the API, wrong for the city. Answers "no route"
   for a journey people make every day.
2. **Rank purely on departure time.** Treats a fifteen-minute gain and a missed
   connection as commensurable, which they are not.
3. **Rank in one list, but score an interchange as if it left earlier than it
   does.**

## Decision

Option 3, with a **15-minute penalty** (`INTERCHANGE_PENALTY_MINUTES`).

The two outcomes are not symmetric, and that asymmetry is the whole argument:

- Leaving fifteen minutes earlier **costs fifteen minutes**. It is an
  inconvenience, and it is bounded.
- Missing a connection **costs the whole journey**. You are on the bridge at
  Dadar watching your train leave, with no plan, and you are late for class.
  That is the failure this app exists to prevent, and its cost is not fifteen
  minutes.

A direct train has no connection to miss. So an interchange has to be
*substantially* better, not marginally better, to be worth that risk — and it is
scored as though it departed fifteen minutes earlier than it does. An interchange
leaving 08:10 loses to a direct leaving 08:00; one leaving 08:20 wins, because by
then it really is buying meaningful time.

Fifteen is roughly the frequency of a Mumbai local in the peak: it is the cost of
the recovery if the connection fails and you catch the next one.

The penalty applies to the comparison only. **The times shown are never
adjusted.**

### Why one change and not two

- **The network doesn't need it.** Two changes on the Mumbai suburban network
  almost always describes a journey better served by another mode.
- **Risk multiplies.** Each leg is another connection that can be missed, and the
  argument above compounds rather than adding.
- **It costs quota.** A one-change journey already costs three upstream calls —
  one to prove no direct train works, then two legs. A second change would make
  it five, against a 1,000-a-month ceiling
  ([ADR 2](0002-layered-caching.md)).

### How it knows a change is possible

`lib/network.ts` is a hand-authored model of the network: which line each station
sits on, and where the lines meet. No API tells us this, and probing candidate
interchanges to find out would spend the month's quota on guesses. Dadar is two
station codes — `DDR` on Western, `DR` on Central — because it is two buildings
sharing a footbridge, so interchanges carry a code *per line*.

Supporting constants: transfers default to **8 minutes** and Dadar overrides to
**10**, because its change is a staircase, a bridge and another staircase, and at
08:30 the bridge is the bottleneck. Connections leaving more than **30 minutes**
on the platform are not offered at all — past that it stops being a connection
and starts being a wait.

## Consequences

- Western-to-Central journeys are answered instead of refused.
- A station missing from `lib/network.ts` degrades safely: no plan is found, and
  the app answers direct-only rather than inventing a route.
- The three-call cost is affordable because the legs are **hub pairs**: every
  Western-to-Central commuter produces some variation of `… → DDR` and `DR → …`,
  so the leg cache converges far harder than end-to-end pairs ever could.
  Measured against the live API: the first such journey costs 3 calls, an
  identical repeat costs 0, and a different Western-to-Central journey reuses
  whichever leg it shares.
- A journey *to* the far half of an interchange (Borivali to Dadar Central) is
  answered as "no route" rather than "ride to Dadar Western and walk over the
  bridge". See Known limitations in the README.
- The penalty is a judgement, not a measurement. It is a single named constant so
  it can be argued with and changed in one place.
