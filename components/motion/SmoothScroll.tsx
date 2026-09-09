"use client";

import { useEffect } from "react";
// Type only — the implementation is imported dynamically below, so nothing
// from `lenis` reaches the first-load bundle.
import type Lenis from "lenis";
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
    let loading = false;
    let disposed = false;

    const start = async () => {
      if (lenis || loading || disposed || prefersReducedMotion()) return;
      loading = true;

      // 18KB of JavaScript that renders no markup and changes only how a
      // scroll interpolates, fetched here rather than in the first load —
      // after paint, on a page that usually fits in one screen. Someone who
      // has asked for reduced motion never downloads it at all, because the
      // guard above returns before this line.
      const { default: Lenis } = await import("lenis");

      loading = false;
      // The chunk took a network round trip to arrive. The effect may have been
      // torn down in that time, or the preference may have flipped — either way
      // there is nothing left to start, and constructing one now would leak a
      // rAF loop nothing can cancel.
      if (disposed || lenis || prefersReducedMotion()) return;

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

    void start();

    // The preference can change while the page is open — a system-wide toggle,
    // or a battery saver flipping it. Honour it immediately in both directions.
    const unwatch = watchReducedMotion((reduced) => {
      if (reduced) stop();
      else void start();
    });

    return () => {
      disposed = true;
      unwatch();
      stop();
    };
  }, []);

  return null;
}
