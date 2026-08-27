"use client";

import { useId } from "react";

interface BufferStepperProps {
  value: number;
  onChange: (value: number) => void;
}

const MIN = 0;
const MAX = 120;
const STEP = 5;

export default function BufferStepper({ value, onChange }: BufferStepperProps) {
  const inputId = useId();

  function clamp(n: number) {
    return Math.min(MAX, Math.max(MIN, n));
  }

  return (
    <div>
      <label
        htmlFor={inputId}
        className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
      >
        Buffer before class
      </label>
      <div className="flex h-12 items-stretch overflow-hidden rounded-xl border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900">
        <button
          type="button"
          aria-label="Decrease buffer by 5 minutes"
          onClick={() => onChange(clamp(value - STEP))}
          className="flex w-12 shrink-0 items-center justify-center text-xl text-neutral-500 transition-colors hover:bg-neutral-100 active:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:active:bg-neutral-700"
        >
          −
        </button>
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={MIN}
          max={MAX}
          step={STEP}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(clamp(n));
          }}
          className="w-full min-w-0 flex-1 border-x border-neutral-200 bg-transparent text-center text-base tabular-nums text-neutral-900 outline-none focus:ring-2 focus:ring-inset focus:ring-teal-600/30 dark:border-neutral-800 dark:text-neutral-100"
        />
        <button
          type="button"
          aria-label="Increase buffer by 5 minutes"
          onClick={() => onChange(clamp(value + STEP))}
          className="flex w-12 shrink-0 items-center justify-center text-xl text-neutral-500 transition-colors hover:bg-neutral-100 active:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:active:bg-neutral-700"
        >
          +
        </button>
      </div>
      <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
        Minutes you want free before class starts
      </p>
    </div>
  );
}
