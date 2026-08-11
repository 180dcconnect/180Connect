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
import { checkWebsiteReachability } from "@/lib/website-reachability";

export type ManualEntryState = {
  kind: "idle" | "success" | "warning" | "error";
  message: string;
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
  };
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
    });
    if (error) throw error;
    const savedEntryId = String(data);

    revalidatePath("/clients/new");
    if (intent === "draft") {
      return {
        kind: "success",
        message: "Draft saved. You can return and finish it later.",
        entryId: savedEntryId,
      };
    }

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
