import type { ReactNode } from "react";

/**
 * The client record's two repeated shapes, in one place so the tabs and the
 * client components they render can't drift into two slightly different cards.
 * Neither is marked "use client": they hold no state, so they work from a server
 * page and get pulled into the client bundle by whoever imports them.
 *
 * Redesign (Sept 2026) — the "filed record" language. Three things changed and
 * each was fixing something specific:
 *
 * - **A border you can see.** `border-black/[0.06]` is #f0f0f0 on white: 1.06:1,
 *   effectively invisible, which is why white cards on bone dissolved into each
 *   other and the page read as grey mush. `border-rule` is 1.35:1, and the card
 *   no longer needs a shadow to look like a card. Shadows are for things that
 *   float — popovers, dialogs — not for things that sit on the page.
 * - **A title you can read.** The old heading was
 *   `text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40` — in
 *   44 files. Caps at 40% opacity is unreadable *and* shouting, and it made every
 *   card read as a dashboard widget. Titles are sentence case at a real weight
 *   and a real colour now. Uppercase + tracking survives in exactly one place on
 *   this record: a register key, where it is a code rather than a label.
 * - **No icon tile.** `size-8 rounded-xl bg-black/[0.04] ring-1 ring-black/[0.05]`
 *   around a 16px glyph is the most templated component of the last three years.
 *   Icons sit inline in muted ink, at the title's baseline, and only where they
 *   disambiguate one row from another.
 */
export function SectionCard({
  headingId,
  title,
  hint,
  action,
  icon,
  children,
  className = "",
  tone = "default",
}: {
  /** Target for the section's `aria-labelledby`. */
  headingId: string;
  title: string;
  /** Optional one-line explanation under the title. */
  hint?: ReactNode;
  /** Optional control pinned to the heading row's right edge. */
  action?: ReactNode;
  /** Optional glyph, inline beside the title. Sized to 15px. */
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** `danger` tints the card where outreach is blocked. */
  tone?: "default" | "danger";
}) {
  const toneClasses =
    tone === "danger"
      ? "border-stop/25 bg-stop-wash/50"
      : "border-rule bg-white";

  return (
    <section
      aria-labelledby={headingId}
      className={`scroll-mt-6 rounded-panel border px-5 py-4.5 ${toneClasses} ${className}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-baseline gap-2.5">
          {icon && (
            <span
              aria-hidden="true"
              className={`shrink-0 self-center [&_svg]:size-[15px] ${
                tone === "danger" ? "text-stop/70" : "text-faint"
              }`}
            >
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h2
              id={headingId}
              className={`scroll-mt-24 text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] ${
                tone === "danger" ? "text-stop" : "text-ink"
              }`}
            >
              {title}
            </h2>
            {hint && (
              <p className="mt-1 max-w-[54ch] text-[13px] leading-[1.55] text-dim">
                {hint}
              </p>
            )}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * Status marker.
 *
 * The record has a lot of state to show — email validity, website reachability,
 * pipeline stage, suppression, send outcome — and letting each pick its own
 * greens and reds is how the old version ended up with five hardcoded palettes
 * plus borrowed `amber-500` and `red-800` from Tailwind's ramp.
 *
 * Four tones, all from the token set, and the semantic ones are deliberately
 * separate from `--lead`: the accent tells you where you are, the state tells
 * you what is true. `go` is where 180DC's green now lives and the only place it
 * appears — retuned from #72b744, which is 2.3:1 on white and unusable as text.
 *
 * The dot carries the meaning as shape as well as colour, so the state survives
 * a greyscale print and a red-green colour deficiency.
 */
const PILL_TONES = {
  neutral: "bg-paper-sunk text-dim",
  lead: "bg-lead-wash text-lead",
  go: "bg-go-wash text-go",
  hold: "bg-hold-wash text-hold",
  stop: "bg-stop-wash text-stop",
} as const;

export function Pill({
  tone = "neutral",
  dot = true,
  children,
}: {
  tone?: keyof typeof PILL_TONES;
  /** Set false for a pill that labels rather than reports a state. */
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] leading-none font-semibold whitespace-nowrap ${PILL_TONES[tone]}`}
    >
      {dot && (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      )}
      {children}
    </span>
  );
}

/**
 * A register key: `UK CHARITY`, `PRIORITY`, `OWNER`. The one surviving use of
 * uppercase + letter-spacing on this record, in mono, because these are codes
 * and labels for codes — not section headings pretending to be codes.
 */
export function Key({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[10.5px] font-medium tracking-[0.09em] text-faint uppercase">
      {children}
    </span>
  );
}
