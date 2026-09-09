"use client";

import { useEffect, useState } from "react";
import { nowInMumbai } from "@/lib/time";

/**
 * The current time in Mumbai, ticking.
 *
 * Functional, not decorative. Every answer on this screen is relative to *now* —
 * "the latest train that still works" is only meaningful against a clock, and a
 * cached answer from twenty minutes ago looks identical to a live one unless
 * there is a moving second hand somewhere on the page to argue otherwise. It is
 * the cheapest possible signal that the app is awake.
 *
 * Renders nothing on the server: the time it would print is the build time or
 * the request time, neither of which is the viewer's, and a wrong clock is worse
 * than a clock that appears a frame late.
 */
export default function MumbaiClock() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setTime(nowInMumbai().hhmm);
    tick();

    // Aligned to the next minute boundary rather than every second: the display
    // has minute resolution, so a per-second interval would be 59 wakeups an
    // hour spent re-rendering the same string on a phone with a low battery.
    let interval: ReturnType<typeof setInterval>;
    const toNextMinute = (60 - new Date().getSeconds()) * 1000;
    const timeout = setTimeout(() => {
      tick();
      interval = setInterval(tick, 60_000);
    }, toNextMinute);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []);

  return (
    <span
      className="type-numeric text-xs tracking-wider text-ink-dim tabular-nums"
      // The whole point is that it changes; announcing every tick would be
      // relentless for a screen reader user.
      aria-hidden={time === null ? undefined : true}
    >
      {time ?? " "} IST
    </span>
  );
}
