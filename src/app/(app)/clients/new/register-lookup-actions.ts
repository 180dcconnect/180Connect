"use server";

import { revalidatePath } from "next/cache";

import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createDefaultIngestionStore } from "@/lib/ingestion/store";
import {
  charityLabels,
  registerUnavailableReason,
  searchCharities,
  type RegisterCharityMatch,
} from "@/lib/charity-register/sqlite";
import { LABEL_KIND } from "@/lib/charity-register/sqlite-query";
import {
  companiesRegisterUnavailableReason,
  searchCompanies,
  type RegisterCompanyMatch,
} from "@/lib/companies-register/sqlite";
import { parseRegisterSearch } from "@/lib/register-search-term";
import { importCharityNumber } from "@/lib/charity-register/import";
import { importCompanyNumber } from "@/lib/companies-register/import";
import {
  promotePendingCharityCommissionBulkRecords,
  promotePendingCompaniesHouseRecords,
} from "@/lib/standardize/write-organisations";

/**
 * The register lookup behind "Add a client".
 *
 * ── Why this exists ──
 *
 * Every route into the client list before this one either talked to the network
 * or asked a person to type. `url-import-form.tsx` fetches a page and extracts
 * from it; `manual-entry-form.tsx` wants eleven fields by hand; the
 * Charity Commission lookup on `/admin/charity-commission` calls the live API
 * and needs `CHARITY_COMMISSION_API_KEY`. The register files were already in
 * the deployment — 171,800 charities with the register's own description of
 * each, plus the companies slice — and nothing could *find* anything in them.
 *
 * `lookupCharityProfile` parses digits out of its argument, so it can only
 * answer a question you already knew the number to. This is the direction that
 * was missing: type a name, get the registers' own answer, and file it.
 *
 * ── Why the result offers both prefill and import ──
 *
 * They are two genuinely different jobs and the CAM is the only one who knows
 * which they are doing. Picking the match fills the form, so it can be checked,
 * corrected and submitted through the ordinary manual-entry flow. Importing
 * runs it through the promote path instead, which is what brings the financial
 * periods, the identifiers, the sector and the first score with it — a
 * hand-typed record has none of those, and the record's own completeness strip
 * says so. Both are one click from the same card.
 *
 * ── Who may run these ──
 *
 * `client:edit`, the same gate `/clients/new` itself uses. Importing here writes
 * through the bulk promote path, which is the same ingest that
 * `/admin/charity-commission` performs for hundreds at a time — the difference
 * is the selection, not the permission.
 */

/** The shape the picker renders, whatever file it came from. */
export type RegisterMatch = {
  kind: "charity" | "company";
  /**
   * What the import action needs to find this record again: the organisation
   * number for a charity, the company number for a company. Never trusted as
   * the source of truth — both actions read the record back from the file.
   */
  key: string;
  name: string;
  /** Registration number, as the register prints it. */
  registryNumber: string | null;
  registryName: string;
  /** `charity_reporting_status` for a charity, `status_norm` for a company. */
  status: string | null;
  registeredOn: string | null;
  postcode: string | null;
  /** First address line, or the register's first populated one. */
  addressLine: string | null;
  town: string | null;
  website: string | null;
  contactEmail: string | null;
  /** The latest published income figure, or null when the register has none. */
  latestIncome: number | null;
  isCic: boolean;
  /** Regulator flags. False is a real answer; see the migration comment. */
  insolvent: boolean;
  inAdministration: boolean;
  /** The register's own classifications, in its own spelling. */
  classifications: string[];
  /** SIC code titles for a company, resolved from the register's own file. */
  sicTitles: string[];
  /**
   * Set when this organisation is already on the client list.
   *
   * The most common repeat case, and the one that must not read as an error:
   * importing again would dedup at the checksum and change nothing, so the card
   * offers the way to the record instead of a save that does nothing.
   */
  listedOrganisationId: string | null;
  /** What "use these details" fills the manual-entry form with. */
  prefill: {
    legalName: string;
    missionStatement: string;
    organisationType: string;
    addressLine1: string;
    city: string;
    postcode: string;
    countryCode: string;
    website: string;
    contactEmail: string;
    registryName: string;
    registryNumber: string;
  };
};

export type RegisterSearchState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | {
      kind: "done";
      matches: RegisterMatch[];
      /** What was typed. */
      query: string;
      /** How it was read — "charity number 1012345 or company number 01012345" — so the result can say it. */
      understood: string;
      /** Files that were missing, named, so "no match" is not read as "no such organisation". */
      unavailable: string[];
    };

/** First occurrence of each key, in order. */
function uniqueBy<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const value = key(row);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

const CHARITY_REGISTRY_NAME = "Charity Commission for England and Wales";
const COMPANY_REGISTRY_NAME = "Companies House";

/** How many candidates come back from each file. */
const MATCH_LIMIT = 6;

/**
 * The register prints a charity's address as a JSON array of lines with no
 * field saying which is the town — the last populated line is it, the same rule
 * `splitBulkAddress` applies on the import path. Duplicated here rather than
 * imported because that one reads the *payload* shape and this reads the file
 * column; they are two shapes and sharing the function would mean converting
 * one to the other for no gain.
 */
function splitAddressLines(raw: string | null): { line1: string | null; town: string | null } {
  if (!raw) return { line1: null, town: null };
  let lines: string[] = [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) lines = parsed.map(String).map((line) => line.trim()).filter(Boolean);
  } catch {
    // A malformed address costs this candidate its address, not the search.
    return { line1: null, town: null };
  }
  return { line1: lines[0] ?? null, town: lines.length > 1 ? lines[lines.length - 1] : null };
}

/**
 * The organisation type this record *is*.
 *
 * The register states these facts rather than inferring them: a CIO is a
 * charitable incorporated organisation, a CIC is a community interest company,
 * and a charity carrying a company number is both in the sense the client list
 * means it. "Charity" is the fallback for a plain registered charity.
 */
function charityOrganisationType(match: RegisterCharityMatch): string {
  if (match.isCio) return "cio";
  if (match.companyNumber) return "both";
  return "charity";
}

/**
 * Which of these registration numbers are already on the client list.
 *
 * Read through the caller's own session rather than the admin client: every
 * active user can select `organisation_identifiers`, and this is the record the
 * card links to, so it has to be one they can open.
 *
 * One query for both kinds of number rather than two, and a failure here
 * degrades to "not listed" rather than failing the search — the worst case is
 * being offered a save that dedups to nothing, which the import action then
 * reports honestly.
 */
async function findListedOrganisations(numbers: string[]): Promise<Map<string, string>> {
  const listed = new Map<string, string>();
  if (numbers.length === 0) return listed;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organisation_identifiers")
    .select("organisation_id, identifier_value")
    .in("identifier_value", numbers);

  if (error) {
    await reportError(error, { operation: "clients.register_lookup.listed" });
    return listed;
  }
  for (const row of data ?? []) listed.set(row.identifier_value, row.organisation_id);
  return listed;
}

function toCharityMatch(
  row: RegisterCharityMatch,
  listed: Map<string, string>,
): RegisterMatch {
  const { line1, town } = splitAddressLines(row.addressLines);
  const registryNumber = row.registeredCharityNumber === null ? null : String(row.registeredCharityNumber);

  return {
    kind: "charity",
    key: String(row.organisationNumber),
    name: row.charityName,
    registryNumber,
    registryName: CHARITY_REGISTRY_NAME,
    status: row.reportingStatus,
    registeredOn: row.dateOfRegistration,
    postcode: row.postcode,
    addressLine: line1,
    town,
    website: row.contactWebsite,
    contactEmail: row.contactEmail,
    latestIncome: row.latestIncome,
    isCic: false,
    insolvent: row.insolvent,
    inAdministration: row.inAdministration,
    classifications: row.classifications,
    sicTitles: [],
    listedOrganisationId: registryNumber ? (listed.get(registryNumber) ?? null) : null,
    prefill: {
      legalName: row.charityName,
      // The register's own words about what the charity does. Written into the
      // mission field because that is where a purpose belongs on this form, and
      // because it is the same text the bulk import files as the charity's
      // mission — so a client added through either route reads the same.
      missionStatement: row.activities ?? "",
      organisationType: charityOrganisationType(row),
      addressLine1: line1 ?? "",
      city: town ?? "",
      postcode: row.postcode ?? "",
      countryCode: "GB",
      website: row.contactWebsite ?? "",
      contactEmail: row.contactEmail ?? "",
      registryName: CHARITY_REGISTRY_NAME,
      registryNumber: registryNumber ?? "",
    },
  };
}

function toCompanyMatch(row: RegisterCompanyMatch, listed: Map<string, string>): RegisterMatch {
  const isCic = row.isCic;
  return {
    kind: "company",
    key: row.number,
    name: row.name,
    registryNumber: row.number,
    registryName: COMPANY_REGISTRY_NAME,
    status: row.statusNorm,
    registeredOn: row.incorpDate,
    postcode: row.postcode,
    addressLine: row.addressLine1,
    town: row.town,
    website: null,
    contactEmail: null,
    latestIncome: null,
    isCic,
    // Companies House publishes no solvency flag in the slice we hold. False is
    // the honest default for "nothing on this record says otherwise", and the
    // record's own banner only ever reads these for a charity.
    insolvent: false,
    inAdministration: false,
    classifications: [],
    sicTitles: row.sicCodes,
    listedOrganisationId: listed.get(row.number) ?? null,
    prefill: {
      legalName: row.name,
      missionStatement: "",
      organisationType: isCic ? "cic" : "company",
      addressLine1: row.addressLine1 ?? "",
      city: row.town ?? "",
      postcode: row.postcode ?? "",
      countryCode: "GB",
      website: "",
      contactEmail: "",
      registryName: COMPANY_REGISTRY_NAME,
      registryNumber: row.number,
    },
  };
}

/**
 * Searches both register files by name, postcode, or both.
 *
 * Both files are read every time rather than being guessed at from the shape of
 * the term: a CAM typing "Sheffield" has no idea which register their
 * organisation is in, and asking them to pick one first is asking them to know
 * the answer before they can find it.
 */
export async function searchRegister(
  _previous: RegisterSearchState,
  formData: FormData,
): Promise<RegisterSearchState> {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/new" });
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }

  const query = String(formData.get("q") ?? "").trim().slice(0, 120);
  const parsed = parseRegisterSearch(query);
  if (parsed.kind === "empty") {
    return { kind: "error", message: "Type at least two characters — a name, a number or a postcode." };
  }

  const unavailable: string[] = [];
  const charityFile = !registerUnavailableReason();
  const companyFile = !companiesRegisterUnavailableReason();
  if (!charityFile) unavailable.push("the charity register");
  if (!companyFile) unavailable.push("the companies register");

  try {
    let charities: RegisterCharityMatch[] = [];
    let companies: RegisterCompanyMatch[] = [];

    if (parsed.kind === "number") {
      // Exact lookups. 6–7 digits ask both files: the same digits are a charity
      // number and, zero-padded, a company number, and only the files know which.
      if (charityFile && parsed.charityNumber !== null) {
        charities = searchCharities({ registeredNumber: parsed.charityNumber }, MATCH_LIMIT);
      }
      if (companyFile && parsed.companyNumber) {
        companies = searchCompanies({ number: parsed.companyNumber }, MATCH_LIMIT);
      }
    } else {
      const narrowed = { name: parsed.name, postcode: parsed.postcode, town: parsed.town };
      // A place split off the end of a name is a guess ("Friends of Leeds"), so
      // the whole text is also searched as a name. The narrowed matches come
      // first: the person typed the place on purpose more often than not.
      // Only when the narrowed search came back short of a full page, though:
      // each search is a scan of the file, and a full page already has answers.
      const guessedPlace = Boolean(parsed.name && (parsed.postcode || parsed.town));
      if (charityFile) {
        const first = searchCharities(narrowed, MATCH_LIMIT);
        charities = uniqueBy(
          [
            ...first,
            ...(guessedPlace && first.length < MATCH_LIMIT ? searchCharities({ name: query }, MATCH_LIMIT) : []),
          ],
          (row) => String(row.organisationNumber),
        ).slice(0, MATCH_LIMIT);
      }
      if (companyFile) {
        const first = searchCompanies(narrowed, MATCH_LIMIT);
        companies = uniqueBy(
          [
            ...first,
            ...(guessedPlace && first.length < MATCH_LIMIT ? searchCompanies({ name: query }, MATCH_LIMIT) : []),
          ],
          (row) => row.number,
        ).slice(0, MATCH_LIMIT);
      }
    }

    const numbers = [
      ...charities
        .map((row) => row.registeredCharityNumber)
        .filter((value): value is number => value !== null)
        .map(String),
      ...companies.map((row) => row.number),
    ];
    const listed = await findListedOrganisations(numbers);

    return {
      kind: "done",
      query,
      understood: parsed.understood,
      unavailable,
      matches: [
        ...charities.map((row) => toCharityMatch(row, listed)),
        ...companies.map((row) => toCompanyMatch(row, listed)),
      ],
    };
  } catch (error) {
    await reportError(error, {
      operation: "clients.register_lookup.search",
      actorUserId: authorization.actor.id,
    });
    return {
      kind: "error",
      message: "The registers could not be searched. The failure was recorded — try again.",
    };
  }
}

export type RegisterImportState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "done"; message: string; organisationId: string | null };

/**
 * Files one register match as a client, through the ordinary promote path.
 *
 * Deliberately not a second write path. The record is copied out of the file
 * into `raw_source_records` exactly as a filter-driven import would, and then
 * the standardiser, the client-criteria check, duplicate detection, the
 * financial periods, the identifiers and the first score all run unchanged —
 * which is the whole reason a register match is worth more than a typed one.
 *
 * Only the key crosses back from the browser. The card that showed the match is
 * browser-rendered and therefore not evidence of anything, so the record is read
 * back from the file server-side.
 */
export async function importRegisterMatch(
  _previous: RegisterImportState,
  formData: FormData,
): Promise<RegisterImportState> {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/new" });
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }

  const kind = String(formData.get("kind") ?? "");
  const key = String(formData.get("key") ?? "").trim();

  if ((kind !== "charity" && kind !== "company") || key.length === 0) {
    return { kind: "error", message: "That match could not be identified. Search again." };
  }

  if (kind === "charity" && registerUnavailableReason()) {
    return {
      kind: "error",
      message:
        "The charity register is not loaded on this deployment, so there is nothing to import from.",
    };
  }
  if (kind === "company" && companiesRegisterUnavailableReason()) {
    return {
      kind: "error",
      message:
        "The companies register is not loaded on this deployment, so there is nothing to import from.",
    };
  }

  const supabase = createAdminClient();
  if (!supabase) {
    return { kind: "error", message: "The import is not configured on this environment." };
  }

  // The organisation number is what the file is keyed on; a charity match's
  // `key` is already that number, so no number parsing is needed.
  const organisationNumber = Number(key);
  if (kind === "charity" && !Number.isFinite(organisationNumber)) {
    return { kind: "error", message: "That match could not be identified. Search again." };
  }

  let runId: string | null = null;
  try {
    // F246/F247, fail-closed exactly as the ingestion runner and the bulk import
    // do: if the data-handling rules cannot be read, nothing is imported.
    const store = createDefaultIngestionStore();
    if (!store) throw new Error("Ingestion store is not configured.");
    const policy = await store.loadDataHandlingPolicy();

    const { data: run, error: runError } = await supabase
      .from("ingestion_runs")
      .insert({
        api_source: kind === "charity" ? "charity_commission_bulk" : "companies_house",
        triggered_by: "manual",
        triggered_by_user_id: authorization.actor.id,
        job_status: "running",
      })
      .select("id")
      .single();
    if (runError) throw runError;
    runId = run.id as string;

    const outcome =
      kind === "charity"
        ? await importCharityNumber(supabase, organisationNumber, runId, policy, (number) => ({
            // Read straight off the file, exactly as the bulk import's
            // `labelsForCharity` does. Passing empty lists here would strand the
            // charity on the scorer's neutral sector — the single largest thing
            // an import brings that a hand-typed record cannot.
            what: charityLabels(number, LABEL_KIND.what),
            areas: charityLabels(number, LABEL_KIND.localAuthority),
          }))
        : await importCompanyNumber(supabase, key, runId, policy);
    if ("error" in outcome) throw new Error(outcome.error);

    const promoted =
      kind === "charity"
        ? await promotePendingCharityCommissionBulkRecords()
        : await promotePendingCompaniesHouseRecords();

    await supabase
      .from("ingestion_runs")
      .update({
        job_status: "completed",
        completed_at: new Date().toISOString(),
        records_fetched: outcome.selected,
        records_inserted: outcome.written,
        records_skipped: outcome.unchanged,
        records_failed: 0,
        run_stats: {
          job: "register_lookup",
          selected: outcome.selected,
          written: outcome.written,
          unchanged: outcome.unchanged,
        },
      })
      .eq("id", runId);

    await supabase.from("audit_log").insert({
      actor_user_id: authorization.actor.id,
      action: "register_lookup_imported",
      target_table: "ingestion_runs",
      target_id: runId,
      detail: { kind, key, written: outcome.written, added: promoted.inserted },
    });

    revalidatePath("/clients/new");
    revalidatePath("/clients");

    if (promoted.inserted === 0) {
      // Not an error, and the most common repeat case: the checksum dedup means
      // an organisation already held is skipped rather than rewritten, and the
      // promote then has nothing to add.
      return {
        kind: "done",
        message:
          promoted.flagged > 0
            ? "That organisation is already on the client list — nothing was added."
            : "Nothing new to add — the register record matched one already held.",
        organisationId: null,
      };
    }

    return {
      kind: "done",
      message:
        promoted.needsReview > 0
          ? "Imported and held for review — it does not join the active list until an admin approves it."
          : "Added to the client list, with its filed accounts, identifiers and score.",
      organisationId: null,
    };
  } catch (error) {
    if (runId) {
      await supabase
        .from("ingestion_runs")
        .update({
          job_status: "failed",
          completed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : String(error),
        })
        .eq("id", runId);
    }
    await reportError(error, {
      operation: "clients.register_lookup.import",
      actorUserId: authorization.actor.id,
    });
    return {
      kind: "error",
      message: "The import failed. The failure was recorded — nothing partial was left behind.",
    };
  }
}
