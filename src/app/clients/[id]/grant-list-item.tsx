/**
 * One grant row's markup + formatting, shared between the server-rendered
 * GrantHistorySection and the client-side GrantHistoryLoadMore pager so the
 * two can never drift apart. No directive on purpose: it has no state and is
 * imported from both a server component (renders during SSR) and a client
 * component (renders appended pages), and React treats it as a shared leaf.
 *
 * Amounts are formatted with Intl.NumberFormat, which behaves identically on
 * the server and in the browser.
 */
/**
 * How many grants the client detail page renders before asking for more. The
 * first page is rendered server-side in page.tsx; later pages arrive through
 * loadMoreGrants. Kept here, not in the "use server" action file, because
 * Next.js only allows async-function exports from a "use server" module — and
 * the client-side pager needs the number for its "Load N more" label.
 */
export const GRANT_HISTORY_PAGE_SIZE = 20;

export type GrantRow = {
  id: string;
  funder_name: string;
  amount_awarded: number | null;
  currency: string;
  award_date: string | null;
  grant_programme: string | null;
  description: string | null;
};

type IntlCurrencies =
  | "GBP"
  | "EUR"
  | "USD"
  | "CAD"
  | "AUD"
  | "NZD"
  | "CHF"
  | "JPY"
  | string;

/**
 * Formats a grant amount for its own currency. Falls back to a plain number
 * when the stored currency isn't one Intl knows — a foreign foundation's award
 * in a minor currency should still show its magnitude, just un-suffixed.
 */
function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency as IntlCurrencies,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("en-GB")} ${currency}`;
  }
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function GrantListItem({ grant }: { grant: GrantRow }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 border-t border-rule-soft py-3 first:border-t-0 first:pt-0">
      <p className="min-w-0 truncate text-[13.5px] font-medium text-ink">
        {grant.funder_name}
      </p>
      {/* Mono and tabular so a column of awards lines up on the decimal —
          the reason the old proportional figures read as sloppy. */}
      <p className="shrink-0 font-mono text-[13.5px] font-medium tabular-nums text-ink">
        {grant.amount_awarded != null
          ? formatAmount(grant.amount_awarded, grant.currency)
          : "Not disclosed"}
      </p>
      <p className="min-w-0 truncate text-[12.5px] text-dim">
        {grant.grant_programme ?? "Programme not recorded"}
      </p>
      <p className="shrink-0 font-mono text-[12px] text-faint tabular-nums">
        {grant.award_date ? formatDate(grant.award_date) : "—"}
      </p>
      {grant.description && (
        <p className="col-span-2 mt-0.5 text-[13px] leading-[1.55] text-dim">
          {grant.description}
        </p>
      )}
    </li>
  );
}
