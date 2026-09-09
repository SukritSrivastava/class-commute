# 3. Offline-first, because platforms have no signal

- **Status:** Accepted
- **Date:** 2026-09-09

## Context

This decision starts with an observation about the physical world rather than
about software: **the places people use this app are the places with no signal.**
Someone opens it standing on a platform at Borivali, at an underground station
entrance, or in a crowd at 08:30 when the local cell is saturated. An app that
needs connectivity fails at exactly the moment it is needed, and that failure is
not abstract — it is a person who does not know whether to run.

Timetables barely change day to day, so the app does not have to be online to be
correct. Yesterday's Borivali–Churchgate timetable is very nearly today's.

## Options considered

1. **Online-only, with a good error state.** Honest, and useless on a platform.
2. **Lean on the HTTP cache and hope.** Opaque: the app cannot tell how old the
   answer is, so it either lies about freshness or says nothing about it.
3. **Precache the shell, store answers on the device with their timestamp, and
   label anything served from storage.**

## Decision

Option 3.

- **The shell is precached.** A service worker (`app/sw.ts`, built by Serwist)
  precaches the app shell and its JS chunks — including the bundled station
  list — so the app loads and station search works with no connection at all.
- **Answers are stored on the device.** Successful responses go into IndexedDB
  keyed by route and journey date, **alongside the moment they were fetched**.
  Entries expire after 7 days.
- **Saved answers are labelled, never disguised.** Offline, the app shows "Saved
  answer, as of 9 Sept, 10:21 pm". The promise is *stale but honest beats an
  error*, and it only holds while the label is accurate.
- **No spinner that cannot resolve.** When the browser knows it is offline, no
  request is made at all. `lib/requestBestTrain.ts` holds the decision table:
  live, else saved-and-labelled, else an immediate statement of what is wrong and
  what to do about it.

## What is deliberately NOT available offline

- **A route this device has never asked about.** There is nothing to serve, and
  the app says so immediately rather than spinning. A first answer needs one
  moment of signal; after that the route works without it.
- **Live running status or delays.** The app has never offered these. It answers
  from the timetable, and the timetable is what is stored.
- **The install icons** (~240 KB). The OS installer fetches them while online, at
  install time. Precaching them would spend a quarter of a megabyte of the user's
  data on the exact bad connection this decision is about, to make something
  available offline that is only ever needed online.
- **The fonts** (~140 KB). Serwist's default glob does not match `.woff2`, and
  that is left alone deliberately: `next/font` emits a metric-matched local
  fallback for every face, so offline text is fully legible and shifts nothing.
  Precaching them would change how offline text *looks*, not whether it is there.

## Consequences

- The app is useful on a platform, which is the entire point.
- A user can be shown times up to 7 days old. This is accepted, and mitigated
  twice: by the label, and by a background refresh that quietly updates the last
  route on open if its saved answer is more than 15 minutes old — never blocking
  first paint, and never on a first visit.
- The service worker is generated, not hand-edited. `app/sw.ts` is the source;
  `public/sw.js` is built by `npm run build` and is gitignored.
- Serwist runs in configurator mode (`serwist.config.mjs`) because
  `@serwist/next`'s webpack plugin does not support Turbopack, which Next 16 uses
  by default.
- Offline behaviour has to be tested against a production build, because there is
  no service worker in dev: see the verification command in the README.
