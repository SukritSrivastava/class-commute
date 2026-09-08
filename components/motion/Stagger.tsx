"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  type CSSProperties,
  type ElementType,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

interface StaggerProps {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  /** Milliseconds between each child. Defaults to the `--stagger-step` token. */
  stepMs?: number;
  /**
   * How many steps the ramp climbs before it flattens. Past this, every child
   * shares the last delay.
   */
  maxSteps?: number;
}

/** Matches `--stagger-step` in globals.css. */
const DEFAULT_STEP_MS = 60;

/**
 * The ramp stops climbing after this many children. A ten-item list on a 60ms
 * step would take 540ms to finish arriving *before* its own 600ms transition —
 * long enough that the last row feels broken rather than choreographed. Six
 * steps is 360ms, which still reads as a cascade and never as a wait.
 */
const DEFAULT_MAX_STEPS = 6;

/**
 * Ramps the reveal of its direct children, 60ms apart.
 *
 * Works by setting `--reveal-delay` on each child, which `Reveal` consumes as a
 * `transition-delay`. Children are cloned rather than wrapped, so this adds no
 * DOM and cannot disturb a grid or flex layout — the only requirement is that
 * each direct child accepts a `style` prop, which every DOM element and every
 * primitive in this folder does.
 *
 * Delay is presentation, never sequencing: each child is already in the DOM and
 * already readable. A stagger changes when a fade finishes, not when content
 * exists.
 */
export default function Stagger({
  children,
  as: Tag = "div",
  className,
  stepMs = DEFAULT_STEP_MS,
  maxSteps = DEFAULT_MAX_STEPS,
}: StaggerProps) {
  let index = 0;

  const ramped = Children.map(children, (child) => {
    // Skip strings, numbers, null and fragments — nothing to attach a delay to,
    // and they must not consume a step or the ramp develops gaps.
    if (!isValidElement(child)) return child;

    const step = Math.min(index++, maxSteps);
    const element = child as ReactElement<{ style?: CSSProperties }>;

    return cloneElement(element, {
      style: {
        ...element.props.style,
        "--reveal-delay": `${step * stepMs}ms`,
      } as CSSProperties,
    });
  });

  return <Tag className={cn(className)}>{ramped}</Tag>;
}
