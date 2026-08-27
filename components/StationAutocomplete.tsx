"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Station } from "@/lib/railradar";

interface StationAutocompleteProps {
  label: string;
  placeholder?: string;
  value: Station | null;
  onChange: (station: Station | null) => void;
  invalid?: boolean;
}

const DEBOUNCE_MS = 250;

export default function StationAutocomplete({
  label,
  placeholder,
  value,
  onChange,
  invalid,
}: StationAutocompleteProps) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [options, setOptions] = useState<Station[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputId = useId();
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Keep the visible text in sync if the parent resets the selection externally.
  useEffect(() => {
    setQuery(value?.name ?? "");
  }, [value]);

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
    if (value) onChange(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = text.trim();
    if (trimmed.length < 2) {
      setOptions([]);
      setOpen(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrored(false);
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(
          `/api/stations/search?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal }
        );
        const data = await res.json();
        if (!res.ok) {
          setErrored(true);
          setOptions([]);
        } else {
          setOptions(data.stations ?? []);
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setErrored(true);
          setOptions([]);
        }
      } finally {
        setLoading(false);
        setOpen(true);
      }
    }, DEBOUNCE_MS);
  }

  function selectStation(station: Station) {
    onChange(station);
    setQuery(station.name);
    setOptions([]);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
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
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

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
        className={`h-12 w-full rounded-xl border bg-white px-4 text-base text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/30 dark:bg-neutral-900 dark:text-neutral-100 ${
          invalid
            ? "border-red-500"
            : "border-neutral-300 dark:border-neutral-700"
        }`}
      />

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-10 mt-1.5 max-h-64 w-full overflow-auto rounded-xl border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          {loading && (
            <li className="px-4 py-3 text-sm text-neutral-500">Searching…</li>
          )}
          {!loading && errored && (
            <li className="px-4 py-3 text-sm text-red-600">
              Couldn&apos;t load stations. Try again.
            </li>
          )}
          {!loading && !errored && options.length === 0 && (
            <li className="px-4 py-3 text-sm text-neutral-500">
              No matching stations.
            </li>
          )}
          {!loading &&
            !errored &&
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
                className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 px-4 py-2.5 text-sm ${
                  i === activeIndex
                    ? "bg-teal-50 dark:bg-teal-900/30"
                    : ""
                }`}
              >
                <span className="text-neutral-900 dark:text-neutral-100">
                  {station.name}
                </span>
                <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                  {station.code}
                </span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
