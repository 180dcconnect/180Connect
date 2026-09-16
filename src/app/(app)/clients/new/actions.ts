"use server";

import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import {
  checkManualEntryCriteria,
  manualEntryDraftSchema,
  manualEntrySchema,
  reviewManualEntryFields,
} from "@/lib/manual-entry";
import { createClient } from "@/lib/supabase/server";
import { reportRescoreFailure, rescoreOrganisation } from "@/lib/scoring/rescore";
import { checkWebsiteReachability } from "@/lib/website-reachability";

// save_manual_entry and approve_manual_entry (supabase/migrations/20260817130000,
// 20260818100500) raise Postgres exceptions with a fixed message per case. Several
// share an errcode (22023), so the message — not the code — picks the user-facing
// copy. Anything not listed here falls back to a generic message.
const MANUAL_ENTRY_RPC_ERROR_MESSAGES: Record<string, string> = {
  "CAM or admin access required": "You don't have permission to add clients.",
  "admin access required": "Only an admin can do this.",
  "this draft is not available to edit": "This draft can no longer be edited — it may have been submitted or reviewed already.",
  "complete every required manual-entry field before submission": "Fill in every required field before submitting.",
  "personal email addresses are not permitted: contact_email must be a role address": "That contact email looks like a personal address. Use a role address (e.g. info@, contact@) — or, if it is the organisation's shared inbox rather than a person's, tick the confirmation above and try again.",
  "manual entry not found": "This entry could not be found. It may have been removed.",
  "choose whether this is a new or existing organisation": "Decide whether this is a new organisation or a match to an existing one before approving.",
  "confirm the organisation is eligible before approval": "Confirm the organisation is eligible before approving.",
  "explain why this matching organisation is genuinely separate": "Explain why this is a genuinely separate organisation from the match found.",
};

function manualEntryRpcErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("message" in error)) return null;
  const message = String((error as { message?: unknown }).message ?? "");
  for (const [key, friendly] of Object.entries(MANUAL_ENTRY_RPC_ERROR_MESSAGES)) {
    if (message.includes(key)) return friendly;
  }
  return null;
}

/**
 * Deletes one of the caller's own drafts — from the Drafts list, or "Clear all"
 * in the composer. discard_manual_entry_draft does the ownership and status
 * checks and writes the audit entry; a submitted or reviewed entry is never
 * deleted from here.
 *
 * `gone` means the row is not (or no longer) a draft this person can discard:
 * already deleted in another tab, or submitted since. Callers treat that as
 * done rather than as a failure — there is nothing left for them to delete.
 *
 * No revalidatePath: the caller refreshes when it is ready. The list's delete
 * button waits for its snap to finish, and "Clear all" re-keys the composer,
 * whose lists refresh on the way back to them.
 */
export async function deleteManualEntryDraft(
  entryId: string,
): Promise<{ ok: true; gone: boolean } | { ok: false; message: string }> {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/new" });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }
  if (!/^[0-9a-f-]{36}$/i.test(entryId)) {
    return { ok: false, message: "This draft could not be identified." };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("discard_manual_entry_draft", { p_entry_id: entryId });
    if (error) {
      if (error.message.includes("this draft is not available to discard")) {
        return { ok: true, gone: true };
      }
      throw error;
    }
  } catch (error) {
    const friendlyMessage = manualEntryRpcErrorMessage(error);
    if (friendlyMessage) return { ok: false, message: friendlyMessage };
    await reportError(error, {
      operation: "manual_entry.delete_draft",
      actorUserId: authorization.actor.id,
      manualEntryId: entryId,
    });
    return {
      ok: false,
      message: "The draft could not be deleted. The failure was recorded; please try again.",
    };
  }

  return { ok: true, gone: false };
}

export type ManualEntryState = {
  kind: "idle" | "success" | "warning" | "error";
  message: string;
  /**
   * The contact email was refused as personal. The form offers the shared-inbox
   * confirmation (20261003130000), which the next save records.
   */
  needsRoleConfirmation?: boolean;
  warnings?: string[];
  entryId?: string;
  organisationId?: string;
};

function manualEntryFormValues(formData: FormData) {
  return {
    legalName: String(formData.get("legalName") ?? ""),
    missionStatement: String(formData.get("missionStatement") ?? ""),
    organisationType: String(formData.get("organisationType") ?? ""),
    addressLine1: String(formData.get("addressLine1") ?? ""),
    city: String(formData.get("city") ?? ""),
    postcode: String(formData.get("postcode") ?? ""),
    countryCode: String(formData.get("countryCode") ?? ""),
    website: String(formData.get("website") ?? ""),
    contactEmail: String(formData.get("contactEmail") ?? ""),
    registryName: String(formData.get("registryName") ?? ""),
    registryNumber: String(formData.get("registryNumber") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    sector: String(formData.get("sector") ?? ""),
    geographicReach: String(formData.get("geographicReach") ?? ""),
    // Pound signs, commas and spaces are how people write money; the schema
    // wants the digits.
    latestIncome: String(formData.get("latestIncome") ?? "").replace(/[£,\s]/g, ""),
    accountsYearEnd: String(formData.get("accountsYearEnd") ?? ""),
    staffCount: String(formData.get("staffCount") ?? "").trim(),
    volunteerCount: String(formData.get("volunteerCount") ?? "").trim(),
  };
}

/**
 * Records which imported fields the CAM left alone (F037).
 *
 * Best-effort on purpose: the entry is already saved by the time this runs, and
 * failing the whole save because a provenance label could not be updated would cost
 * the CAM their work over a caption. The failure is reported, and the labels stay as
 * they were — which over-claims what came from the website, so it is worth seeing in
 * the logs rather than swallowing.
 */
async function narrowImportProvenance(
  supabase: Awaited<ReturnType<typeof createClient>>,
  formData: FormData,
  entryId: string,
  actorUserId: string,
): Promise<void> {
  const raw = formData.get("importedFieldPaths");
  if (typeof raw !== "string" || !raw) return;

  let paths: unknown;
  try {
    paths = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== "string")) return;

  const { error } = await supabase.rpc("set_url_import_provenance", {
    p_entry_id: entryId,
    p_imported_field_paths: paths,
  });
  if (error) {
    await reportError(error, {
      operation: "manual_entry.narrow_import_provenance",
      actorUserId,
      manualEntryId: entryId,
    });
  }
}

export async function saveManualEntry(
  _previous: ManualEntryState,
  formData: FormData,
): Promise<ManualEntryState> {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/new" });
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }

  const intent = formData.get("intent") === "draft" ? "draft" : "submit";
  const entryIdValue = String(formData.get("entryId") ?? "").trim();
  const entryId = entryIdValue || null;
  if (entryId && !/^[0-9a-f-]{36}$/i.test(entryId)) {
    return { kind: "error", message: "This draft could not be identified." };
  }

  const parsed = (intent === "draft" ? manualEntryDraftSchema : manualEntrySchema)
    .safeParse(manualEntryFormValues(formData));
  if (!parsed.success) {
    return {
      kind: "error",
      message: parsed.error.issues[0]?.message ?? "Check the form and try again.",
    };
  }

  try {
    let warnings: string[] = [];
    let storedEmail = parsed.data.contactEmail;
    let storedWebsite = parsed.data.website;

    if (intent === "submit") {
      const submission = manualEntrySchema.parse(parsed.data);
      const websiteStatus = await checkWebsiteReachability(submission.website);
      const fieldReview = reviewManualEntryFields(submission, websiteStatus);
      warnings = fieldReview.warnings;
      storedEmail = fieldReview.email.status === "valid"
        ? fieldReview.email.value
        : submission.contactEmail;
      storedWebsite = fieldReview.website.status === "valid" || fieldReview.website.status === "reachable"
        ? fieldReview.website.url
        : submission.website;

      if (authorization.actor.role === "admin") {
        const criteria = checkManualEntryCriteria({
          organisationType: submission.organisationType,
          countryCode: submission.countryCode,
          postcode: submission.postcode,
          adminConfirmedEligible: formData.get("adminConfirmedEligible") === "on",
        });
        if (criteria.status === "blocked") {
          return { kind: "error", message: criteria.message };
        }
      }
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("save_manual_entry", {
      p_entry_id: entryId,
      p_legal_name: parsed.data.legalName || null,
      p_mission_statement: parsed.data.missionStatement || null,
      p_organisation_type: parsed.data.organisationType || null,
      p_address_line_1: parsed.data.addressLine1 || null,
      p_city: parsed.data.city || null,
      p_postcode: parsed.data.postcode || null,
      p_country_code: parsed.data.countryCode || null,
      p_website: storedWebsite || null,
      p_contact_email: storedEmail || null,
      p_registry_name: parsed.data.registryName || null,
      p_registry_number: parsed.data.registryNumber || null,
      p_reason: parsed.data.reason || null,
      p_submit: intent === "submit",
      // Sector, reach and size (20261002090000) — all optional; blank is null.
      p_sector: parsed.data.sector || null,
      p_geographic_reach: parsed.data.geographicReach || null,
      p_latest_income: parsed.data.latestIncome ? Number(parsed.data.latestIncome) : null,
      p_accounts_year_end: parsed.data.accountsYearEnd || null,
      p_staff_count: parsed.data.staffCount ? Number(parsed.data.staffCount) : null,
      p_volunteer_count: parsed.data.volunteerCount ? Number(parsed.data.volunteerCount) : null,
      // F247 override (20261003130000): the submitter confirmed the address is a
      // shared organisation inbox. The RPC records who and when, binds it to this
      // exact address, and ignores it for an address that is not refused anyway.
      p_contact_email_role_confirmed: formData.get("contactEmailRoleConfirmed") === "on",
    });
    if (error) throw error;
    const savedEntryId = String(data);

    // F037 AC8: a value the CAM has retyped is theirs, not the website's, and the
    // review screen must stop labelling it as imported. Narrowing only — the RPC
    // intersects with what was already recorded, so a forged list cannot mark a
    // hand-typed field as coming from a website.
    await narrowImportProvenance(supabase, formData, savedEntryId, authorization.actor.id);

    if (intent === "draft") {
      // No revalidatePath here: the composer and the drafts list both live on
      // this route, and revalidating it mid-edit forces the whole client tree
      // (including this form) through a fresh server render — which resets
      // every uncontrolled field to its last-saved value, undoing whatever the
      // CAM typed since. A silent autosave doing that constantly while someone
      // types is the bug this comment exists to stop reintroducing. The
      // drafts list catches up next time this route is actually navigated to.
      return {
        kind: "success",
        message: "Draft saved. You can return and finish it later.",
        entryId: savedEntryId,
      };
    }

    revalidatePath("/clients/new");
    revalidatePath("/admin/manual-entries");
    if (authorization.actor.role !== "admin") {
      return {
        kind: "success",
        message: "Submitted for admin review. It is not an active client yet.",
        warnings,
        entryId: savedEntryId,
      };
    }

    const { data: organisationId, error: approvalError } = await supabase.rpc(
      "approve_manual_entry",
      {
        p_entry_id: savedEntryId,
        p_admin_confirmed_eligible: formData.get("adminConfirmedEligible") === "on",
        p_duplicate_decision: "create_new",
        p_candidate_organisation_id: null,
        p_notes: "Submitted and self-approved by admin",
      },
    );
    if (approvalError) {
      if (approvalError.code === "55000") {
        return {
          kind: "warning",
          message: "Saved, but a possible duplicate needs your decision in the manual-entry review queue.",
          warnings,
          entryId: savedEntryId,
        };
      }
      const friendlyApprovalMessage = manualEntryRpcErrorMessage(approvalError);
      if (friendlyApprovalMessage) {
        return {
          kind: "warning",
          message: `Saved, but automatic activation failed: ${friendlyApprovalMessage} Open the review queue to finish it.`,
          warnings,
          entryId: savedEntryId,
        };
      }
      await reportError(approvalError, {
        operation: "manual_entry.admin_self_approve",
        actorUserId: authorization.actor.id,
        manualEntryId: savedEntryId,
      });
      return {
        kind: "warning",
        message: "Saved for review, but automatic activation failed. The failure was recorded; open the review queue to finish it.",
        warnings,
        entryId: savedEntryId,
      };
    }

    const activeOrganisationId = String(organisationId);
    // F058/F059 — score the client as it becomes one, reading its now-persisted
    // row rather than the form snapshot. Best-effort: a missing service-role key
    // or a failed upsert leaves the client visibly "unscored" on the list (F058
    // AC3's explicit state) rather than failing the approval the admin just
    // made; the error is logged and the backfill sweeps it up.
    await reportRescoreFailure(
      await rescoreOrganisation(activeOrganisationId),
      "manual_entry.rescore_new_client",
      activeOrganisationId,
    );
    revalidatePath("/clients");
    revalidatePath(`/clients/${activeOrganisationId}`);
    return {
      kind: "success",
      message: "Client created and activated. No additional admin approval was required.",
      warnings,
      entryId: savedEntryId,
      organisationId: activeOrganisationId,
    };
  } catch (error) {
    const friendlyMessage = manualEntryRpcErrorMessage(error);
    if (friendlyMessage) {
      const refusedAsPersonal =
        error instanceof Object && "message" in error &&
        String(error.message).includes("personal email addresses are not permitted");
      return { kind: "error", message: friendlyMessage, needsRoleConfirmation: refusedAsPersonal };
    }
    await reportError(error, {
      operation: intent === "draft" ? "manual_entry.save_draft" : "manual_entry.submit",
      actorUserId: authorization.actor.id,
      manualEntryId: entryId ?? undefined,
    });
    return {
      kind: "error",
      message: "The manual entry could not be saved. The failure was recorded; please try again.",
    };
  }
}
