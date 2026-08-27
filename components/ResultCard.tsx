import type { TrainResult } from "@/lib/bestTrain";
import { formatBufferMinutes, formatTime12h } from "@/lib/format";

interface ResultCardProps {
  train: TrainResult;
  variant: "best" | "alt";
}

export default function ResultCard({ train, variant }: ResultCardProps) {
  const isBest = variant === "best";

  return (
    <div
      className={`rounded-2xl border p-4 transition-shadow ${
        isBest
          ? "border-emerald-600/30 bg-emerald-50 shadow-sm dark:border-emerald-500/30 dark:bg-emerald-950/40"
          : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
      }`}
    >
      {isBest && (
        <span className="mb-2 inline-flex items-center rounded-full bg-emerald-700 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white">
          Best pick
        </span>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2 tabular-nums">
          <span className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
            {formatTime12h(train.departure)}
          </span>
          <span aria-hidden className="text-neutral-400">
            →
          </span>
          <span className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
            {formatTime12h(train.arrival)}
          </span>
        </div>

        <div
          className={`shrink-0 rounded-lg px-2.5 py-1.5 text-right ${
            isBest
              ? "bg-emerald-600/10 dark:bg-emerald-500/15"
              : "bg-neutral-100 dark:bg-neutral-800"
          }`}
        >
          <div
            className={`text-sm font-semibold tabular-nums ${
              isBest
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-neutral-700 dark:text-neutral-300"
            }`}
          >
            +{formatBufferMinutes(train.bufferRemainingMinutes)}
          </div>
          <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
            to spare
          </div>
        </div>
      </div>

      <p className="mt-2 truncate text-sm text-neutral-600 dark:text-neutral-400">
        {train.trainName}
        <span className="text-neutral-400 dark:text-neutral-600"> · </span>
        <span className="font-mono">{train.trainNumber}</span>
      </p>
    </div>
  );
}
