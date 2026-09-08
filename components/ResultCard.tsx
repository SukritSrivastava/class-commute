import type { Journey, JourneyLeg } from "@/lib/journeys";
import { formatBufferMinutes, formatTime12h } from "@/lib/format";
import { cn } from "@/lib/cn";

interface ResultCardProps {
  journey: Journey;
  variant: "best" | "alt";
}

function LegLine({ leg }: { leg: JourneyLeg }) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="tabular-nums text-neutral-900 dark:text-neutral-100">
        {formatTime12h(leg.departure)}
      </span>
      <span className="truncate text-neutral-600 dark:text-neutral-400">
        {leg.fromName} → {leg.toName}
      </span>
      <span className="ml-auto shrink-0 font-mono text-xs text-neutral-500 dark:text-neutral-400">
        {leg.trainNumber}
      </span>
    </div>
  );
}

export default function ResultCard({ journey, variant }: ResultCardProps) {
  const isBest = variant === "best";
  const isInterchange = journey.kind === "interchange";

  return (
    <div
      className={cn(
        "rounded-2xl border p-4 transition-shadow",
        isBest
          ? "border-emerald-600/30 bg-emerald-50 shadow-sm dark:border-emerald-500/30 dark:bg-emerald-950/40"
          : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
      )}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {isBest && (
          <span className="inline-flex items-center rounded-full bg-emerald-700 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white">
            Best pick
          </span>
        )}
        {/* Flagged on the card itself, not buried in the detail: whether a
            journey involves a change is the first thing that decides whether
            someone takes it. */}
        {isInterchange && journey.change && (
          <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Change at {journey.change.name}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2 tabular-nums">
          <span className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
            {formatTime12h(journey.departure)}
          </span>
          <span aria-hidden className="text-neutral-400">
            →
          </span>
          <span className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
            {formatTime12h(journey.arrival)}
          </span>
        </div>

        <div
          className={cn(
            "shrink-0 rounded-lg px-2.5 py-1.5 text-right",
            isBest
              ? "bg-emerald-600/10 dark:bg-emerald-500/15"
              : "bg-neutral-100 dark:bg-neutral-800"
          )}
        >
          <div
            className={cn(
              "text-sm font-semibold tabular-nums",
              isBest
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-neutral-700 dark:text-neutral-300"
            )}
          >
            +{formatBufferMinutes(journey.bufferRemainingMinutes)}
          </div>
          <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
            to spare
          </div>
        </div>
      </div>

      {isInterchange && journey.change ? (
        <div className="mt-3 space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <LegLine leg={journey.legs[0]} />

          {/* The wait is the number that decides whether a connection is
              comfortable or a sprint, so it gets its own line rather than
              being left for the reader to subtract. */}
          <div className="flex items-center gap-2 pl-1 text-xs text-amber-700 dark:text-amber-400">
            <span aria-hidden>↳</span>
            <span>
              Change at {journey.change.name} ·{" "}
              <span className="tabular-nums">
                {journey.change.waitMinutes} min
              </span>{" "}
              on the platform
            </span>
          </div>

          <LegLine leg={journey.legs[1]} />
        </div>
      ) : (
        <p className="mt-2 truncate text-sm text-neutral-600 dark:text-neutral-400">
          {journey.legs[0].trainName}
          <span className="text-neutral-400 dark:text-neutral-600"> · </span>
          <span className="font-mono">{journey.legs[0].trainNumber}</span>
        </p>
      )}
    </div>
  );
}
