/// <reference lib="webworker" />
import { Serwist, NetworkFirst, StaleWhileRevalidate } from "serwist";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";

/**
 * The service worker.
 *
 * Someone opens this app standing on a platform at Borivali with one bar of
 * signal. The network is not a dependency we get to assume — it is the thing
 * most likely to be missing at the exact moment the answer is needed. So the
 * shell, the CSS and the station list are all on the device before they are
 * wanted, and the only thing that ever needs the network is the timetable.
 *
 * **The fonts are not precached, deliberately.** Serwist's default glob does
 * not match `.woff2`, and adding it would put ~140KB of display and body faces
 * into the first-visit download — on the bad connection this whole design is
 * about — to change how offline text *looks* rather than whether it is there.
 * `next/font` emits a metric-matched local fallback for each face, so offline
 * text is fully legible and shifts nothing; the real faces arrive from the HTTP
 * cache on any visit that has already loaded once. Verify with the manifest
 * dump rather than assuming: this comment has been wrong before.
 *
 * Bundled by `@serwist/cli` (see `serwist.config.mjs`), which injects the
 * precache manifest where `self.__SW_MANIFEST` appears below.
 */

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,

  // Take over as soon as a new worker is ready rather than waiting for every
  // tab to close. A stale shell on a phone that is never fully closed is worse
  // than a one-refresh handover.
  skipWaiting: true,
  clientsClaim: true,

  // Serve the precached shell for a navigation the network can't answer. This
  // is the line between "the app opens offline" and a browser error page.
  navigationPreload: true,
  fallbacks: {
    entries: [
      {
        url: "/",
        matcher: ({ request }) => request.mode === "navigate",
      },
    ],
  },

  runtimeCaching: [
    /**
     * The timetable endpoint. Network-first with a short timeout: online we
     * want today's answer, but a request that hangs on a weak signal must not
     * hold the screen — after 4 seconds the cached answer is better than a
     * spinner.
     *
     * The app *also* keeps its own copy in IndexedDB (`lib/offlineCache.ts`),
     * which is what carries the "as of" timestamp and the 7-day eviction. This
     * cache is the fast path; that one is the durable, labelled one.
     */
    {
      matcher: ({ url, sameOrigin }) =>
        sameOrigin && url.pathname === "/api/best-train",
      handler: new NetworkFirst({
        cacheName: "best-train",
        networkTimeoutSeconds: 4,
        plugins: [
          {
            // Only 200s. Caching a 404 "no train reaches you in time" would
            // replay yesterday's bad news at tomorrow's departure.
            cacheWillUpdate: async ({ response }) =>
              response.status === 200 ? response : null,
          },
        ],
      }),
    },

    /**
     * Station search. Only reachable by an explicit "search all stations" tap,
     * and answers are effectively permanent, so serve from cache and refresh
     * behind the user.
     */
    {
      matcher: ({ url, sameOrigin }) =>
        sameOrigin && url.pathname === "/api/stations/search",
      handler: new StaleWhileRevalidate({ cacheName: "station-search" }),
    },

    /**
     * Google's font files. They are already precached as part of the build
     * output when self-hosted by `next/font`, but a stylesheet that reaches
     * fonts.gstatic.com at runtime would otherwise fail offline and drop the
     * display face — the one thing carrying the app's identity.
     */
    {
      matcher: ({ url }) =>
        url.origin === "https://fonts.gstatic.com" ||
        url.origin === "https://fonts.googleapis.com",
      handler: new StaleWhileRevalidate({ cacheName: "google-fonts" }),
    },
  ],
});

// `skipWaiting` and `clientsClaim` above already install the handovers; this
// wires up install/activate/fetch for the precache and the routes.
serwist.addEventListeners();
