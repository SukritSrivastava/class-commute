"use client";

import { useId } from "react";
import { Press } from "@/components/motion";

interface BufferStepperProps {
  value: number;
  onChange: (value: number) => void;
}

const MIN = 0;
const MAX = 120;
const STEP = 5;

/**
 * How long you want free before class, in minutes.
 *
 * The unit is set inside the field rather than under it. "BUFFER" over a bare
 * "20" is a number with no dimension — the aria-labels on the two steppers say
 * minutes, so a screen reader is fine, but a sighted user is left to guess.
 * A suffix inside the field costs no vertical space in a row that is already
 * sharing a line with the time input, and it stays attached to the number when
 * the number changes. The old helper sentence ("Minutes you want free before
 * class") is more words than this row can carry now, and said less.
 */
export default function BufferStepper({ value, onChange }: BufferStepperProps) {
  const inputId = useId();

  function clamp(n: number) {
    return Math.min(MAX, Math.max(MIN, n));
  }

  return (
    <div>
      <label
        htmlFor={inputId}
        className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-dim"
      >
        Buffer
      </label>
      <div className="flex h-12 items-stretch overflow-hidden rounded-xl border border-hairline bg-night-2">
        <Press
          type="button"
          aria-label="Decrease buffer by 5 minutes"
          onClick={() => onChange(clamp(value - STEP))}
          className="flex w-11 shrink-0 items-center justify-center text-xl text-ink-muted hover:bg-night-3 hover:text-ink"
        >
          −
        </Press>
        <div className="flex min-w-0 flex-1 items-center justify-center border-x border-hairline">
          {/* Baseline-aligned rather than centred: "min" is a unit sitting on
              the same line as the figure, not a second, smaller number. The
              gap is 8px because the focus ring is 2px drawn 2px outside the
              input — at 4px the ring lands right up against the "min". */}
          <span className="flex items-baseline gap-2">
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
              className="type-numeric no-spinner w-9 min-w-0 bg-transparent text-right text-base text-ink outline-none"
            />
            <span aria-hidden className="text-xs text-ink-dim">
              min
            </span>
          </span>
        </div>
        <Press
          type="button"
          aria-label="Increase buffer by 5 minutes"
          onClick={() => onChange(clamp(value + STEP))}
          className="flex w-11 shrink-0 items-center justify-center text-xl text-ink-muted hover:bg-night-3 hover:text-ink"
        >
          +
        </Press>
      </div>
    </div>
  );
}
