"use client";

import { useEffect, useState } from "react";

/**
 * Says "you're offline" once, quietly, and then gets out of the way.
 *
 * Deliberately not a modal, not a toast that needs dismissing, and not
 * something that pushes the form down the page. Someone on a platform already
 * knows their signal is bad; what they need to know is that the app still
 * works, which is why the copy is about what *does* function rather than what
 * doesn't.
 *
 * Rendered from the layout so it is present on first paint, and returns null
 * while online so it costs nothing in the normal case.
 */
export default function OfflineBanner() {
  // Starts false so server and client agree on the first render. A device that
  // is already offline flips it in the effect below, one frame later.
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();

    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      className="flex items-center justify-center gap-2 border-b border-hairline bg-night-2 px-4 py-2 text-center text-xs text-ink-muted"
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange"
      />
      Offline — showing saved times. Station search still works.
    </div>
  );
}
