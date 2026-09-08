"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import { prefersReducedMotion, watchReducedMotion } from "./reducedMotion";

/**
 * Momentum scrolling, on the shared easing curve.
 *
 * ## Off means off
 *
 * Under `prefers-reduced-motion` Lenis is not started, and if the preference is
 * turned on mid-session a running instance is **destroyed** — not slowed, not
 * shortened. Lenis works by cancelling the browser's own scrolling and
 * re-driving it from a rAF loop, so a "fast" version of it is still an
 * interception: it still overrides scroll chaining, still fights a screen
 * reader's caret, still makes a trackpad feel wrong to someone who asked for
 * none of it. The only correct reduced-motion behaviour is native scrolling.
 *
 * ## Why this is safe on a utility page
 *
 * Lenis only changes *how* a scroll interpolates. It never defers rendering,
 * never holds content back, and is mounted below the content in the tree, so a
 * failure to load it leaves an ordinary scrolling page. On a page that fits in
 * one screen it does nothing at all, which is the intended state most mornings.
 *
 * Renders nothing.
 */
export default function SmoothScroll() {
  useEffect(() => {
    let lenis: Lenis | null = null;
    let frame = 0;

    const start = () => {
      if (lenis || prefersReducedMotion()) return;

      lenis = new Lenis({
        // Matches --ease-signature. Lenis takes the curve as a function rather
        // than a CSS string, so this is the same deceleration expressed the
        // only way it can be here.
        easing: (t: number) => 1 - Math.pow(1 - t, 3),
        duration: 1.1,
        // Touch devices already have momentum scrolling in hardware, and it is
        // better than ours. Intercepting it makes a phone feel worse.
        syncTouch: false,
      });

      const raf = (time: number) => {
        lenis?.raf(time);
        frame = requestAnimationFrame(raf);
      };
      frame = requestAnimationFrame(raf);
    };

    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      lenis?.destroy();
      lenis = null;
    };

    start();

    // The preference can change while the page is open — a system-wide toggle,
    // or a battery saver flipping it. Honour it immediately in both directions.
    const unwatch = watchReducedMotion((reduced) => (reduced ? stop() : start()));

    return () => {
      unwatch();
      stop();
    };
  }, []);

  return null;
}
