import type { ReactNode } from "react";

/**
 * The client detail page's two repeated shapes, in one place so the page and the
 * client components it renders (BasicInfoPanel) can't drift into two slightly
 * different cards. Neither is marked "use client": they hold no state, so they
 * work as-is from a server page and get pulled into the client bundle by whoever
 * imports them from a client component.
 *
 * Chrome matches the client list's rows and the dashboard's cards — bone ground,
 * white card, hairline border at ink /6, `shadow-sm`, `rounded-2xl`
 * (docs/design-system.md §Shape). The heading is the eyebrow spec (11px, bold,
 * uppercase, `tracking-[0.12em]`) rather than a bold body-size line, so a card's
 * label recedes and its content carries the page.
 *
 * Redesign (Aug 2026): three additive upgrades, so every existing call site —
 * including the ones inside BasicInfoPanel and ScoreBreakdownCard — inherits the
 * new look without changing a line:
 * - an optional `icon` rendered in a quiet tile beside the eyebrow;
 * - the default tone lifts a touch on hover (border + shadow), matching the
 *   list rows' hover language;
 * - `scroll-mt` on the card and its heading so the hero band's anchor rail
 *   lands sections below the top edge instead of flush against it.
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
  /** Optional glyph, shown in a quiet tile beside the title. Sized to 16px. */
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** `danger` tints the card for the Do Not Contact zone. */
  tone?: "default" | "danger";
}) {
  const toneClasses =
    tone === "danger"
      ? "border-destructive/15 bg-destructive/[0.04]"
      : "border-black/[0.06] bg-white shadow-sm transition-[border-color,box-shadow] duration-300 hover:border-black/[0.1] hover:shadow-md";

  return (
    <section
      aria-labelledby={headingId}
      className={`scroll-mt-6 rounded-2xl border p-6 ${toneClasses} ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-start gap-3">
          {icon && (
            <span
              aria-hidden="true"
              className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-black/[0.04] text-foreground/55 ring-1 ring-black/[0.05] [&_svg]:size-4"
            >
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h2
              id={headingId}
              className={`scroll-mt-24 text-[11px] font-bold uppercase tracking-[0.12em] ${
                tone === "danger" ? "text-destructive/70" : "text-foreground/40"
              }`}
            >
              {title}
            </h2>
            {hint && (
              <p className="mt-1.5 max-w-prose text-[13px] leading-[1.6] text-foreground/50">
                {hint}
              </p>
            )}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Status marker. Four tones only — the page has a lot of state to show (email
 * validity, reachability, pipeline stage, suppression) and letting each one pick
 * its own greens and reds is how the old version ended up with five different
 * hardcoded palettes. `brand` is the app green from globals.css, `danger` the
 * `--destructive` token; `warn` is the one colour with no token yet, and is the
 * same amber the assign-owner conflict notice uses.
 */
const PILL_TONES = {
  neutral: "bg-black/[0.04] text-foreground/55",
  brand: "bg-brand/12 text-brand-hover",
  warn: "bg-amber-500/12 text-amber-800",
  danger: "bg-destructive/[0.08] text-destructive",
} as const;

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof PILL_TONES;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] ${PILL_TONES[tone]}`}
    >
      {children}
    </span>
  );
}
