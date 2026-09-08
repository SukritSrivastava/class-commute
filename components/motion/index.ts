/**
 * Motion primitives.
 *
 * Four pieces, and deliberately no fifth. Everything here shares one easing
 * curve (`--ease-signature`) and one of two durations (`--duration-ui` at 200ms
 * for interface feedback, `--duration-content` at 600ms for content arriving),
 * both defined in `app/globals.css`. Nothing invents its own timing.
 *
 * The rule they all obey: motion may accompany information appearing, and may
 * never gate it. Content is in the DOM from the first paint; only opacity and
 * transform ever change; and every primitive degrades to its final, still state
 * with no JavaScript and under `prefers-reduced-motion`.
 */
export { default as Reveal } from "./Reveal";
export { default as Stagger } from "./Stagger";
export { default as Press } from "./Press";
export { default as SmoothScroll } from "./SmoothScroll";
export { prefersReducedMotion, watchReducedMotion } from "./reducedMotion";
