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
    <li className="rounded-xl border border-black/[0.06] p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 truncate text-sm font-bold text-foreground/80">
          {grant.funder_name}
        </p>
        <p className="shrink-0 text-sm font-black tabular-nums text-foreground/85">
          {grant.amount_awarded != null
            ? formatAmount(grant.amount_awarded, grant.currency)
            : "Amount not disclosed"}
        </p>
      </div>
      <p className="mt-1 text-[12px] text-foreground/40">
        {grant.award_date ? formatDate(grant.award_date) : "Date not recorded"}
        {grant.grant_programme ? ` · ${grant.grant_programme}` : ""}
      </p>
      {grant.description && (
        <p className="mt-2 text-[13px] leading-[1.6] text-foreground/60">
          {grant.description}
        </p>
      )}
    </li>
  );
}
