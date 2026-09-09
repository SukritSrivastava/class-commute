export function formatTime12h(hhmm: string): string {
  const { time, period } = splitTime12h(hhmm);
  return `${time} ${period}`;
}

/**
 * The same conversion, split so a caller can set the two parts at different
 * sizes.
 *
 * This exists for the result card's hero times. "10:35 PM" at display weight
 * and 48px is wide enough that two of them plus an arrow wrapped onto three
 * lines on a 375px phone — the biggest element on the page, broken. Setting the
 * meridiem small next to a large time keeps it on one line and reads better
 * anyway: the hour is the information, "PM" is a qualifier.
 */
export function splitTime12h(hhmm: string): { time: string; period: string } {
  const [h, m] = hhmm.split(":").map(Number);
  return {
    time: `${h % 12 === 0 ? 12 : h % 12}:${m.toString().padStart(2, "0")}`,
    period: h >= 12 ? "PM" : "AM",
  };
}

/**
 * A count of minutes, in words a person on a platform reads at a glance.
 *
 * Used for both of the figures a result card carries — the spare time before
 * class and the door-to-door length of the journey. They are the same quantity
 * measured from different ends, so they are set the same way; a journey shown
 * as "1h 5m" beside a buffer shown as "65 min" would read as two different
 * units.
 */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
