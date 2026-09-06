"use server";

import { reportError } from "@/lib/error-logging";
import { getCurrentActor, actorFailureMessage } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { runIngestion } from "@/lib/ingestion/runner";
import { createCharityCommissionLookupAdapter } from "@/lib/ingestion/sources/charity-commission";
import { promotePendingCharityCommissionRecords } from "@/lib/standardize/write-organisations";
import {
  importStateFromSummary,
  describePromotion,
  lookupOutcome,
  type ListedCharity,
} from "./import-result";
import {
  createDefaultCharityPreviewDependencies,
  previewCharity,
  type CharityPreview,
} from "@/lib/import/charity-preview";

export type CharityCommissionImportState = {
  kind: "idle" | "success" | "warning" | "error";
  message: string;
  counts?: {
    fetched: number;
    written: number;
    skipped: number;
    failed: number;
  };
  promoted?: {
    inserted: number;
    needsReview: number;
    doesNotMeet: number;
    invalidData: number;
    failed: number;
  };
  /**
   * What happened to the one charity that was asked for, as opposed to the
   * batch counters above.
   *
   * The counters answer "how did the pipeline behave", which is the right
   * question for a bulk import and the wrong one for a lookup: somebody typed a
   * registration number because they want that charity, and nine integers do
   * not tell them whether they got it, which charity it was, or where it went.
   * Added alongside the counters rather than replacing them so the frozen
   * before/after page (../charity-commission-before) keeps rendering unchanged.
   *
   * Only ever set by `lookupCharity` — a bulk run has no single subject.
   */
  outcome?: CharityLookupOutcome;
};

/**
 * Step one's result: what the charity looks like, before anything is written.
 *
 * `alreadyListed` is the same resolution the commit step performs, run early so
 * the reader can be told "this is already yours, here it is" instead of being
 * offered a save that would do nothing.
 */
export type CharityPreviewState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | {
      kind: "preview";
      preview: CharityPreview;
      alreadyListed: ListedCharity | null;
    };

/** Whether the looked-up charity is on the client list, and how it got there. */
export type CharityLookupOutcome =
  | { kind: "added"; organisationId: string; name: string; grants: CharityGrantCoverage }
  | { kind: "already_listed"; organisationId: string; name: string; grants: CharityGrantCoverage }
  // Fetched and understood, but deliberately kept off the client list — the
  // charity exists, the import worked, and there is still nothing to open.
  | { kind: "held_for_review" }
  | { kind: "does_not_meet" }
  // Everything else: the number resolved to nothing usable.
  | { kind: "not_on_list" };

/**
 * Grant history for the charity, as it stands right now.
 *
 * Reported rather than fetched. The backfill queue is ordered
 * `grants_fetched_at asc, nullsFirst` (lib/ingestion/three-sixty-giving-backfill.ts)
 * and runs every 15 minutes, so a charity that has just been added sits at the
 * front of it — a third fetch trigger here would duplicate both that and the
 * Grant history section's own button on the client record, for a charity the
 * reader is one click away from anyway.
 */
export type CharityGrantCoverage =
  | { status: "queued" }
  | { status: "fetched"; count: number };

/**
 * The charity on the client list carrying this registration number, if any.
 *
 * Read through the caller's own session, not the admin client: both tables are
 * SELECT-able by any active user, and this is exactly the record the reader is
 * about to be linked to, so it must be one they can actually open.
 */
async function findListedCharity(registeredNumber: string): Promise<ListedCharity | null> {
  const supabase = await createClient();

  const { data: identifier, error: identifierError } = await supabase
    .from("organisation_identifiers")
    .select("organisation_id")
    .eq("identifier_type", "uk_charity")
    .eq("identifier_value", registeredNumber)
    .limit(1)
    .maybeSingle<{ organisation_id: string }>();
  if (identifierError || !identifier) return null;

  const [{ data: organisation }, { count }] = await Promise.all([
    supabase
      .from("organisations")
      .select("legal_name, grants_fetched_at")
      .eq("id", identifier.organisation_id)
      .maybeSingle<{ legal_name: string; grants_fetched_at: string | null }>(),
    supabase
      .from("grants")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", identifier.organisation_id),
  ]);
  if (!organisation) return null;

  return {
    organisationId: identifier.organisation_id,
    name: organisation.legal_name,
    grants: organisation.grants_fetched_at
      ? { status: "fetched", count: count ?? 0 }
      : { status: "queued" },
  };
}

/**
 * Ingest, then promote the whole pending backlog.
 *
 * The single-charity lookup is all that remains of the API path: bulk discovery
 * was retired once the staged register covered it (see
 * supabase/migrations/20260922110000_retire_charity_commission_discovery_cron.sql).
 * A named charity is the one case where hitting the API still beats the
 * snapshot — the answer is immediate and needs no refresh.
 */
async function withPromotion(
  ingestState: CharityCommissionImportState,
  actorUserId: string,
  operation: string,
): Promise<CharityCommissionImportState> {
  try {
    const promoteCounts = await promotePendingCharityCommissionRecords();
    return {
      ...ingestState,
      message: `${ingestState.message} ${describePromotion(promoteCounts)}`,
      promoted: {
        inserted: promoteCounts.inserted,
        needsReview: promoteCounts.needsReview,
        doesNotMeet: promoteCounts.doesNotMeet,
        invalidData: promoteCounts.invalidData,
        failed: promoteCounts.failed,
      },
    };
  } catch (promoteError) {
    await reportError(promoteError, { operation, actorUserId });
    return {
      ...ingestState,
      message: `${ingestState.message} The data was imported, but could not be promoted into the client list - it will be picked up on the next run.`,
    };
  }
}

/**
 * The registration number from a submitted form, or the reason it is unusable.
 *
 * Digits are checked here as well as inside the adapter's own
 * normalizeRegisteredNumber (which is what makes the fetch safe): rejecting the
 * obvious typo up front costs no API call and, on the commit step, no
 * ingestion_runs row for a value that cannot match anything.
 */
function readRegisteredNumber(
  formData: FormData,
): { ok: true; value: string } | { ok: false; message: string } {
  const value = String(formData.get("registeredNumber") ?? "").trim();
  if (!value) {
    return { ok: false, message: "Enter a Charity Commission registration number." };
  }
  if (!/^\d+$/.test(value)) {
    return {
      ok: false,
      message: "A Charity Commission registration number is digits only, for example 1218781.",
    };
  }
  return { ok: true, value };
}

/**
 * Step one of two: fetch the charity and show what importing it would do,
 * without importing it.
 *
 * Nothing here writes. The old single step fetched, staged and promoted a
 * charity onto the client list before its name had been on screen, so the first
 * chance to notice a mistyped digit was after an organisation existed for it.
 * A preview costs one API call and leaves no ingestion run, no raw record and
 * no audit trail for a charity nobody chose to keep.
 *
 * Same `client:edit` gate as the import: this reaches an external API on
 * somebody's behalf, and it reports whether a charity is already on the client
 * list, so it is not a public read.
 */
export async function previewCharityForImport(
  previous: CharityPreviewState,
  formData: FormData,
): Promise<CharityPreviewState> {
  void previous;

  const authorization = await getCurrentActor("client:edit");
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }

  const number = readRegisteredNumber(formData);
  if (!number.ok) return { kind: "error", message: number.message };

  const result = await previewCharity(
    number.value,
    createDefaultCharityPreviewDependencies(),
  );

  if (result.status === "not_found") {
    return {
      kind: "error",
      message: "No charity on the Charity Commission register has that registration number.",
    };
  }
  if (result.status === "unavailable") {
    // previewCharity never throws and has already reduced upstream detail to
    // something safe to show, so there is nothing to report here that it has
    // not already decided.
    return { kind: "error", message: result.message };
  }

  return {
    kind: "preview",
    preview: result.preview,
    // Resolved as part of the preview so the reader is told before they commit,
    // not after: importing a charity that is already on the list is a no-op
    // dressed up as an action.
    alreadyListed: await findListedCharity(result.preview.registeredNumber),
  };
}

/**
 * Step two of two: import the charity the reader has just reviewed.
 *
 * ── Why this re-fetches instead of taking the preview it was shown ──
 *
 * The preview is rendered in the browser, so the only thing the confirm step
 * can trust from it is the registration number — and even that is re-validated
 * and re-normalised here. Accepting a submitted payload would let anybody with
 * this form write an organisation of their choosing into the client list under
 * a real charity's number, which is a far worse trade than one extra call to an
 * API that answers in well under a second. The number is the request; the
 * register is still the source.
 *
 * The consequence, stated plainly because it is a real one: the record imported
 * is the register's answer *now*, not the frozen thing on screen. For a public
 * register that changes daily at most, a preview going stale mid-review is not
 * a case worth engineering against — and the outcome names the charity that was
 * actually written, so a divergence is visible rather than silent.
 *
 * client:edit, matching the rest of this screen: a CAM who can shape an import
 * can also look one charity up.
 */
export async function lookupCharity(
  previous: CharityCommissionImportState,
  formData: FormData,
): Promise<CharityCommissionImportState> {
  void previous;

  const authorization = await getCurrentActor("client:edit");
  if (!authorization.ok) {
    return {
      kind: "error",
      message: actorFailureMessage(authorization.reason),
    };
  }

  const number = readRegisteredNumber(formData);
  if (!number.ok) return { kind: "error", message: number.message };
  const registeredNumber = number.value;

  // Read before the run so "already on your list" can be told apart from
  // "just added". After the run this distinction is unrecoverable: the raw
  // record is deduped by checksum and promotion flags it as a duplicate, both
  // of which look identical to a charity that was never there.
  const listedBefore = await findListedCharity(registeredNumber);

  try {
    const [summary] = await runIngestion(
      [createCharityCommissionLookupAdapter({ registeredNumber })],
      {
        triggeredBy: "manual",
        triggeredByUserId: authorization.actor.id,
      },
    );

    if (summary.status === "failed") {
      await reportError(new Error(summary.error ?? "Charity Commission lookup failed"), {
        operation: "admin.charity_commission.lookup",
        source: summary.source,
        actorUserId: authorization.actor.id,
      });
      return importStateFromSummary(summary);
    }

    const promotedState = await withPromotion(
      importStateFromSummary(summary),
      authorization.actor.id,
      "admin.charity_commission.promote",
    );

    return {
      ...promotedState,
      outcome: lookupOutcome(
        listedBefore,
        await findListedCharity(registeredNumber),
        promotedState.promoted,
      ),
    };
  } catch (error) {
    await reportError(error, {
      operation: "admin.charity_commission.lookup",
      actorUserId: authorization.actor.id,
    });
    return {
      kind: "error",
      message:
        "Charity Commission could not be imported. The failure was recorded; please try again later.",
    };
  }
}