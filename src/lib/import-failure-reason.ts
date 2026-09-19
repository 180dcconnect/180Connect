/**
 * What to tell a non-technical admin when an import staged register rows but
 * could not turn them into clients.
 *
 * Every promotion path (`src/lib/standardize/write-organisations.ts`) already
 * counted these failures, but the count was the whole message: Import Status
 * said "311 failed to save — ask a developer to take a look" and nobody,
 * developer included, could tell from the screen what had gone wrong. The
 * reason was sitting in the database error the promote step threw away.
 *
 * This module keeps the raw message (developers need it) and puts a sentence
 * in front of it that says what happened and what the reader can do about it,
 * in the words of the job — no column names, no enum labels, no SQLSTATE. It
 * is the same contract as `humaniseErrorMessage` in the Import Status page,
 * which handles whole-run failures; this one handles per-record save failures,
 * and the page reads both through the same shape.
 *
 * Pure and node-testable: no imports, no I/O.
 */

export type ImportFailureReason = {
  /** One line, safe to put on a collapsed row. */
  summary: string;
  /** A sentence or two of what it means. */
  description: string;
  /** What the reader should do next. Always present — a dead end is a bug. */
  actionHint: string;
  /** The untranslated database/API message, for the developer who asks. */
  rawMessage: string;
  /**
   * Whether re-running the import on its own can fix this. False means the
   * environment needs a change first, and re-running only repeats the failure
   * — the screen says so rather than inviting a pointless retry.
   */
  retryable: boolean;
};

type Rule = {
  match: RegExp;
  build: (raw: string) => Omit<ImportFailureReason, "rawMessage">;
};

/**
 * Order matters: the first rule that matches wins, so the specific shapes sit
 * above the general ones. Each `match` is tested against the raw message only
 * — never against anything a reader typed.
 */
const RULES: Rule[] = [
  {
    // The failure that broke every register import on staging and production:
    // the promote function still coalesced to a pipeline status the database
    // stopped recognising, so every save raised before writing a row.
    // See supabase/migrations/20261018150000_fix_link_rpc_outreach_status_default.sql.
    match: /invalid input value for enum|invalid input syntax for type/i,
    build: () => ({
      summary: "The client list rejected every record — this environment needs a database update",
      description:
        "The import sent each charity to the client list, and the list refused all of them because one of the values it expects has changed. Nothing was added and nothing was damaged: the records are held, not lost.",
      actionHint:
        "This cannot be fixed by running the import again. Ask a developer to install the pending database updates on this environment, then run the import once more.",
      retryable: false,
    }),
  },
  {
    // PostgREST cannot see the function/column the code calls: same class of
    // problem as the enum above — the code is ahead of this environment.
    match: /PGRST(202|204)|could not find the (function|table|column)|does not exist/i,
    build: () => ({
      summary: "This environment is missing a database update the import needs",
      description:
        "Part of the import needs a database change that has not been installed here yet, so none of the records could be saved to the client list.",
      actionHint:
        "Running the import again will not help. Ask a developer to install the pending database updates on this environment first.",
      retryable: false,
    }),
  },
  {
    match: /row-level security|permission denied|insufficient privilege|42501/i,
    build: () => ({
      summary: "The import was not allowed to add clients here",
      description:
        "The client list refused the records because the import does not have permission to add clients on this environment.",
      actionHint:
        "Ask a developer to check the import's access on this environment. Running it again as a different person will not change the result.",
      retryable: false,
    }),
  },
  {
    match: /null value in column|not-null constraint|violates check constraint/i,
    build: () => ({
      summary: "Some records were missing details every client must have",
      description:
        "The register rows reached the client list but were turned away because a detail the list always requires was blank or outside the range it accepts.",
      actionHint:
        "Try a narrower import — the affected register rows are held, not lost. If a whole import fails this way, ask a developer to look at the register file.",
      retryable: true,
    }),
  },
  {
    match: /duplicate key value|unique constraint/i,
    build: () => ({
      summary: "Some records clashed with clients already on the list",
      description:
        "The client list already holds a client with the same identifying details, so these records were not added a second time.",
      actionHint:
        "No action needed for most imports. If you expected these as new clients, open the review queue and check whether they were matched to an existing client.",
      retryable: true,
    }),
  },
  {
    match: /deadlock|could not serialize|lock timeout|55P03/i,
    build: () => ({
      summary: "The client list was busy and turned the records away",
      description:
        "Another job was writing to the client list at the same time, so these records could not be saved.",
      actionHint: "Run the import again in a few minutes. The records are held until then.",
      retryable: true,
    }),
  },
  {
    match: /ETIMEDOUT|ECONNREFUSED|ENOTFOUND|fetch failed|timeout|statement timeout|57014/i,
    build: () => ({
      summary: "The import lost its connection part-way through saving",
      description:
        "The connection to the database dropped or took too long while the records were being saved, so the rest were left unsaved.",
      actionHint:
        "Run the import again. If it stops in the same place twice, try a smaller import and tell a developer.",
      retryable: true,
    }),
  },
];

/**
 * Translate one raw save failure. Returns null for nothing to translate, so a
 * caller can treat "no reason recorded" and "reason recorded" the same way.
 */
export function describeImportFailure(rawMessage: string | null | undefined): ImportFailureReason | null {
  if (!rawMessage || !rawMessage.trim()) return null;
  const raw = rawMessage.trim();

  for (const rule of RULES) {
    if (rule.match.test(raw)) return { ...rule.build(raw), rawMessage: raw };
  }

  // Unknown shape. The reader still gets a usable sentence and a next step —
  // what they must never get is the database's own words as the whole message.
  return {
    summary: "Some records could not be saved to the client list",
    description:
      "The client list refused these records for a reason the app does not recognise. They are held, not lost, and nothing already on the list was changed.",
    actionHint:
      "Try the import again. If the same thing happens, show a developer the technical details below.",
    rawMessage: raw,
    retryable: true,
  };
}

/**
 * The sentence for a run where some or all records failed to save, given how
 * many failed and how many made it. Kept here rather than in the page so the
 * import screen and Import Status say the same thing about the same run.
 */
export function summariseImportFailure(
  failed: number,
  added: number,
  reason: ImportFailureReason | null,
): string {
  const count = failed.toLocaleString();
  const noun = failed === 1 ? "record" : "records";
  const head =
    added === 0
      ? `Nothing was added to the client list — all ${count} ${noun} were refused`
      : `${count} ${noun} could not be saved to the client list`;
  return reason ? `${head}. ${reason.description} ${reason.actionHint}` : `${head}.`;
}

/**
 * The clause an import screen puts in its result line for the records that
 * could not be saved. Short enough to sit in a comma-separated summary, and it
 * names the reason rather than sending the reader off to find a developer with
 * nothing to hand them.
 */
export function failureNote(failed: number, reasons: readonly string[] = []): string {
  const count = failed.toLocaleString();
  const noun = failed === 1 ? "record" : "records";
  const reason = describeImportFailure(reasons[0] ?? null);
  if (!reason) return `${count} ${noun} could not be saved to the client list`;
  return `${count} ${noun} could not be saved — ${lowerFirst(reason.summary)}`;
}

/** Sentence-cased summaries read wrong mid-clause; acronyms keep their case. */
function lowerFirst(text: string): string {
  if (text.length < 2) return text.toLowerCase();
  return /^[A-Z]{2}/.test(text) ? text : text[0].toLowerCase() + text.slice(1);
}
