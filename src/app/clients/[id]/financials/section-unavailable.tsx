/**
 * A numbered section that has nothing to show, collapsed to one line.
 *
 * **Why the number survives an empty section.** A number is only useful if it
 * is an address — "look at 3" has to mean the same question on every record.
 * The moment a missing section renumbers the ones below it, or drops out and
 * leaves 1, 2, 4, the number stops being an address and becomes decoration.
 * So every record prints 1 through 5, and the ones with no data say why in a
 * single quiet line instead of a card-shaped hole.
 *
 * **Why this matters more here than it looks.** Sections 3 and 4 are empty for
 * most clients, and not because of a gap we can close: the Charity Commission
 * register publishes the income/expenditure breakdown and staff counts only for
 * charities with gross income over £500,000. Measured on the staging register
 * (3,825 real filed periods, no seed rows): below £500k, 2 of 361 periods in
 * the £350k-£500k range carry a breakdown; at £500,001 and above it is 100%.
 * The cliff is in the register, not in our ingestion — `charity-financial-
 * periods.ts` passes the register's nulls straight through and sums nothing.
 *
 * The copy says "the register publishes" rather than naming a rule. The
 * threshold is real and it is the annual return's, not the accounts rule (the
 * SORP accruals threshold is a different number), and a record page is the
 * wrong place to teach charity accounting.
 */
export function SectionUnavailable({
  headingId,
  number,
  title,
  reason,
}: {
  headingId: string;
  number: number;
  title: string;
  /** One line, in plain words, on why there is nothing here. */
  reason: string;
}) {
  return (
    <section
      aria-labelledby={headingId}
      className="scroll-mt-6 rounded-panel border border-dashed border-rule bg-paper/40 px-5 py-3.5"
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span
          aria-hidden="true"
          className="shrink-0 font-mono text-[15px] font-medium text-faint tabular-nums"
        >
          {number}
        </span>
        <h2
          id={headingId}
          className="text-[15px] leading-[1.3] font-semibold tracking-[-0.01em] text-dim"
        >
          <span className="sr-only">Section {number}. </span>
          {title}
        </h2>
        <p className="text-[13px] leading-[1.5] text-faint">{reason}</p>
      </div>
    </section>
  );
}
