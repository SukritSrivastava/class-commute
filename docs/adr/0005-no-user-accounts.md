# 5. No user accounts

- **Status:** Accepted
- **Date:** 2026-09-09

## Context

The app has an obvious pull towards accounts. A student takes the same journey
every weekday; saving "home station, college station, class time" and having it
restored on any device is the first feature anyone asks for. Accounts would also
make per-user rate limiting exact rather than approximate
([ADR 2](0002-layered-caching.md)), and would allow usage analytics.

Against that: the app is opened by someone who is late, standing on a platform,
on a bad connection. Anything between opening it and seeing a train time is
weighed against that.

## Options considered

1. **Full accounts** — email or OAuth, a session, a user table, a database.
2. **Anonymous device identity** — a cookie or generated id, server-side storage
   keyed by it. No login, but a user record and a database all the same.
3. **No accounts. Keep per-device state on the device.**

## Decision

Option 3. There is no auth, no user table and no database anywhere in this
project. What would have been "your saved journey" is:

- `localStorage` for the last route asked about, which drives the quiet
  background refresh on open;
- IndexedDB for answered routes and their timestamps
  ([ADR 3](0003-offline-first.md)).

Both are per-device, both are invisible, and neither requires the user to do
anything or the app to know who they are.

The deciding argument is the first-run path. A login screen in front of a train
time is a login screen in front of the only thing the app does — and it would be
shown at the worst possible moment, to someone with one bar of signal who is
deciding whether to run. **Speed to first useful answer beats completeness of
features**, and an account is a cost paid before the first answer, forever, by
everyone.

The secondary argument is that accounts are not free to *run*. A user table means
a database, which means a schema, migrations, backups, a connection from a
lambda, and a privacy surface holding minors' daily physical movements. That is a
serious thing to hold, and this app has no need to hold it.

## Consequences

**What it costs:**

- **No sync across devices.** Saved answers on a phone are not on a laptop. For
  an app used on a phone, on a platform, this is close to free.
- **No preferences that survive clearing site data.** A user who clears their
  browser re-enters two stations and a time. Roughly fifteen seconds, and the
  bundled station list makes it fast ([ADR 1](0001-bundle-the-station-list.md)).
- **Rate limiting stays per-IP and approximate.** With accounts it could be
  exact. Accepted: the limiter's job is to bound the blast radius of a `curl`
  loop, not to meter individuals.
- **No analytics on real usage.** There is no record of which routes are popular,
  so the interchange model in `lib/network.ts` is informed by knowledge of the
  city rather than by data.
- **No personalisation.** No "your usual train", no notifications, no history.

**What it buys:**

- The app is usable **three seconds after landing on it**, by someone who has
  never seen it before, with no account, no cookie banner and no consent dialog.
- There is no personal data to leak, subpoena, or be responsible for — which
  matters more than usual given the user base is largely students, some of them
  minors, and the data would be their daily movements.
- No database means no migrations, no connection pooling from a serverless
  function, and no operational surface beyond a static build and one API route.
- The whole project stays inside a free tier.

This is the decision most likely to be revisited if the app ever gained a real
user base. It should be revisited on evidence of demand, not on the assumption
that a serious app must have logins.
