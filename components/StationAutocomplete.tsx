"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  DEFAULT_SEARCH_LIMIT,
  searchBundledStations,
  type StationOption,
} from "@/lib/stations";
import { cn } from "@/lib/cn";

interface StationAutocompleteProps {
  label: string;
  placeholder?: string;
  value: StationOption | null;
  onChange: (station: StationOption | null) => void;
  invalid?: boolean;
}

/**
 * Station picker over the bundled Mumbai list.
 *
 * This used to fire a debounced request to `/api/stations/search` — and through
 * it a RailRadar request — on every typing burst, which was the single largest
 * drain on a 1,000-request month. The list is now generated at build time and
 * searched in the browser, so:
 *
 *   - there is no debounce: matches render on the first keystroke;
 *   - there is no minimum query length, for the same reason;
 *   - typing costs nothing, so a user hunting for a station is free.
 *
 * The network fallback below is the only remaining path that can spend quota,
 * and it is deliberately hard to reach: it needs two or more characters, no
 * local match at all, and an explicit tap.
 */

/** Below this, "no match" is much more likely to be a half-typed word. */
const MIN_FALLBACK_LENGTH = 2;

export default function StationAutocomplete({
  label,
  placeholder,
  value,
  onChange,
  invalid,
}: StationAutocompleteProps) {
  /**
   * What the user has typed, or null when the field is simply showing the
   * selected station's name.
   *
   * This is the fix for a real bug: the field used to copy `value.name` into
   * its own state at mount, so swapping the two stations from the parent left
   * both inputs showing their old text. The parent papered over it by forcing a
   * remount with a changing `key`, which threw away focus and scroll position
   * every swap. Deriving the displayed text instead makes the component
   * genuinely controlled, and the `key` hack is gone.
   */
  const [typed, setTyped] = useState<string | null>(null);

  // React's documented pattern for adjusting state when a prop changes: when a
  // new station arrives from outside, stop showing whatever was typed.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    if (value) setTyped(null);
  }

  const query = typed ?? value?.name ?? "";

  const [options, setOptions] = useState<StationOption[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Fallback state. Untouched during normal use.
  const [fallbackLoading, setFallbackLoading] = useState(false);
  const [fallbackTried, setFallbackTried] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const inputId = useId();
  const listboxId = useId();
  const statusId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function handleInputChange(text: string) {
    setTyped(text);
    setActiveIndex(-1);
    setErrorMessage(null);
    setFallbackTried(false);
    if (value) onChange(null);

    // Synchronous, local, instant. No request, no debounce, no spinner.
    setOptions(searchBundledStations(text, DEFAULT_SEARCH_LIMIT));
    setOpen(text.trim().length > 0);
  }

  /**
   * Reopens the list when someone comes back to a field they have already
   * filled. It used to check `options.length`, which is empty after a
   * selection — so refocusing a filled field did nothing at all, and the only
   * way to change your mind was to delete the text.
   */
  function handleFocus() {
    if (fallbackTried || errorMessage) return;
    const matches = searchBundledStations(query, DEFAULT_SEARCH_LIMIT);
    setOptions(matches);
    setOpen(matches.length > 0);
  }

  /**
   * Asks the server — and so RailRadar — about a station the bundle has never
   * heard of. This is the one action in the typing flow that costs quota, so it
   * is behind an explicit tap rather than firing on its own.
   */
  async function searchUpstream() {
    const trimmed = query.trim();
    if (trimmed.length < MIN_FALLBACK_LENGTH || fallbackLoading) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setFallbackLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/stations/search?q=${encodeURIComponent(trimmed)}`,
        { signal: controller.signal }
      );
      const data = await res.json();

      if (res.status === 429 || data.kind === "RATE_LIMIT") {
        setErrorMessage("Too many searches. Wait a minute and try again.");
      } else if (!res.ok) {
        setErrorMessage("Couldn't load stations. Try again.");
      } else {
        const found: StationOption[] = (data.stations ?? []).map(
          (s: { code: string; name: string }) => ({ code: s.code, name: s.name })
        );
        setOptions(found);
        if (found.length === 0) setErrorMessage("No station by that name.");
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setErrorMessage("Couldn't load stations. Try again.");
      }
    } finally {
      setFallbackLoading(false);
      setFallbackTried(true);
      setOpen(true);
    }
  }

  function selectStation(station: StationOption) {
    onChange(station);
    setTyped(null);
    setOptions([]);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown" && !open) {
      e.preventDefault();
      handleFocus();
      return;
    }
    if (!open || options.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === "Enter") {
      if (activeIndex >= 0) {
        e.preventDefault();
        selectStation(options[activeIndex]);
      }
    }
  }

  const trimmed = query.trim();
  const showFallbackPrompt =
    options.length === 0 &&
    !fallbackLoading &&
    !fallbackTried &&
    !errorMessage &&
    trimmed.length >= MIN_FALLBACK_LENGTH;

  // Anything that is not a station goes here rather than into the listbox. As
  // bare <li> children of role="listbox" a screen reader announced "Searching…"
  // and "No matching stations." as selectable options, which is a lie about
  // what pressing Enter would do.
  const statusMessage = fallbackLoading
    ? "Searching all stations…"
    : errorMessage
      ? errorMessage
      : open && options.length === 0 && !showFallbackPrompt
        ? "No matching stations."
        : null;

  return (
    <div ref={containerRef} className="relative">
      <label
        htmlFor={inputId}
        className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-dim"
      >
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-describedby={statusMessage ? statusId : undefined}
        aria-activedescendant={
          activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
        }
        aria-invalid={invalid || undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        className={cn(
          // `transition-[border-color]`, not `transition-colors`: the latter
          // covers `outline-color` in Tailwind v4, which put the shared cyan
          // focus ring on a 150ms fade up from the text colour. A focus
          // indicator that arrives late is not the one focus treatment the
          // palette promises — only the hover border should move.
          "h-12 w-full rounded-xl border bg-night-2 px-4 text-base text-ink outline-none transition-[border-color] placeholder:text-ink-dim",
          invalid
            ? "border-magenta"
            : "border-hairline hover:border-hairline-strong"
        )}
      />

      {/* Out of the listbox, announced as status rather than as an option. */}
      {statusMessage && (
        <p
          id={statusId}
          role="status"
          className={cn(
            "mt-1.5 text-xs",
            errorMessage ? "text-magenta" : "text-ink-dim"
          )}
        >
          {statusMessage}
        </p>
      )}

      {open && (options.length > 0 || showFallbackPrompt) && (
        <div className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-xl border border-hairline-strong bg-night-2 shadow-2xl shadow-night">
          <ul id={listboxId} role="listbox" className="max-h-64 overflow-auto py-1">
            {options.map((station, i) => (
              <li
                key={station.code}
                id={`${listboxId}-option-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectStation(station);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                /**
                 * The active option carries the app's ordinary focus ring, not
                 * just a tint.
                 *
                 * This list is driven by `aria-activedescendant`, so DOM focus
                 * never leaves the input and the browser draws no ring on the
                 * option at all. The tint was doing the whole job on its own,
                 * and on this palette `night-3` on `night-2` measures 1.07:1 —
                 * against the 3:1 that WCAG asks of a state indicator. Arrowing
                 * down the list moved a highlight nobody could see, on the one
                 * control every journey has to go through twice.
                 *
                 * Drawn inset so the panel's rounded clip can't shave it, and in
                 * the same cyan at the same 2px as every other focused thing —
                 * this *is* focus, as far as the person typing is concerned.
                 */
                className={cn(
                  "flex min-h-11 cursor-pointer items-center justify-between gap-2 px-4 py-2.5 text-sm text-ink",
                  i === activeIndex &&
                    "bg-night-3 outline-2 -outline-offset-2 outline-cyan"
                )}
              >
                <span>{station.name}</span>
                <span className="type-numeric shrink-0 rounded bg-night-3 px-1.5 py-0.5 text-xs text-ink-dim">
                  {station.code}
                </span>
              </li>
            ))}
          </ul>

          {showFallbackPrompt && (
            <div className="border-t border-hairline px-4 py-3 text-xs text-ink-dim">
              Not a Mumbai suburban station.{" "}
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  void searchUpstream();
                }}
                className="min-h-11 font-medium text-cyan underline underline-offset-2"
              >
                Search all stations
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
