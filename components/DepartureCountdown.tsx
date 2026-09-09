"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { minutesSinceMidnight, toMinutes } from "@/lib/time";

interface DepartureCountdownProps {
  /** "HH:MM" departure, IST wall clock. */
  departure: string;
  /** Only today's journeys count down; tomorrow's are not imminent. */
  active: boolean;
  className?: string;
}

/**
 * "Leaves in 6 min", ticking.
 *
 * At 7:40am this is more useful than "07:46". The question in the reader's head
 * is not what time the train goes, it is whether they have time to finish their
 * tea — and a countdown answers that without any arithmetic.
 *
 * Three things it must get right:
 *
 *   - **It has to stop.** Counting down past zero into "-3 min" is nonsense
 *     dressed as data. Once the train has gone it says so, plainly, and the
 *     rest of the card still stands as a record of what was recommended.
 *   - **It must not lie on a future date.** A journey for tomorrow is not
 *     leaving in fourteen hours in any useful sense, so `active` is false and
 *     nothing is rendered.
 *   - **It must not desynchronise from the page's clock.** Both read
 *     `lib/time.ts`, so both are Mumbai time regardless of where the phone
 *     thinks it is.
 */
export default function DepartureCountdown({
  departure,
  active,
  className,
}: DepartureCountdownProps) {
  // Null until mounted: the server has no business guessing the viewer's clock,
  // and rendering a stale countdown for one frame is worse than rendering none.
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    // No interval for a journey that isn't today. The render guard below is
    // what stops anything being shown, so there is no state to clear here.
    if (!active) return;

    const tick = () => {
      const now = new Date();
      // Seconds-within-the-minute are timezone independent — IST is a whole
      // number of minutes from UTC — so the minute count comes from lib/time
      // and only the seconds come from the local clock.
      const minutes = toMinutes(departure) - minutesSinceMidnight(now);
      setSecondsLeft(minutes * 60 - now.getSeconds());
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [departure, active]);

  if (!active || secondsLeft === null) return null;

  const departed = secondsLeft <= 0;
  const minutes = Math.floor(secondsLeft / 60);

  const label = departed
    ? "This train has gone"
    : secondsLeft < 60
      ? `Leaves in ${secondsLeft}s`
      : `Leaves in ${minutes} min`;

  return (
    <p
      // Polite, not assertive: it changes every minute and must never interrupt
      // someone reading the rest of the card.
      aria-live="polite"
      className={cn(
        "type-numeric text-sm tabular-nums",
        departed
          ? "text-ink-dim"
          : secondsLeft < 5 * 60
            ? "text-orange"
            : "text-cyan",
        className
      )}
    >
      {label}
    </p>
  );
}
