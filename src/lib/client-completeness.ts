/**
 * What this record actually holds — the tick strip in the record header.
 *
 * Every other verdict in the header (the dial, the stage pill, the provenance
 * line) assumes the record is a fair description of the organisation. This one
 * says how much of it there is, because a blank on this page does not tell a
 * CAM whether nothing was filed or nothing was fetched.
 *
 * Four signals, no more. The strip sits in an already-dense header and its job
 * is to be read in one glance, not audited — past about four chips it stops
 * being a shape you recognise and becomes a list you have to read.
 *
 * The four are the depth of the *dossier*: who the organisation is on paper,
 * and the three layers of what is known about how it runs. Coverage measured
 * on staging (2,738 non-seed organisations, Sept 2026):
 *
 *   registration  1,918 / 2,738   70%   ORGANISATION_IDENTIFIERS
 *   accounts        795 / 2,738   29%   FINANCIAL_PERIODS
 *   headcount       355 / 2,738   13%   FINANCIAL_PERIODS.count_employees
 *   grants          105 / 2,738    4%   GRANTS
 *
 * Headcount and grants nest inside accounts rather than sitting beside it —
 * a record with a headcount always has a filing — so the strip lights up left
 * to right as the dossier deepens, which is the thing worth seeing at a glance.
 *
 * Deliberately not ticks. Contact email (71%), website (46%) and sector (43%)
 * all vary usefully but describe how reachable the organisation is, not how
 * much is known about it — they belong to a contactability question, not this
 * one. Postcode, address and the priority score are on ~100% of records, and a
 * tick that is always lit is decoration. `sub_sector`, `geographic_reach`,
 * `contacts` and `attachments` are on 0% — a tick that is never lit is noise
 * until the pipeline fills them. `count_volunteers` looks like a signal and is
 * not: it is non-null on every one of the 795 records that has any filing at
 * all, so it only ever restates the accounts tick.
 *
 * Outreach history is not a tick either, and that is the line this strip draws.
 * The four above are facts about the organisation that arrived from a register.
 * Whether we have emailed them is a fact about *us* — it changes when a CAM
 * acts, not when the world does, and the header already carries it twice (the
 * stage control and the last-contacted chip). Mixing the two would make the
 * strip mean "how much do we have and also what have we done", which is not a
 * question anyone asks in one glance.
 *
 * This is not the score's coverage line. That one says how much of the *score*
 * is evidence rather than the engine's 0.5 padding; this says what a human
 * would find on the record if they went looking.
 */

export type CompletenessKey = "registration" | "accounts" | "headcount" | "grants";

export type CompletenessItem = {
  key: CompletenessKey;
  /** Chip text. Same whether held or not — the state is the tick's job. */
  label: string;
  present: boolean;
  /** Hover text. Says what is held, or what is absent and what that costs. */
  detail: string;
};

export type CompletenessInput = {
  /** Rows in ORGANISATION_IDENTIFIERS — charity and company numbers. */
  identifierCount: number;
  /** Rows in FINANCIAL_PERIODS. */
  filingCount: number;
  /** Filed periods that state an employee count. Always <= filingCount. */
  headcountFilingCount: number;
  /** Rows in GRANTS. */
  grantCount: number;
};

export type CompletenessResult = {
  items: CompletenessItem[];
  /** How many of the four are held. */
  present: number;
  total: number;
};

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

export function buildCompleteness(input: CompletenessInput): CompletenessResult {
  const items: CompletenessItem[] = [
    {
      key: "registration",
      label: "Registration no.",
      present: input.identifierCount > 0,
      detail:
        input.identifierCount > 0
          ? `${plural(input.identifierCount, "registration number", "registration numbers")} on file`
          : "No charity or company number — nothing ties this record back to a register",
    },
    {
      key: "accounts",
      label: "Filed accounts",
      present: input.filingCount > 0,
      detail:
        input.filingCount > 0
          ? `${plural(input.filingCount, "filed period", "filed periods")} of accounts`
          : "No filed accounts — income and financial scale are unknown",
    },
    {
      key: "headcount",
      label: "Headcount",
      present: input.headcountFilingCount > 0,
      detail:
        input.headcountFilingCount > 0
          ? `Staff numbers stated in ${plural(input.headcountFilingCount, "filed period", "filed periods")}`
          : "No staff numbers filed — the size of the organisation is unknown",
    },
    {
      key: "grants",
      label: "Grant history",
      present: input.grantCount > 0,
      detail:
        input.grantCount > 0
          ? `${plural(input.grantCount, "grant", "grants")} recorded`
          : "No grants found — no record of who has funded this organisation",
    },
  ];

  return {
    items,
    present: items.filter((item) => item.present).length,
    total: items.length,
  };
}
