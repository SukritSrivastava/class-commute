"use client";

import {
  cloneElement,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

interface PressAsChildProps {
  /** Apply the press behaviour to the single child element instead of a button. */
  asChild: true;
  children: ReactNode;
  className?: string;
}

type PressButtonProps = { asChild?: false } & ButtonHTMLAttributes<HTMLButtonElement>;

type PressProps = PressAsChildProps | PressButtonProps;

/**
 * Tactile feedback on press: a small scale-down and a brightness lift, 200ms on
 * the shared curve.
 *
 * ## Why there is no JavaScript in here
 *
 * The behaviour is entirely `[data-press]` in globals.css, driven by `:active`.
 * That means it works before hydration, costs nothing at runtime, respects
 * `prefers-reduced-motion` through the same stylesheet rule as everything else,
 * and cannot desynchronise from a pointer that left the element. A JS
 * implementation of this would be more code doing a worse job — which is the
 * whole argument of this design: the restraint is what makes it land.
 *
 * The brightness lift matters more than the scale on this palette. A dark
 * surface that only shrinks reads as unresponsive on a phone in daylight.
 *
 * Use `asChild` to press an element you are already rendering:
 *   <Press asChild><a href="...">Go</a></Press>
 */
export default function Press(props: PressProps) {
  if (props.asChild) {
    const { children, className } = props;

    if (!isValidElement(children)) {
      throw new Error("<Press asChild> expects a single React element child.");
    }

    const child = children as ReactElement<{ className?: string }>;
    return cloneElement(child, {
      "data-press": "",
      className: cn(child.props.className, className),
    } as Partial<typeof child.props>);
  }

  const { className, children, ...rest } = props;
  return (
    <button {...rest} data-press="" className={cn(className)}>
      {children}
    </button>
  );
}
