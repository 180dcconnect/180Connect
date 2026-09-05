"use client";

import type { FinancialSeries } from "@/lib/financials/financial-series";
import { summariseFunders, type FunderGrantInput } from "@/lib/financials/funders";
import { formatCompactGbp, formatGbp } from "@/lib/income-band";

import { HorizontalStickGauge } from "@/components/ui/horizontal-stick-gauge";
import { share, StatBlock, StatFigure, StatMissing } from "./chart-parts";

/**
 * Where the money comes from, and how many places it comes from.
 *
 * **The question.** A CAM looking at £600k of awards needs to know whether that
 * is one funder or fifteen. One funder at 90% is a fragility signal *and* an
 * opening line; fifteen at 7% each is a fundraising operation with a rhythm.
 * The grant table underneath lists every award and answers neither, because
 * reading concentration off a paginated list is a job nobody does.
 *
 * **Why concentration, given there is no balance sheet.** The data model holds
 * no reserves, assets or liabilities, so the usual resilience questions cannot
 * be asked honestly. Who the money comes from, and how few of them there are,
 * is the closest read on fragility the register and 360Giving can support. It
 * is not a substitute for reserves and is not dressed up as one.
 *
 * **Government money was invisible to exactly the clients it matters most for.**
 * `governmentIncome`, `governmentShare` and `governmentAwards` are computed on
 * every filed year, and until this section existed they rendered only inside
 * `IncomeMixPanel` — the *fallback* panel, shown when the Sankey cannot be
 * drawn. Every charity over the register's £500k breakdown threshold gets the
 * Sankey instead, so every charity large enough to publish a government income
 * line was the one charity whose government income you could not see.
 *
 * The three register fields are deliberately read together, the way the annual
 * return splits them: the flag says whether the relationship exists, the amount
 * says how big it is, the count says how many awards it took. A return can
 * carry the flag and publish no amount, and "they take public money, size not
 * published" is a real answer.
 */

/** One funder's row in the concentration list. */
function FunderRow({
  name,
  amount,
  awards,
  of,
}: {
  name: string;
  amount: number;
  awards: number;
  of: number;
}) {
  return (
    <li className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3">
      <span className="truncate text-[12.5px] text-ink" title={name}>
        {name}
      </span>
      <div className="min-w-0">
        <HorizontalStickGauge
          checked={amount}
          total={of}
          stickHeight={10}
          pitch={6.5}
          stickWidth={2.5}
          showTooltip={false}
          ariaLabel={`${name} funding share`}
        />
      </div>
      <span className="font-mono text-[12px] tabular-nums text-ink">
        {formatCompactGbp(amount)}
        {awards > 1 && (
          <span className="ml-1.5 text-[11px] text-faint">×{awards}</span>
        )}
      </span>
    </li>
  );
}

/** How many funders to draw before the list becomes a table nobody reads. */
const FUNDERS_SHOWN = 5;

export function FundingProfile({
  grants,
  series,
}: {
  /** Every award we hold for this client, not the paginated first page. */
  grants: readonly FunderGrantInput[];
  series: FinancialSeries;
}) {
  const profile = summariseFunders(grants);

  // The newest year that published a government figure, which is not always the
  // newest filed year — the same rule the headcount section follows.
  const governmentYear = [...series.years]
    .reverse()
    .find(
      (year) =>
        year.governmentIncome !== null ||
        year.receivesGovernmentGrants !== null ||
        year.receivesGovernmentContracts !== null,
    );

  const takesPublicMoney =
    governmentYear?.receivesGovernmentGrants === true ||
    governmentYear?.receivesGovernmentContracts === true ||
    (governmentYear?.governmentIncome ?? 0) > 0;

  if (profile.funderCount === 0 && !governmentYear) return null;

  const shown = profile.funders.slice(0, FUNDERS_SHOWN);
  const remaining = profile.funderCount - shown.length;

  return (
    <div className="mt-4 space-y-5">
      {profile.funderCount > 0 && (
        <div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatBlock
              caption={
                profile.funderCount === 1
                  ? "All awards from one funder"
                  : `Across ${profile.awardCount.toLocaleString("en-GB")} awards`
              }
              label="Distinct funders"
              value={<StatFigure>{profile.funderCount.toLocaleString("en-GB")}</StatFigure>}
            />
            <StatBlock
              caption={
                profile.topShare === null
                  ? "No award amounts published"
                  : `From ${profile.funders[0].name}`
              }
              label="Largest funder's share"
              value={
                profile.topShare === null ? (
                  <StatMissing />
                ) : (
                  <StatFigure>{share(profile.topShare)}</StatFigure>
                )
              }
            />
            <StatBlock
              className="col-span-2 sm:col-span-1"
              caption={
                profile.repeatFunders === 0
                  ? "Every funder gave once"
                  : "Funders who gave more than once"
              }
              label="Repeat funders"
              value={<StatFigure>{profile.repeatFunders.toLocaleString("en-GB")}</StatFigure>}
            />
          </div>

          {profile.total > 0 && (
            <ul className="mt-4 space-y-2">
              {shown.map((funder) => (
                <FunderRow
                  key={funder.name}
                  amount={funder.amount}
                  awards={funder.awards}
                  name={funder.name}
                  of={profile.funders[0].amount}
                />
              ))}
            </ul>
          )}

          <p className="mt-2.5 text-[11.5px] leading-[1.5] text-faint">
            {remaining > 0 &&
              `${remaining.toLocaleString("en-GB")} further ${remaining === 1 ? "funder" : "funders"} not shown. `}
            {formatGbp(profile.total)} across every award we hold from 360Giving —
            publishers report at their own pace, so this is a floor, not a
            complete funding history.
            {profile.excludedCurrency > 0 &&
              ` ${profile.excludedCurrency.toLocaleString("en-GB")} ${profile.excludedCurrency === 1 ? "award was" : "awards were"} made in another currency and left out rather than converted at a rate we do not hold.`}
          </p>
        </div>
      )}

      {governmentYear && (
        <div className="border-t border-rule-soft pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-[14px] font-semibold text-ink">Public money</h3>
            <p className="text-[12px] text-dim">{governmentYear.label} return</p>
          </div>

          {takesPublicMoney ? (
            <>
              <p className="mt-2 rounded-inset bg-lead-wash px-3 py-2 text-[12.5px] leading-[1.5] text-lead">
                {governmentYear.governmentIncome !== null ? (
                  <>
                    <strong className="font-semibold">
                      {formatGbp(governmentYear.governmentIncome)}
                    </strong>{" "}
                    of this year&rsquo;s income came from government grants and
                    contracts
                    {governmentYear.governmentShare !== null &&
                      ` — ${share(governmentYear.governmentShare)} of everything they took in`}
                    .
                  </>
                ) : (
                  <>
                    The return reports {governmentReceipts(governmentYear)}, but
                    publishes no amount against them.
                  </>
                )}
                {governmentYear.governmentAwards !== null &&
                  ` ${governmentYear.governmentAwards.toLocaleString("en-GB")} ${governmentYear.governmentAwards === 1 ? "award" : "awards"} in total.`}
              </p>
              {governmentYear.governmentShare !== null && (
                <div className="mt-3">
                  <HorizontalStickGauge
                    checked={governmentYear.governmentIncome ?? 0}
                    total={governmentYear.income ?? 0}
                    checkedLabel="Public money"
                    remainingLabel="Other income"
                    ariaLabel="Share of income from public money"
                    valueFormatter={formatGbp}
                  />
                  <p className="mt-2 text-[11.5px] leading-[1.5] text-faint">
                    One large contract and fifteen small grants are different
                    funding profiles at the same total, which is why the count
                    sits next to the amount.
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="mt-2 text-[12.5px] leading-[1.55] text-dim">
              No government grants or contracts reported on the {governmentYear.label}{" "}
              return — every pound on it came from somewhere else.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** The register's two public-money relationships, named in the words the return
 *  uses, for the case where the flags are set but no amount was published. */
function governmentReceipts(year: {
  receivesGovernmentGrants: boolean | null;
  receivesGovernmentContracts: boolean | null;
}): string {
  const both = year.receivesGovernmentGrants && year.receivesGovernmentContracts;
  if (both) return "both government grants and government contracts";
  if (year.receivesGovernmentGrants) return "government grants";
  if (year.receivesGovernmentContracts) return "government contracts";
  return "government funding";
}
