import { CalendarClock, FileQuestion, Info } from "lucide-react";

import type { MissingAccountsReason } from "@/lib/financials/financial-series";

/**
 * Why this client's Financials tab is empty.
 *
 * Before this, an empty tab was indistinguishable from a broken one — and it
 * was overwhelmingly neither. Charity Commission discovery searches the
 * register *forward from a registration watermark*, so it imports charities
 * registered since the last run: 769 of 774 records on staging were registered
 * inside two years. A charity has twelve months to reach its first financial
 * year end and ten more to file, so for the best part of two years there is no
 * annual return in existence to fetch. The register is not withholding
 * anything and the pipeline is not failing.
 *
 * Three states, because they are three different facts and a CAM acts
 * differently on each:
 *
 * - **Too new.** Nothing is due yet. Says when the first return becomes
 *   expected, so nobody re-checks this record for a year.
 * - **Nothing filed.** Long enough registered that a return should exist. That
 *   is a real signal about the organisation, not about us.
 * - **Cannot tell.** We hold no registration date yet, which happens until the
 *   weekly refresh has visited the record. Said plainly rather than guessed at.
 */
export function NoAccountsNotice({
  reason,
  charityNumber,
}: {
  reason: MissingAccountsReason;
  /** Links out to the register, which is the only place to check by hand. */
  charityNumber?: string | null;
}) {
  const registerLink = charityNumber
    ? `https://register-of-charities.charitycommission.gov.uk/en/charity-search/-/charity-details/${charityNumber.replace(/\D/g, "")}`
    : null;

  const content =
    reason.kind === "too_new"
      ? {
          icon: <CalendarClock aria-hidden="true" className="size-4 shrink-0" />,
          title: "No accounts filed yet — and none is due",
          body: (
            <>
              This charity was registered{" "}
              {reason.monthsRegistered <= 1
                ? "within the last month"
                : `${reason.monthsRegistered} months ago`}
              . A charity has twelve months to reach its first financial year end
              and ten more to file, so the Commission publishes nothing until
              then
              {reason.dueFrom
                ? ` — expect a first return from around ${new Date(reason.dueFrom).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}.`
                : "."}{" "}
              We check the register weekly and this tab fills itself in.
            </>
          ),
        }
      : reason.kind === "nothing_filed"
        ? {
            icon: <FileQuestion aria-hidden="true" className="size-4 shrink-0" />,
            title: "No accounts on the register",
            body: (
              <>
                Registered {Math.floor(reason.monthsRegistered / 12)} years ago,
                with no annual return the Commission publishes figures for. That
                is unusual for a charity of that age — it may be late filing, or
                filing under a threshold that reports totals only.
              </>
            ),
          }
        : {
            icon: <Info aria-hidden="true" className="size-4 shrink-0" />,
            title: "No accounts held yet",
            body: (
              <>
                We hold no filed accounts and no registration date for this
                charity, so we cannot say whether a return is due. The weekly
                register refresh fills both in.
              </>
            ),
          };

  return (
    <div className="rounded-panel border border-rule bg-white p-5">
      <div className="flex gap-3">
        <span className="mt-0.5 text-faint">{content.icon}</span>
        <div className="min-w-0">
          <h2 className="text-[15px] leading-[1.35] font-semibold text-ink">
            {content.title}
          </h2>
          <p className="mt-1.5 text-[13px] leading-[1.6] text-dim">{content.body}</p>
          {registerLink && (
            <a
              href={registerLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2.5 inline-block text-[12.5px] font-medium text-lead underline decoration-lead/30 underline-offset-2 transition-colors hover:decoration-lead"
            >
              Check charity {charityNumber} on the register
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
