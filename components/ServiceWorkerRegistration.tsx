"use client";

import { useEffect } from "react";
import { evictExpired } from "@/lib/offlineCache";

/**
 * Registers the service worker and takes out the rubbish.
 *
 * Both jobs are deferred until after `load`. Registration triggers the
 * precache, which downloads the whole shell — useful, but not at the cost of
 * competing with the first paint on the bad connection this exists to survive.
 * The app must be usable before it starts making itself durable.
 *
 * Renders nothing, and fails silently: an unregistered worker means an app that
 * needs a network, which is worse, but a thrown error here would mean an app
 * that doesn't render at all.
 */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    const start = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Unsupported, blocked by policy, or a private window. The app works,
        // it just needs a network.
      });

      // Enforce the 7-day bound on saved routes once per open, rather than on a
      // timer. The store is tiny and this is the only moment we know the device
      // is actually in use.
      void evictExpired();
    };

    if (document.readyState === "complete") {
      start();
      return;
    }

    window.addEventListener("load", start, { once: true });
    return () => window.removeEventListener("load", start);
  }, []);

  return null;
}
