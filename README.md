# Class Commute

Tells students the best-timed Mumbai local train to catch from their home
station to reach college on time for a given class start time.

Given a home station, a college station, a class start time, and a buffer
(minutes you want free before class), it finds the **latest train that still
arrives by (class start − buffer)** — the one that cuts it closest without
being late — plus 2-3 earlier backup options.

## Tech stack

- Next.js (App Router) + TypeScript
- Tailwind CSS
- Data source: [RailRadar API](https://railradar.in) (`/v1/lookup/search/stations`,
  `/v1/trains/between/{from}/{to}`)
- Deploy target: Vercel

The RailRadar API key is only ever used server-side, in Next.js API routes
(`app/api/*`). The browser never sees it — the client calls our own
`/api/stations/search` and `/api/best-train` routes, which proxy to RailRadar.

## Project structure

- `lib/railradar.ts` — typed RailRadar API client (station search, trains
  between two stations) and error handling
- `lib/bestTrain.ts` — the best-train matching/ranking logic (pure functions)
- `lib/format.ts` — small display-formatting helpers
- `app/api/stations/search/route.ts` — autocomplete proxy endpoint
- `app/api/best-train/route.ts` — main matching endpoint
- `components/StationAutocomplete.tsx` — accessible combobox for station input
- `components/BufferStepper.tsx` — buffer-minutes input
- `components/ResultCard.tsx` — train result card (best pick / alternative)
- `app/page.tsx` — the form + results page

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and add your RailRadar API key:

   ```bash
   cp .env.example .env.local
   ```

   ```
   RAILRADAR_API_KEY=your_railradar_api_key_here
   ```

   Get a key at [railradar.in](https://railradar.in). The free tier allows
   1,000 requests/month and is rate-limited to **10 requests/minute** — the
   app surfaces a clear "please wait a minute" message if that limit is hit.

3. Run the dev server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Notes on the data

- RailRadar's station search matches against Indian Railways' literal
  (often abbreviated) station names — e.g. searching "Churchgate" won't
  match, but "church" does, since the real record is "BMBY CHURCH GTE". The
  autocomplete component handles partial/fuzzy queries fine; users should
  just pick from the dropdown rather than typing full names and pressing enter.
- RailRadar returns **HTTP 200 with an empty result**, not a 404, for a
  station code it doesn't recognize (it echoes the invalid code back as the
  station name). The app detects this and shows an "unrecognized station"
  message instead of a false "no trains found."
- Only stations tagged `city: "Mumbai"` are surfaced in autocomplete, to keep
  results relevant to the Mumbai suburban network (this also covers outer
  stations like Thane, Kalyan, Panvel, and Vasai Road).

## Deploying to Vercel

1. Push this repo to GitHub (or GitLab/Bitbucket) and import it in the
   [Vercel dashboard](https://vercel.com/new).
2. In the project's **Settings → Environment Variables**, add:
   - `RAILRADAR_API_KEY` — your RailRadar API key (same value as in
     `.env.local`). Add it for all environments you plan to use
     (Production, Preview, Development).
3. No other configuration is needed — this is a standard Next.js App Router
   project, so Vercel's default build (`next build`) and Node runtime for the
   API routes work out of the box.
4. Deploy. Every push to the connected branch will redeploy automatically.
