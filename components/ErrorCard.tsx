import { cn } from "@/lib/cn";

interface ErrorCardProps {
  /** The `kind` discriminant from the API, or from the offline path. */
  kind: string | null;
  message: string;
}

/**
 * The failures, told apart.
 *
 * These are four genuinely different problems with four different next steps,
 * and collapsing them into one red box makes the reader do the work of figuring
 * out which one they have. Someone reading this is late and stressed, so each
 * one leads with a plain label saying what happened, and the message underneath
 * says what to do.
 *
 * Colour is never the only signal: every kind carries its own words. Read aloud
 * by a screen reader, or seen by someone who cannot separate orange from
 * magenta, each is still distinct.
 */
const KINDS: Record<
  string,
  { label: string; accent: string; border: string; tint: string }
> = {
  RATE_LIMIT: {
    label: "Too many searches",
    accent: "text-gold",
    border: "border-gold/40",
    tint: "bg-gold/5",
  },
  NO_TRAINS: {
    // Not a failure of the app — a real answer about the timetable.
    label: "No train fits",
    accent: "text-cyan",
    border: "border-cyan/40",
    tint: "bg-cyan/5",
  },
  INVALID_STATION: {
    label: "Check the stations",
    accent: "text-magenta",
    border: "border-magenta/40",
    tint: "bg-magenta/5",
  },
  VALIDATION: {
    label: "Check the details",
    accent: "text-magenta",
    border: "border-magenta/40",
    tint: "bg-magenta/5",
  },
  NETWORK: {
    label: "No connection",
    accent: "text-orange",
    border: "border-orange/40",
    tint: "bg-orange/5",
  },
  OFFLINE: {
    label: "Offline",
    accent: "text-orange",
    border: "border-orange/40",
    tint: "bg-orange/5",
  },
};

const FALLBACK = {
  label: "Something went wrong",
  accent: "text-magenta",
  border: "border-magenta/40",
  tint: "bg-magenta/5",
};

export default function ErrorCard({ kind, message }: ErrorCardProps) {
  const style = (kind && KINDS[kind]) || FALLBACK;

  return (
    <div
      role="alert"
      data-testid="result-error"
      className={cn("rounded-2xl border p-4", style.border, style.tint)}
    >
      <p
        className={cn(
          "mb-1 text-xs font-semibold uppercase tracking-wider",
          style.accent
        )}
      >
        {style.label}
      </p>
      <p className="text-sm leading-relaxed text-ink-muted">{message}</p>
    </div>
  );
}
