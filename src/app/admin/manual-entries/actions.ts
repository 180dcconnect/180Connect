"use server";

import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { findDuplicateMatch } from "@/lib/dedup/match-organisations";
import { reportError } from "@/lib/error-logging";
import {
  checkManualEntryCriteria,
  manualEntrySchema,
  reviewManualEntryFields,
} from "@/lib/manual-entry";
import { createClient } from "@/lib/supabase/server";
import { checkWebsiteReachability } from "@/lib/website-reachability";

export type ManualEntryCheck = {
  label: string;
  status: "passed" | "warning" | "blocked";
  message: string;
};

export type ManualEntryApprovalContext = {
  organisationType: "charity" | "company" | "both" | "other";
  adminConfirmedEligible: boolean;
  candidateOrganisationId: string | null;
  candidateOrganisationName: string | null;
  matchedOn: "registration_number" | "name_and_postcode" | null;
};

export type ManualEntryReviewState = {
  kind: "idle" | "checked" | "success" | "error";
  message: string;
  checks?: ManualEntryCheck[];
  approval?: ManualEntryApprovalContext;
};

type ManualEntryRow = {
  legal_name: string;
  country_code: string;
  website: string | null;
  contact_email: string | null;
  registry_name: string | null;
  registry_number: string | null;
  reason_for_manual_entry: string;
  review_status: string;
};

type ExistingOrganisationRow = {
  id: string;
  legal_name: string;
  postcode: string | null;
};

type IdentifierRow = {
  organisation_id: string;
  identifier_value: string;
};

const organisationTypes = ["charity", "company", "both", "other"] as const;

function isOrganisationType(value: string): value is ManualEntryApprovalContext["organisationType"] {
  return organisationTypes.some((organisationType) => organisationType === value);
}

function safeApprovalFailure(error: { code?: string; message?: string }): string {
  if (["22023", "42501", "55000", "P0002"].includes(error.code ?? "") && error.message?.trim()) {
    return error.message;
  }
  return "The manual entry could not be approved. The failure was recorded; refresh and try again.";
}

export async function checkAvailableManualEntryDependencies(
  _previous: ManualEntryReviewState,
  formData: FormData,
): Promise<ManualEntryReviewState> {
  const authorization = await getCurrentActor("approval:manage", { route: "/admin/manual-entries" });
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }

  const id = String(formData.get("id") ?? "");
  const organisationType = String(formData.get("organisationType") ?? "").trim();
  const adminConfirmedEligible = formData.get("adminConfirmedEligible") === "on";
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return { kind: "error", message: "This manual entry could not be identified." };
  }
  if (!isOrganisationType(organisationType)) {
    return { kind: "error", message: "Choose an organisation type before running the checks." };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("manual_entry_records")
      .select("legal_name, country_code, website, contact_email, registry_name, registry_number, reason_for_manual_entry, review_status")
      .eq("id", id)
      .single();
    if (error) throw error;
    const entry = data as ManualEntryRow;
    if (entry.review_status !== "pending") {
      return { kind: "error", message: "This manual entry has already been reviewed." };
    }

    const parsed = manualEntrySchema.safeParse({
      legalName: entry.legal_name,
      countryCode: entry.country_code,
      website: entry.website ?? "",
      contactEmail: entry.contact_email ?? "",
      registryName: entry.registry_name ?? "",
      registryNumber: entry.registry_number ?? "",
      reason: entry.reason_for_manual_entry,
    });
    if (!parsed.success) {
      await reportError(parsed.error, {
        operation: "manual_entry.review_standard_fields",
        actorUserId: authorization.actor.id,
        manualEntryId: id,
      });
      return {
        kind: "error",
        message: "This submission has invalid standard fields. The failure was recorded for investigation.",
      };
    }

    const websitePromise = checkWebsiteReachability(parsed.data.website);
    const organisationRows: ExistingOrganisationRow[] = [];
    const identifierRows: IdentifierRow[] = [];
    const pageSize = 1_000;
    for (let from = 0; ; from += pageSize) {
      const result = await supabase
        .from("organisations")
        .select("id, legal_name, postcode")
        .range(from, from + pageSize - 1);
      if (result.error) throw result.error;
      const page = (result.data ?? []) as ExistingOrganisationRow[];
      organisationRows.push(...page);
      if (page.length < pageSize) break;
    }
    for (let from = 0; ; from += pageSize) {
      const result = await supabase
        .from("organisation_identifiers")
        .select("organisation_id, identifier_value")
        .range(from, from + pageSize - 1);
      if (result.error) throw result.error;
      const page = (result.data ?? []) as IdentifierRow[];
      identifierRows.push(...page);
      if (page.length < pageSize) break;
    }
    const websiteStatus = await websitePromise;

    const numbersByOrganisation = new Map<string, string[]>();
    for (const identifier of identifierRows) {
      const values = numbersByOrganisation.get(identifier.organisation_id) ?? [];
      values.push(identifier.identifier_value);
      numbersByOrganisation.set(identifier.organisation_id, values);
    }
    const existing = organisationRows.map((organisation) => ({
      id: organisation.id,
      legal_name: organisation.legal_name,
      postcode: organisation.postcode ?? "",
      registrationNumbers: numbersByOrganisation.get(organisation.id),
    }));
    const duplicate = findDuplicateMatch({
      legal_name: parsed.data.legalName,
      postcode: "",
      registrationNumbers: parsed.data.registryNumber ? [parsed.data.registryNumber] : undefined,
    }, existing);
    const duplicateOrganisation = duplicate
      ? existing.find((organisation) => organisation.id === duplicate.organisationId) ?? null
      : null;

    const fields = reviewManualEntryFields(parsed.data, websiteStatus);
    const criteria = checkManualEntryCriteria({
      organisationType,
      countryCode: parsed.data.countryCode,
      adminConfirmedEligible,
    });
    const checks: ManualEntryCheck[] = [
      {
        label: "Email format (F045)",
        status: fields.email.status === "valid" ? "passed" : "warning",
        message: fields.email.message ?? "Email format is valid.",
      },
      {
        label: "Website URL (F046)",
        status: fields.website.status === "reachable" ? "passed" : "warning",
        message: fields.website.message ?? "Website is reachable.",
      },
      {
        label: "Client criteria (F047)",
        status: criteria.status === "passed" ? "passed" : "blocked",
        message: criteria.status === "passed" ? "Client criteria passed." : criteria.message,
      },
      {
        label: "Duplicate check (F042)",
        status: duplicate ? "warning" : "passed",
        message: duplicate
          ? `Possible duplicate: ${duplicateOrganisation?.legal_name ?? "existing client"}. A human decision is required.`
          : "No matching active client was found.",
      },
    ];

    return {
      kind: "checked",
      message: criteria.status === "passed"
        ? "All automated checks completed. Review any warnings, then make the duplicate decision and approve."
        : "Automated checks completed. Resolve the client-criteria decision before approval.",
      checks,
      approval: criteria.status === "passed" ? {
        organisationType,
        adminConfirmedEligible,
        candidateOrganisationId: duplicate?.organisationId ?? null,
        candidateOrganisationName: duplicateOrganisation?.legal_name ?? null,
        matchedOn: duplicate?.matchedOn ?? null,
      } : undefined,
    };
  } catch (error) {
    await reportError(error, {
      operation: "manual_entry.review_checks",
      actorUserId: authorization.actor.id,
      manualEntryId: id,
    });
    return {
      kind: "error",
      message: "The checks could not be completed. The failure was recorded; please try again.",
    };
  }
}

export async function approveManualEntry(
  _previous: ManualEntryReviewState,
  formData: FormData,
): Promise<ManualEntryReviewState> {
  const authorization = await getCurrentActor("approval:manage", { route: "/admin/manual-entries" });
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }

  const id = String(formData.get("id") ?? "");
  const organisationType = String(formData.get("organisationType") ?? "");
  const duplicateDecision = String(formData.get("duplicateDecision") ?? "");
  const candidateOrganisationId = String(formData.get("candidateOrganisationId") ?? "") || null;
  const adminConfirmedEligible = formData.get("adminConfirmedEligible") === "true";
  const notes = String(formData.get("notes") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id) || !isOrganisationType(organisationType)) {
    return { kind: "error", message: "The approval details are invalid. Run the checks again." };
  }
  if (!(["create_new", "link_existing"] as const).some((value) => value === duplicateDecision)) {
    return { kind: "error", message: "Choose whether to create a client or link the existing one." };
  }
  if (candidateOrganisationId && !/^[0-9a-f-]{36}$/i.test(candidateOrganisationId)) {
    return { kind: "error", message: "The duplicate candidate is invalid. Run the checks again." };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("approve_manual_entry", {
      p_entry_id: id,
      p_organisation_type: organisationType,
      p_admin_confirmed_eligible: adminConfirmedEligible,
      p_duplicate_decision: duplicateDecision,
      p_candidate_organisation_id: candidateOrganisationId,
      p_notes: notes || null,
    });
    if (error) {
      await reportError(error, {
        operation: "manual_entry.approve",
        actorUserId: authorization.actor.id,
        manualEntryId: id,
      });
      return { kind: "error", message: safeApprovalFailure(error) };
    }

    const organisationId = String(data);
    revalidatePath("/admin/manual-entries");
    revalidatePath("/clients");
    revalidatePath(`/clients/${organisationId}`);
    return {
      kind: "success",
      message: duplicateDecision === "link_existing"
        ? "Approved and linked to the existing client without creating a duplicate."
        : "Approved and created as an active manual client.",
    };
  } catch (error) {
    await reportError(error, {
      operation: "manual_entry.approve",
      actorUserId: authorization.actor.id,
      manualEntryId: id,
    });
    return {
      kind: "error",
      message: "The manual entry could not be approved. The failure was recorded; refresh and try again.",
    };
  }
}

export async function rejectManualEntry(formData: FormData): Promise<void> {
  const authorization = await getCurrentActor("approval:manage", { route: "/admin/manual-entries" });
  if (!authorization.ok) return;
  const id = String(formData.get("id") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id) || notes.length < 3) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_manual_entry", { p_entry_id: id, p_notes: notes });
  if (error) await reportError(error, { operation: "manual_entry.reject", actorUserId: authorization.actor.id, manualEntryId: id });
  revalidatePath("/admin/manual-entries");
}
