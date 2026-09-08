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
 * local match at all, and an explicit click.
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
  const [query, setQuery] = useState(value?.name ?? "");
  const [options, setOptions] = useState<StationOption[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Fallback state. Untouched during normal use.
  const [fallbackLoading, setFallbackLoading] = useState(false);
  const [fallbackTried, setFallbackTried] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const inputId = useId();
  const listboxId = useId();
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
    setQuery(text);
    setActiveIndex(-1);
    setErrorMessage(null);
    setFallbackTried(false);
    if (value) onChange(null);

    // Synchronous, local, instant. No request, no debounce, no spinner.
    const matches = searchBundledStations(text, DEFAULT_SEARCH_LIMIT);
    setOptions(matches);
    setOpen(text.trim().length > 0);
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
        setErrorMessage("Please wait a moment and try again.");
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
    setQuery(station.name);
    setOptions([]);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
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

  return (
    <div ref={containerRef} className="relative">
      <label
        htmlFor={inputId}
        className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
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
        aria-activedescendant={
          activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
        }
        aria-invalid={invalid || undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={() => options.length > 0 && setOpen(true)}
        onKeyDown={handleKeyDown}
        className={cn(
          "h-12 w-full rounded-xl border bg-white px-4 text-base text-neutral-900 outline-none transition-colors placeholder:text-neutral-500 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/30 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500",
          invalid ? "border-red-500" : "border-neutral-300 dark:border-neutral-700"
        )}
      />

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-10 mt-1.5 max-h-64 w-full overflow-auto rounded-xl border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          {fallbackLoading && (
            <li className="px-4 py-3 text-sm text-neutral-500">Searching…</li>
          )}

          {!fallbackLoading && errorMessage && (
            <li className="px-4 py-3 text-sm text-red-600" role="alert">
              {errorMessage}
            </li>
          )}

          {!fallbackLoading &&
            options.map((station, i) => (
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
                className={cn(
                  "flex min-h-11 cursor-pointer items-center justify-between gap-2 px-4 py-2.5 text-sm",
                  i === activeIndex && "bg-teal-50 dark:bg-teal-900/30"
                )}
              >
                <span className="text-neutral-900 dark:text-neutral-100">
                  {station.name}
                </span>
                <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                  {station.code}
                </span>
              </li>
            ))}

          {showFallbackPrompt && (
            <li className="px-4 py-3 text-sm text-neutral-500">
              No matching Mumbai station.{" "}
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  void searchUpstream();
                }}
                className="font-medium text-teal-700 underline dark:text-teal-400"
              >
                Search all stations
              </button>
            </li>
          )}

          {!fallbackLoading &&
            !errorMessage &&
            options.length === 0 &&
            !showFallbackPrompt && (
              <li className="px-4 py-3 text-sm text-neutral-500">
                No matching stations.
              </li>
            )}
        </ul>
      )}
    </div>
  );
}
