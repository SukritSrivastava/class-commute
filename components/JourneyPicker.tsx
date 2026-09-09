"use client";

import StationAutocomplete from "@/components/StationAutocomplete";
import { Press } from "@/components/motion";
import type { StationOption } from "@/lib/stations";
import { cn } from "@/lib/cn";

interface JourneyPickerProps {
  home: StationOption | null;
  college: StationOption | null;
  onHomeChange: (station: StationOption | null) => void;
  onCollegeChange: (station: StationOption | null) => void;
  onSwap: () => void;
  homeInvalid?: boolean;
  collegeInvalid?: boolean;
  /** Runs the sweep down the line while a route is being looked up. */
  searching?: boolean;
}

/**
 * Origin and destination, drawn as a line rather than stacked as two fields.
 *
 * The rail down the left is the whole idea: a hollow ring where you are, a
 * filled dot where you are going, and a line between them that the swap control
 * sits *on* rather than beside. It costs one grid column and it is the
 * difference between this reading as an app about trains and reading as a form.
 *
 * While a lookup is in flight the line sweeps with the sunset gradient. That is
 * the loading state for the whole screen — "searching this route", pointed at
 * the thing actually being searched — instead of grey rectangles pretending to
 * be content that is about to arrive.
 *
 * ## The axis
 *
 * Everything on the rail — both dots, the line, and the centre of the swap
 * button — sits on one vertical, and every offset below is derived rather than
 * eyeballed. The pieces come from three fixed heights: a field label is 22px
 * (16px of text plus a 6px gap), an input is 48px, and the swap button is 44px.
 *
 *   - **Horizontal.** The rail column is 28px wide with a 12px gap, so the axis
 *     is at x=14 and the fields start at x=40. The dots and line are centred in
 *     the rail column by `items-center`; the button lives in the *fields*
 *     column for tab order (From → swap → To), so it is pulled back onto the
 *     axis by hand: 40 + (-48) + 22 = 14. This offset used to be -2.4rem, which
 *     left the button 9.6px to the right of the dots and made the rail read as
 *     a decorative line beside the form rather than a route through it.
 *
 *   - **Vertical.** Each dot sits on the centre of its input (22 + 24 = 46px
 *     from the top of its field), and the button belongs on the midpoint
 *     between them. Because the "To" label sits inside the gap and the "From"
 *     label does not, that midpoint is *not* the middle of the gap — it is
 *     22px (one label) lower. So the swap row's top margin has to exceed its
 *     bottom margin by exactly 22px, which is what `-mt-1` (8px after
 *     collapsing with the 12px from `space-y-3`) and `-mb-3.5` (-14px) give.
 */
export default function JourneyPicker({
  home,
  college,
  onHomeChange,
  onCollegeChange,
  onSwap,
  homeInvalid,
  collegeInvalid,
  searching = false,
}: JourneyPickerProps) {
  return (
    <div className="grid grid-cols-[1.75rem_1fr] gap-x-3">
      {/* The rail. Purely decorative — every bit of meaning it carries is also
          in the two field labels. */}
      <div data-rail aria-hidden className="relative flex flex-col items-center">
        {/* Origin: hollow, because you haven't left yet. 39px = the 46px to the
            input's centre, less half the 14px dot. */}
        <span
          className={cn(
            "mt-[2.4375rem] h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-colors",
            home ? "border-magenta" : "border-hairline-strong"
          )}
        />

        {/* No vertical margin: the line meets both dots rather than stopping a
            few pixels short of each, which is the difference between a route
            and two markers with a stroke between them. It runs the whole way
            and the swap button sits on top of it. */}
        <span className="relative w-px flex-1 overflow-hidden bg-hairline-strong">
          {searching && (
            <span className="journey-line-sweep absolute inset-x-0 h-1/2" />
          )}
        </span>

        {/* Destination: solid, and gold — the same colour as the best pick.
            17px = half the 48px input, less half the dot. */}
        <span
          className={cn(
            "mb-[1.0625rem] h-3.5 w-3.5 shrink-0 rounded-full transition-colors",
            college ? "bg-gold" : "bg-hairline-strong"
          )}
        />
      </div>

      <div className="min-w-0 space-y-3">
        <StationAutocomplete
          label="From"
          placeholder="Home station"
          value={home}
          onChange={onHomeChange}
          invalid={homeInvalid}
        />

        {/* Sitting on the line, not next to it: the control is the join. See
            the axis note above for where every number here comes from. */}
        <div className="relative z-10 -mt-1 -mb-3.5 flex h-11 items-center">
          <Press
            type="button"
            onClick={onSwap}
            aria-label="Swap home and college stations"
            className="-ml-12 flex h-11 w-11 items-center justify-center rounded-full border border-hairline-strong bg-night-2 text-ink-muted hover:text-cyan"
          >
            <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-4 w-4">
              <path
                d="M6 3v11M6 14 3 11m3 3 3-3M14 17V6m0 0 3 3m-3-3-3 3"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Press>
        </div>

        <StationAutocomplete
          label="To"
          placeholder="College station"
          value={college}
          onChange={onCollegeChange}
          invalid={collegeInvalid}
        />
      </div>
    </div>
  );
}
