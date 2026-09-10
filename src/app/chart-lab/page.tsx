import {
  buildFinancialSeries,
  buildFundFlows,
  type FinancialPeriodInput,
} from "@/lib/financials/financial-series";
import { FundFlowSankey } from "../clients/[id]/financials/fund-flow-sankey";
import {
  HourglassStream,
  RungWaterfall,
  StackedRungs,
  StrandSankey,
  type Line,
} from "./lab-charts";

/**
 * TEMPORARY — chart selection for the Financials tab. `/chart-lab`.
 *
 * Delete this whole folder once an option is picked. Nothing outside it imports
 * anything from it, and it imports only `financial-series` and the Sankey the
 * app already ships, so removing it cannot break the product.
 *
 * The figures are a real staging filing (The Garden Museum, Charity Commission
 * `charityfinancialhistory`) hardcoded rather than fetched: the point is to
 * compare five drawings of one identical dataset, and a live query would make
 * the page depend on which client you happened to open.
 */

const PERIODS: FinancialPeriodInput[] = [
  {
    period_start: "2024-04-01",
    period_end: "2025-03-31",
    total_income: 4_314_025,
    total_expenditure: 4_191_442,
    income_donations_legacies: 1_411_392,
    income_charitable_activities: 814_620,
    income_other_trading: 2_117_613,
    income_investment: 10_588,
    income_endowments: 91_564,
    income_other: 51_376,
    expenditure_charitable_activities: 1_800_975,
    expenditure_raising_funds: 2_390_467,
    expenditure_other: 0,
    expenditure_governance: 18_928,
  },
  {
    period_start: "2023-04-01",
    period_end: "2024-03-31",
    total_income: 3_357_899,
    total_expenditure: 3_420_773,
    income_donations_legacies: 1_134_743,
    income_charitable_activities: 551_109,
    income_other_trading: 1_628_217,
    income_investment: 5_073,
    income_endowments: 81_595,
    income_other: 38_757,
    income_govt_grants: 6_000,
    expenditure_charitable_activities: 1_896_567,
    expenditure_raising_funds: 1_524_206,
    expenditure_other: 0,
    expenditure_governance: 13_800,
  },
  {
    period_start: "2022-04-01",
    period_end: "2023-03-31",
    total_income: 2_871_926,
    total_expenditure: 3_110_355,
    income_donations_legacies: 936_109,
    income_charitable_activities: 555_811,
    income_other_trading: 1_379_607,
    income_investment: 399,
    income_endowments: 98_267,
    expenditure_charitable_activities: 1_740_076,
    expenditure_raising_funds: 1_370_279,
    expenditure_governance: 13_800,
  },
  {
    period_start: "2021-04-01",
    period_end: "2022-03-31",
    total_income: 3_403_621,
    total_expenditure: 2_658_618,
    income_donations_legacies: 1_941_921,
    income_charitable_activities: 367_018,
    income_other_trading: 1_094_669,
    income_investment: 13,
    income_govt_grants: 136_000,
    expenditure_charitable_activities: 1_409_445,
    expenditure_raising_funds: 1_237_291,
    expenditure_other: 11_882,
  },
  {
    period_start: "2020-04-01",
    period_end: "2021-03-31",
    total_income: 2_118_613,
    total_expenditure: 1_737_840,
    income_donations_legacies: 1_480_758,
    income_charitable_activities: 172_573,
    income_other_trading: 465_260,
    income_investment: 22,
    income_govt_grants: 50_832,
    expenditure_charitable_activities: 165_380,
    expenditure_raising_funds: 1_572_460,
  },
];

/** FY25 as plain lines, for the four charts that draw a single year. */
const INCOME: Line[] = [
  { label: "Other trading", amount: 2_117_613 },
  { label: "Donations and legacies", amount: 1_411_392 },
  { label: "Charitable activities", amount: 814_620 },
  { label: "Endowments", amount: 91_564 },
  { label: "Other income", amount: 51_376 },
  { label: "Investments", amount: 10_588 },
];
const SPEND: Line[] = [
  { label: "Raising funds", amount: 2_390_467 },
  { label: "Charitable activities", amount: 1_800_975 },
];

type Option = {
  tag: string;
  template: string;
  title: string;
  thesis: string;
  shows: string[];
  costs: string[];
  chart: React.ReactNode;
};

export default function ChartLabPage() {
  const series = buildFinancialSeries({ periods: PERIODS, grants: [] });
  const flows = buildFundFlows(series);

  const options: Option[] = [
    {
      tag: "Option A · in the app now",
      template: "G22 Aggregate Sankey · Glance",
      title: "Money in, a pot, money out",
      thesis:
        "Every income line converges on one hub and every spending line leaves it. The hub is there because the register never says which income paid for which activity. Band width is pounds; shade is rank by size. Hover a band to trace it, and the year strip steps through all five filed years.",
      shows: [
        "Both splits and the balance between them in one read.",
        "The surplus as a band with real width, not a separate statistic.",
        "The only option here that carries more than one year.",
      ],
      costs: [
        "Three of six income lines are too thin to label — Investments at 0.2% is a hairline.",
        "The most complex thing on the page; a reader learns it once.",
        "A solid ribbon asks you to trust its width rather than showing you why.",
      ],
      chart: <FundFlowSankey flows={flows} />,
    },
    {
      tag: "Option B",
      template: "F7 Stacked Rungs · Lupi Basics",
      title: "Two ladders, counted in £50,000 rungs",
      thesis:
        "Stop drawing a smooth bar and start counting units. Each rung is £50,000 of real money, so the height is countable rather than a length you take on faith. Income left, spending right, surplus as the gap between the towers.",
      shows: [
        "Easiest to read of the five — it is two bars, and everyone reads bars.",
        "Main-force Lupi Basics, which is the family you asked for.",
        "Every line labelled with its real figure regardless of size.",
      ],
      costs: [
        "Investments (£10,588) is a fifth of one rung and draws nothing.",
        "The surplus is a height difference between two towers, not a shape.",
        "No flow: two piles, not money moving between them.",
      ],
      chart: <StackedRungs income={INCOME} spend={SPEND} />,
    },
    {
      tag: "Option C",
      template: "F9 Rung Waterfall · Lupi Basics",
      title: "Start at income, subtract until what's left is the surplus",
      thesis:
        "Solid rungs add, dashed rungs take away, and the last column is whatever survived. The only option where the surplus is the destination rather than a leftover — arguably the number a CAM opens with.",
      shows: [
        "The surplus arrived at rather than left over.",
        "Spending ranked by what it consumes, which is the fundraising story here.",
        "Familiar shape — anyone who has read a P&L recognises it instantly.",
      ],
      costs: [
        "The income split disappears entirely; £4.5m arrives as one bar.",
        "Implies an order of deductions the accounts do not have.",
        "Half the data we went and fetched is not on the chart.",
      ],
      chart: <RungWaterfall income={INCOME} spend={SPEND} />,
    },
    {
      tag: "Option D",
      template: "L13 Hourglass Stream · Lupi Editorial",
      title: "The year as two strips, one tick per £50,000",
      thesis:
        "Income becomes a barcode segmented by source; threads trickle into a second strip segmented by what the money paid for; and the strips are visibly different widths, which is the surplus. The most editorial of the five.",
      shows: [
        "Handsome enough for a client-facing brief or a deck.",
        "Both splits, and the surplus as a genuine narrowing.",
        "Countable ticks, so the picture can be checked against the table.",
      ],
      costs: [
        "Slowest to read — a 30-second chart in a tab people scan.",
        "Segment boundaries inside a barcode are subtler than bands or bars.",
        "The trickling threads are texture, not data, which needs saying out loud.",
      ],
      chart: <HourglassStream income={INCOME} spend={SPEND} />,
    },
    {
      tag: "Option E · built from the principles",
      template: "No template — composed via the skill's §6 route",
      title: "Ninety strands of £50,000, and you can count them",
      thesis:
        "Not a template copy. The library has no Sankey outside G22, so this one is composed the way the skill says to compose a new chart: answer the ontology first, borrow the nearest relatives' grammar, build only from Mono tokens. The Lupi move is to refuse the smooth aggregate — so the ribbon dissolves into strands, one per £50,000, and the width becomes evidence instead of an assertion. Dashed strands are money that was not spent, borrowed from the waterfall's grammar. Both sides allocate the same ninety by largest remainder, so no strand is created or destroyed crossing the pot.",
      shows: [
        "Width you can audit — count the strands against the table.",
        "The pot drawn as an open bracket, because money passes through it rather than sitting in it.",
        "A rim scale every ten strands, so £500,000 has a fixed physical height.",
        "Says out loud which lines fell under one strand instead of hiding them.",
      ],
      costs: [
        "Densest of the five; needs the width it is given.",
        "Rounding to whole strands is visible by design, which invites 'why 43 not 42.4'.",
        "One year only — the year strip would have to be added.",
      ],
      chart: <StrandSankey income={INCOME} spend={SPEND} />,
    },
  ];

  return (
    <main className="mx-auto max-w-[900px] px-6 pb-24">
      <header className="pt-14">
        <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-faint uppercase">
          Temporary · chart selection · delete this route once picked
        </p>
        <h1 className="mt-3 text-[38px] leading-[1.05] font-bold tracking-[-0.03em] text-ink">
          Five ways to draw a charity year
        </h1>
        <p className="mt-4 max-w-[62ch] text-[15px] leading-[1.6] text-dim">
          The same filed year in all five below — <strong className="font-semibold text-ink">
          The Garden Museum, year ended 31 March 2025</strong>: income £4,497,153
          across six lines, spending £4,191,442 across two, £305,711 kept. Option
          A is the component in the app right now and runs on the real
          <code className="mx-1 font-mono text-[13px]">buildFundFlows</code>
          pipeline; the rest are drawn from the same numbers. Pick one and I will
          port it.
        </p>
      </header>

      <div className="mt-14 space-y-14">
        {options.map((option) => (
          <section key={option.tag} className="border-t border-rule pt-10">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-mono text-[10px] font-bold tracking-[0.14em] text-ink uppercase">
                {option.tag}
              </span>
              <span className="font-mono text-[10px] font-semibold tracking-[0.14em] text-faint uppercase">
                {option.template}
              </span>
            </div>
            <h2 className="mt-2 text-[22px] font-bold tracking-[-0.02em] text-ink">
              {option.title}
            </h2>
            <p className="mt-2 max-w-[68ch] text-[14px] leading-[1.6] text-dim">
              {option.thesis}
            </p>

            <div className="mt-6 overflow-x-auto">
              <div className="min-w-[600px]">{option.chart}</div>
            </div>

            <div className="mt-7 grid gap-x-10 gap-y-6 sm:grid-cols-2">
              <div>
                <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-ink uppercase">
                  What it shows
                </p>
                <ul className="mt-2.5 space-y-2">
                  {option.shows.map((point) => (
                    <li key={point} className="text-[13.5px] leading-[1.55] text-ink">
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-faint uppercase">
                  What it costs
                </p>
                <ul className="mt-2.5 space-y-2">
                  {option.costs.map((point) => (
                    <li key={point} className="text-[13.5px] leading-[1.55] text-dim">
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
