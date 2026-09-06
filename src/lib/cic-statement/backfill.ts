import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { applyDataHandling, type DataHandlingPolicy } from "../ingestion/apply-data-handling.ts";
import { companiesRegisterUnavailableReason, isRegisteredCic } from "../companies-register/sqlite.ts";
import { extractStatement, formatStatement } from "./extract-statement.ts";
import { fetchCicIncorporationFiling } from "./filing.ts";
import { scannedPagesFromEnd } from "./page-images.ts";
import { startOcr, type OcrSession } from "./ocr.ts";

/**
 * Filling in ORGANISATIONS.cic_community_statement, one company at a time.
 *
 * The same shape as src/lib/charity-register/profile-backfill.ts — find the
 * organisations a source can still say something about, write the next `limit`
 * of them, report what is left — but with one difference that drives the whole
 * design: this job is expensive. Each company costs two API calls, a 1.2MB
 * download and several seconds of OCR, where the register backfill costs a local
 * SQLite read and one update.
 *
 * That is why `cic_statement_checked_at` exists and why it is set on *every*
 * attempt including the ones that find nothing. Without it, the several hundred
 * ordinary companies with no CIC36 would be re-fetched on every run for ever,
 * and the queue would never drain.
 *
 * ── Personal data ──
 *
 * A CIC incorporation filing carries director names, dates of birth, service
 * addresses and an email address. None of it is stored:
 *
 *   1. The PDF is never written to disk. It exists as bytes for as long as OCR
 *      takes and is then dropped.
 *   2. Only pages that look like the CIC36 statement are read at all, and only
 *      the two statement boxes are taken from them — never the page.
 *   3. What survives that goes through applyDataHandling before any write, so
 *      the global redact_email rule catches an address a company typed into its
 *      own statement.
 *
 * The residual risk is a director naming themselves in their own statement.
 * That is the NER boundary docs/personal-data-exclusions.md already documents
 * and accepts; this job inherits it deliberately rather than by omission.
 */

/** Organisations one press may write. As with the register backfill, the cap is
 *  about a single invocation's time budget rather than about the data. Far
 *  lower here because one organisation costs seconds, not milliseconds. */
export const MAX_BACKFILL = 200;
export const DEFAULT_BACKFILL = 25;

/**
 * How many pages from the back of the filing to read.
 *
 * The CIC36 sat fourth to sixth from the end across every filing sampled, so
 * this is that observation plus headroom for a longer articles section. It is
 * also the main cost lever: every page here is one OCR pass, and reading the
 * whole document would be twenty-five.
 */
const PAGES_TO_SCAN = 8;

/**
 * Companies to read before replacing the Tesseract worker.
 *
 * tesseract.js keeps its own WASM heap, and `recognize` grows it: at eight
 * pages a company, a few hundred companies on one worker is a few thousand
 * page recognitions into a heap that is never handed back. Two staging runs
 * were killed for memory — the second after only 75 companies, which is what
 * ruled out the pdf.js side as the whole story.
 *
 * Restarting costs about a second (the language data is already on disk), so
 * this is cheap next to the ~5s a company already takes.
 */
const RECYCLE_OCR_EVERY = 25;

/** The source name for data-handling rules and run records. This job reads a
 *  Companies House document with Companies House credentials; it is not a new
 *  source, and inventing one would need a DATA_SOURCES migration to say
 *  nothing new. */
const SOURCE = "companies_house";

export type CicBackfillTarget = {
  organisationId: string;
  companyNumber: string;
};

export type CicBackfillCoverage = {
  /** Companies on the client list carrying a company number. */
  companies: number;
  /** Of those, how many have already been asked about. */
  checked: number;
  /** …and how many of those actually yielded a statement. */
  withStatement: number;
  /** Still queued. */
  pending: number;
};

export type CicBackfillOutcome = {
  /** Organisations attempted on this run. */
  attempted: number;
  /** Of those, how many gained a statement. */
  written: number;
  /** Attempted, found to have no CIC36, and marked so they are not retried. */
  notCic: number;
  /** Attempted and failed in a way that leaves them queued for another run. */
  failed: number;
  /** Organisations still pending after this run. */
  remaining: number;
};

type OrganisationRow = {
  id: string;
  cic_community_statement: string | null;
  cic_statement_checked_at: string | null;
};

type IdentifierRow = { organisation_id: string; identifier_value: string };

/** Rows per read — below PostgREST's own cap so the last page is always short,
 *  which is what ends the loop. Same reasoning as the register backfill. */
const READ_PAGE = 900;
const ID_FILTER_CHUNK = 200;

async function readAll<Row>(
  build: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await build(from, from + READ_PAGE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < READ_PAGE) return rows;
  }
}

/**
 * Companies that have not been asked about yet.
 *
 * Ordered by company number so a capped run is stable and repeatable: the same
 * press twice in a row works through the queue rather than re-rolling which
 * quarter of it to attempt.
 *
 * Non-CICs are skipped up front where the register file can say so — it holds
 * `is_cic` for every company it kept, and skipping is free where a wasted
 * attempt is two API calls. A company the file does not know is still
 * attempted: the file keeps a filtered ~12% of the register, so absence from it
 * is not evidence of anything.
 */
export async function findCicTargets(
  supabase: SupabaseClient,
): Promise<{ targets: CicBackfillTarget[]; coverage: CicBackfillCoverage }> {
  const identifiers = await readAll<IdentifierRow>((from, to) =>
    supabase
      .from("organisation_identifiers")
      .select("organisation_id, identifier_value")
      .eq("identifier_type", "uk_company")
      .order("identifier_value", { ascending: true })
      .range(from, to)
      .returns<IdentifierRow[]>(),
  );

  const companies = identifiers.filter(
    (row) => row.organisation_id && row.identifier_value?.trim(),
  );
  if (companies.length === 0) {
    return {
      targets: [],
      coverage: { companies: 0, checked: 0, withStatement: 0, pending: 0 },
    };
  }

  const stored = new Map<string, OrganisationRow>();
  const ids = companies.map((row) => row.organisation_id);
  for (let i = 0; i < ids.length; i += ID_FILTER_CHUNK) {
    const slice = ids.slice(i, i + ID_FILTER_CHUNK);
    const page = await readAll<OrganisationRow>((from, to) =>
      supabase
        .from("organisations")
        .select("id, cic_community_statement, cic_statement_checked_at")
        .in("id", slice)
        .order("id", { ascending: true })
        .range(from, to)
        .returns<OrganisationRow[]>(),
    );
    for (const row of page) stored.set(row.id, row);
  }

  // Only consult the register file when it is actually loaded; without it every
  // company is simply attempted, which is correct but slower.
  const registerLoaded = companiesRegisterUnavailableReason() === null;

  const targets: CicBackfillTarget[] = [];
  let checked = 0;
  let withStatement = 0;

  for (const { organisation_id, identifier_value } of companies) {
    const row = stored.get(organisation_id);
    if (!row) continue;

    if (row.cic_statement_checked_at !== null) {
      checked++;
      if (row.cic_community_statement) withStatement++;
      continue;
    }

    if (registerLoaded && isRegisteredCic(identifier_value) === false) continue;

    targets.push({ organisationId: organisation_id, companyNumber: identifier_value });
  }

  return {
    targets,
    coverage: {
      companies: companies.length,
      checked,
      withStatement,
      pending: targets.length,
    },
  };
}

/** One company: fetch, read, extract. Exported for the script's verbose mode. */
export async function readStatementForCompany(
  companyNumber: string,
  ocr: OcrSession,
): Promise<
  | { kind: "statement"; text: string; confidence: number }
  | { kind: "no-statement" }
  | { kind: "not-a-cic" }
  | { kind: "error"; message: string }
> {
  const filing = await fetchCicIncorporationFiling(companyNumber);
  if (filing.kind === "not-a-cic" || filing.kind === "unknown-company") {
    return { kind: "not-a-cic" };
  }
  if (filing.kind === "error") return { kind: "error", message: filing.message };

  try {
    const images = await scannedPagesFromEnd(filing.pdf, PAGES_TO_SCAN);
    const pages = [];
    for (const image of images) {
      pages.push({ page: await ocr.recognise(image.png), width: image.width });
    }

    const statement = extractStatement(pages);
    const text = formatStatement(statement);
    return text === null
      ? { kind: "no-statement" }
      : { kind: "statement", text, confidence: statement.confidence };
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Writes the next `limit` companies' statements.
 *
 * Sequential, like the register backfill and for the same reason plus a
 * stronger one: this competes with live traffic on ORGANISATIONS, and it spends
 * a shared Companies House rate limit that the import adapter also draws on.
 * Parallelising would earn 429s rather than throughput.
 *
 * A failure is recorded and the walk continues — `cic_statement_checked_at` is
 * deliberately *not* set for a failure, so a company that hit a network error
 * stays queued for the next run. Only a definite answer, including "this is not
 * a CIC", closes a company off.
 */
export async function runCicBackfill(
  supabase: SupabaseClient,
  limit: number,
  policy: DataHandlingPolicy,
  onProgress?: (done: number, total: number, companyNumber: string) => void,
): Promise<CicBackfillOutcome> {
  const { targets } = await findCicTargets(supabase);
  const slice = targets.slice(0, Math.max(0, limit));
  if (slice.length === 0) {
    return { attempted: 0, written: 0, notCic: 0, failed: 0, remaining: targets.length };
  }

  let ocr = await startOcr();
  let written = 0;
  let notCic = 0;
  let failed = 0;

  try {
    for (const [index, target] of slice.entries()) {
      onProgress?.(index + 1, slice.length, target.companyNumber);

      // Replaced rather than reused past this point. Closing before opening
      // the replacement keeps only one worker alive at a time.
      if (index > 0 && index % RECYCLE_OCR_EVERY === 0) {
        await ocr.close();
        ocr = await startOcr();
      }

      const result = await readStatementForCompany(target.companyNumber, ocr);

      if (result.kind === "error") {
        failed++;
        // No cursor write: a transient failure must leave the company queued,
        // or one bad afternoon would permanently exclude it.
        continue;
      }

      const patch: Record<string, string | null> = {
        cic_statement_checked_at: new Date().toISOString(),
      };

      if (result.kind === "statement") {
        // The single clearing point every writer goes through. The statement is
        // externally authored text from a document full of personal data, and
        // it must not reach the table before the active rules have seen it.
        const cleared = applyDataHandling({ statement: result.text }, SOURCE, policy);
        const text = (cleared.payload as { statement?: unknown }).statement;
        if (typeof text === "string" && text.trim().length > 0) {
          patch.cic_community_statement = text;
          written++;
        }
      } else if (result.kind === "not-a-cic") {
        notCic++;
      }

      const { error } = await supabase
        .from("organisations")
        .update(patch)
        .eq("id", target.organisationId);
      if (error) throw error;
    }
  } finally {
    // In a finally, not after the loop: an un-terminated Tesseract worker keeps
    // the process alive, which turns a script that threw into one that hangs.
    await ocr.close();
  }

  return {
    attempted: slice.length,
    written,
    notCic,
    failed,
    remaining: targets.length - slice.length + failed,
  };
}
