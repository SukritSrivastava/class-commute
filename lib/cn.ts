import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Joins class names and resolves Tailwind conflicts, last one winning.
 *
 * `clsx` handles the conditionals; `twMerge` handles the part template literals
 * get wrong — `cn("px-4", isWide && "px-8")` yields `px-8`, where a plain string
 * would emit both and leave the winner to source order in the stylesheet.
 *
 * Use it anywhere a class list is conditional. Static class strings don't need
 * it and shouldn't pay for it.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
