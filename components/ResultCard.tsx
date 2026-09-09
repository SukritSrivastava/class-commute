"use client";

import type { Journey, JourneyLeg } from "@/lib/journeys";
import type { Pace } from "@/lib/pace";
import { formatMinutes, formatTime12h, splitTime12h } from "@/lib/format";
import { cn } from "@/lib/cn";
import DepartureCountdown from "@/components/DepartureCountdown";

interface ResultCardProps {
  journey: Journey;
  variant: "best" | "alt";
  /** Only today's journeys count down; tomorrow's are not imminent. */
  countdown?: boolean;
}

/**
 * Under this, the buffer stops being comfortable and starts being a reason to
 * walk faster. Ten minutes is roughly the walk from a Mumbai platform to a
 * classroom, so below it you have no slack at all.
 */
const TIGHT_BUFFER_MINUTES = 10;

/**
 * FAST and SLOW, from `lib/pace.ts`. Rendered only when the rule is confident —
 * an unlabelled train is not a slow train, and a wrong FAST badge sends someone
 * sprinting for a service that saves them nothing.
 */
function PaceBadge({ pace }: { pace: Pace }) {
  return (
    <span
      className={cn(
        "type-numeric rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest",
        pace === "fast" ? "bg-cyan text-on-accent" : "bg-night-3 text-ink-muted"
      )}
    >
      {pace}
    </span>
  );
}

/**
 * A time set large, with its meridiem small beside it.
 *
 * `role` is carried in text rather than in the arrow between the two times,
 * because that arrow is decoration and is hidden from assistive tech. Without
 * this, the card's most important line reached a screen reader as "10:35 PM
 * 11:36 PM" — two times, in an order the listener has to guess at, on the one
 * element the whole app exists to deliver.
 */
function HeroTime({ hhmm, role }: { hhmm: string; role: "Departs" | "Arrives" }) {
  const { time, period } = splitTime12h(hhmm);
  return (
    <span className="whitespace-nowrap">
      <span className="sr-only">{role} </span>
      {time}
      <span className="ml-1 align-baseline text-[0.4em] tracking-normal text-ink-dim">
        {period}
      </span>
    </span>
  );
}

function LegRow({ leg }: { leg: JourneyLeg }) {
  return (
    <div className="flex items-baseline gap-2.5 text-sm">
      <span className="type-numeric shrink-0 text-ink">
        {formatTime12h(leg.departure)}
      </span>
      <span className="truncate text-ink-muted">
        {leg.fromName} <span aria-hidden>→</span>
        <span className="sr-only">to</span> {leg.toName}
      </span>
      <span className="ml-auto flex shrink-0 items-baseline gap-2">
        {leg.pace && <PaceBadge pace={leg.pace} />}
        <span className="type-numeric text-xs text-ink-dim">{leg.trainNumber}</span>
      </span>
    </div>
  );
}

export default function ResultCard({
  journey,
  variant,
  countdown = false,
}: ResultCardProps) {
  const isBest = variant === "best";
  const isInterchange = journey.kind === "interchange";
  const tight = journey.bufferRemainingMinutes < TIGHT_BUFFER_MINUTES;

  return (
    <article
      className={cn(
        "rounded-2xl border",
        // The best pick gets the gold treatment. Everything else is quieter —
        // smaller type, no gradient, a flatter surface — because restraint on
        // the alternatives is what makes the best pick read as best.
        isBest
          ? "border-gold/30 bg-night-2 p-4 shadow-lg shadow-night"
          : "border-hairline bg-night-2/60 p-3.5"
      )}
    >
      {/* Only rendered when it has something in it. On an alternative the pace
          badge has moved down beside the duration, so a plain direct backup no
          longer opens with a row containing nothing — which is a card's worth
          of height saved across three of them, and quieter besides. */}
      {(isBest || isInterchange) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {isBest && (
            <span className="type-numeric rounded-full bg-gold px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-on-accent">
              Best pick
            </span>
          )}
          {isInterchange && journey.change && (
            <span className="type-numeric rounded-full bg-orange/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-orange">
              1 change
            </span>
          )}
          {isBest && !isInterchange && journey.pace && (
            <PaceBadge pace={journey.pace} />
          )}
        </div>
      )}

      {/* The times are the hero: display weight, deliberately larger than
          anything else on the page, readable at arm's length on a bright
          platform. This one decision carries more of the aesthetic than any
          animation does.

          They get a row to themselves. Sharing one with the buffer badge is
          what wrapped them onto three lines on a 375px phone, and a broken
          hero is worse than a slightly taller card. The meridiem is set small
          beside each time for the same reason — the hour is the information,
          "PM" is a qualifier. */}
      <div
        className={cn(
          // `flex-wrap` costs nothing at normal sizes — the row fits on one
          // line at 320px and always has. It matters at 200% text zoom, where
          // each `HeroTime` is `whitespace-nowrap` (so "10:35 PM" cannot break
          // mid-time) and the pair together ran 233px past the viewport,
          // leaving a low-vision reader scrolling sideways to find out when
          // the train arrives. Wrapping to a second line is the right answer
          // there; overflowing never was.
          "type-time flex flex-wrap items-baseline gap-2",
          isBest ? "text-4xl text-ink sm:text-5xl" : "text-2xl text-ink-muted"
        )}
      >
        <HeroTime hhmm={journey.departure} role="Departs" />
        <span aria-hidden className="text-ink-dim">
          →
        </span>
        <HeroTime hhmm={journey.arrival} role="Arrives" />
      </div>

      {/* One row, two figures, and a left-hand slot that is never empty.

          The spare time on the right is the card's verdict, and it only reads
          as a verdict when something is anchoring the other end of the rule.
          On the best pick that is the countdown, which is the most urgent thing
          on the screen. An alternative has no countdown — it is a backup, not
          something you are about to run for — so it gets the honest, quieter
          fact instead: how long the journey takes. Read next to the pace badge
          that sits beside it, "47 min · SLOW" is the answer to the question an
          earlier train raises, which is why it arrives later than the one
          below it.

          The slot is a real element even while the countdown has nothing to
          say yet — it reads the clock in an effect, so its first frame is
          empty — because otherwise `justify-between` would park the spare-time
          figure on the left for that frame and then throw it across the card. */}
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          {countdown ? (
            <DepartureCountdown departure={journey.departure} active />
          ) : (
            <span className="type-numeric text-sm text-ink-dim tabular-nums">
              {formatMinutes(journey.totalMinutes)}
            </span>
          )}
          {!isBest && journey.pace && <PaceBadge pace={journey.pace} />}
        </div>

        <div className="flex shrink-0 items-baseline gap-1.5">
          <span
            className={cn(
              "type-numeric font-semibold tabular-nums",
              isBest ? "text-base" : "text-sm",
              // Colour distinguishes at a glance; the word beside it carries
              // the same meaning for anyone the colour doesn't reach.
              tight ? "text-orange" : "text-gold"
            )}
          >
            +{formatMinutes(journey.bufferRemainingMinutes)}
          </span>
          <span className="text-[11px] text-ink-dim">
            {tight ? "tight" : "to spare"}
          </span>
        </div>
      </div>

      {isInterchange && journey.change ? (
        <div className="mt-3.5 space-y-2 border-t border-hairline pt-3.5">
          <LegRow leg={journey.legs[0]} />

          {/* The wait is what decides whether the change is comfortable or a
              sprint, so it gets its own line rather than being left for the
              reader to subtract. */}
          <div className="flex items-center gap-2 text-xs text-orange">
            <span aria-hidden>↳</span>
            <span>
              Change at {journey.change.name} ·{" "}
              <span className="type-numeric">{journey.change.waitMinutes} min</span>{" "}
              on the platform
            </span>
          </div>

          <LegRow leg={journey.legs[1]} />
        </div>
      ) : (
        <p className="mt-3 truncate text-sm text-ink-muted">
          {journey.legs[0].trainName}
          <span className="text-ink-dim"> · </span>
          <span className="type-numeric">{journey.legs[0].trainNumber}</span>
        </p>
      )}
    </article>
  );
}
