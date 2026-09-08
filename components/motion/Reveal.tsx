"use client";

import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { prefersReducedMotion } from "./reducedMotion";

interface RevealProps {
  children: ReactNode;
  /** Element to render. Defaults to a plain `div`. */
  as?: ElementType;
  className?: string;
  /**
   * Extra delay before this element reveals. Usually left alone — `Stagger`
   * sets it per child through a CSS variable.
   */
  delayMs?: number;
  /** Fraction of the element that must be visible before it reveals. */
  threshold?: number;
}

/**
 * Fades content in with a 12px rise as it enters the viewport.
 *
 * ## Motion never gates information
 *
 * This is the rule the whole primitive is built around, because the app is
 * opened by someone who is late:
 *
 *   - The children are rendered **immediately and unconditionally**. They are in
 *     the DOM, findable, selectable and readable by assistive tech from the
 *     first paint, whatever the animation is doing.
 *   - The server renders the *final* state. If JavaScript never arrives, or
 *     throws, or the observer never fires, the content is simply visible. The
 *     hidden state is only ever applied by JS that has already proven it can
 *     also remove it.
 *   - Under `prefers-reduced-motion` the hidden state is never applied at all,
 *     and the stylesheet pins it off as a second line of defence.
 *   - A 1.2s failsafe reveals anything still hidden. An element that scrolls
 *     out of a detached container, or a browser that quietly drops the
 *     observer, can cost a fade — it can never cost the answer.
 */
export default function Reveal({
  children,
  as: Tag = "div",
  className,
  delayMs,
  threshold = 0.15,
}: RevealProps) {
  const ref = useRef<HTMLElement>(null);

  // Starts "shown" so server output and the no-JS case are both correct.
  const [state, setState] = useState<"hidden" | "shown">("shown");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) return;
    if (typeof IntersectionObserver === "undefined") return;

    // Already on screen at mount — the common case for a one-screen utility.
    // Revealing it would mean hiding it first, which is a flicker for no gain.
    const box = el.getBoundingClientRect();
    if (box.top < window.innerHeight && box.bottom > 0) return;

    setState("hidden");

    // Armed before the observer exists, so there is no window in which content
    // is hidden with nothing scheduled to bring it back.
    const failsafe = setTimeout(() => setState("shown"), 1200);

    const show = () => {
      clearTimeout(failsafe);
      setState("shown");
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            show();
            observer.disconnect();
          }
        }
      },
      { threshold }
    );
    observer.observe(el);

    return () => {
      clearTimeout(failsafe);
      observer.disconnect();
    };
  }, [threshold]);

  return (
    <Tag
      ref={ref}
      data-reveal={state}
      className={cn(className)}
      style={delayMs === undefined ? undefined : { "--reveal-delay": `${delayMs}ms` }}
    >
      {children}
    </Tag>
  );
}
