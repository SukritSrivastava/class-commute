const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * True when the viewer has asked their OS for less motion.
 *
 * Read at the moment it is needed rather than cached in state: the preference
 * can change mid-session, and every caller here is already inside an effect or
 * an event handler. Safe during SSR, where it answers `false` and the markup it
 * produces is the still, final state anyway.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

/**
 * Calls `onChange` whenever the preference flips. Used by the smooth-scroll
 * provider, which has to tear a running instance down rather than just skip a
 * transition.
 */
export function watchReducedMotion(
  onChange: (reduced: boolean) => void
): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};

  const media = window.matchMedia(QUERY);
  const handler = (event: MediaQueryListEvent) => onChange(event.matches);
  media.addEventListener("change", handler);
  return () => media.removeEventListener("change", handler);
}
