import type { FinancialPeriodInput } from "./financial-series.ts";

/**
 * Charitable spend efficiency and "Where every £1 goes" analysis.
 *
 * Evaluates how much of every pound spent goes directly to the charitable cause
 * versus fundraising and statutory governance.
 */

export type SpendEfficiencyCategory =
  | "high_efficiency"
  | "balanced"
  | "high_fundraising_cost"
  | "high_overhead";

export type SpendEfficiencySummary = {
  periodEnd: string;
  yearLabel: string;
  totalExpenditure: number;
  charitableSpend: number;
  fundraisingSpend: number;
  governanceSpend: number;
  otherSpend: number;
  charitablePct: number;
  fundraisingPct: number;
  governancePct: number;
  otherPct: number;
  /** Pence in every pound (integers 0..100) */
  charitablePence: number;
  fundraisingPence: number;
  governancePence: number;
  otherPence: number;
  category: SpendEfficiencyCategory;
  tone: "go" | "neutral" | "hold";
  headline: string;
  insight: string;
};

export function computeSpendEfficiency(
  periods: readonly FinancialPeriodInput[],
): SpendEfficiencySummary | null {
  if (!periods || periods.length === 0) return null;

  // Find newest period with an expenditure breakdown published
  const breakdownPeriod = periods.find((p) => {
    return (
      (p.expenditure_charitable_activities !== undefined &&
        p.expenditure_charitable_activities !== null &&
        p.expenditure_charitable_activities > 0) ||
      (p.expenditure_raising_funds !== undefined &&
        p.expenditure_raising_funds !== null &&
        p.expenditure_raising_funds > 0)
    );
  });

  if (!breakdownPeriod) return null;

  const charitable = breakdownPeriod.expenditure_charitable_activities ?? 0;
  const fundraising = breakdownPeriod.expenditure_raising_funds ?? 0;
  const governance = breakdownPeriod.expenditure_governance ?? 0;
  const other = breakdownPeriod.expenditure_other ?? 0;

  const total =
    breakdownPeriod.total_expenditure && breakdownPeriod.total_expenditure > 0
      ? breakdownPeriod.total_expenditure
      : charitable + fundraising + governance + other;

  if (total <= 0) return null;

  const charitablePct = (charitable / total) * 100;
  const fundraisingPct = (fundraising / total) * 100;
  const governancePct = (governance / total) * 100;
  const accountedPct = charitablePct + fundraisingPct + governancePct;
  const otherPct = Math.max(0, 100 - accountedPct);

  const charitablePence = Math.min(100, Math.max(0, Math.round(charitablePct)));
  const fundraisingPence = Math.min(100, Math.max(0, Math.round(fundraisingPct)));
  const governancePence = Math.min(100, Math.max(0, Math.round(governancePct)));
  const otherPence = Math.max(0, 100 - (charitablePence + fundraisingPence + governancePence));

  const yearNum = breakdownPeriod.period_end ? breakdownPeriod.period_end.slice(0, 4) : "";
  const yearLabel = yearNum ? `FY${yearNum.slice(-2)}` : "Latest";

  let category: SpendEfficiencyCategory = "balanced";
  let tone: "go" | "neutral" | "hold" = "neutral";
  let headline = "";
  let insight = "";

  if (fundraisingPct >= 20) {
    category = "high_fundraising_cost";
    tone = "hold";
    headline = `Elevated fundraising cost (${fundraisingPence}p per £1)`;
    insight = `Spending ${fundraisingPence}p of every pound on fundraising is above the UK non-profit norm (8–15p). Indicates high acquisition costs or donor churn — a prime candidate for donor retention or fundraising strategy consulting.`;
  } else if (charitablePct >= 80) {
    category = "high_efficiency";
    tone = "go";
    headline = `High program efficiency (${charitablePence}p per £1 on direct cause)`;
    insight = `Over 80p of every pound directly powers charitable services, exceeding typical non-profit benchmarks (70–75%). Donors see exceptional value-for-money.`;
  } else if (charitablePct >= 65) {
    category = "balanced";
    tone = "neutral";
    headline = `Balanced expenditure allocation (${charitablePence}p per £1 on cause)`;
    insight = `Maintains a healthy balance between program delivery (${charitablePence}p), sustainable fundraising (${fundraisingPence}p), and governance (${governancePence}p).`;
  } else {
    category = "high_overhead";
    tone = "hold";
    headline = `Higher administrative & support overhead`;
    insight = `A lower share (${charitablePence}p in £1) reaches direct charitable activities, with remaining spend concentrated in support, governance, and operational overhead.`;
  }

  return {
    periodEnd: breakdownPeriod.period_end,
    yearLabel,
    totalExpenditure: total,
    charitableSpend: charitable,
    fundraisingSpend: fundraising,
    governanceSpend: governance,
    otherSpend: other,
    charitablePct,
    fundraisingPct,
    governancePct,
    otherPct,
    charitablePence,
    fundraisingPence,
    governancePence,
    otherPence,
    category,
    tone,
    headline,
    insight,
  };
}
