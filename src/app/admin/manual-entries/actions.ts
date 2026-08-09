"use server";

import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
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
  status: "passed" | "warning" | "blocked" | "pending";
  message: string;
};

export type ManualEntryReviewState = {
  kind: "idle" | "checked" | "error";
  message: string;
  checks?: ManualEntryCheck[];
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
  if (!(["charity", "company", "both", "other"] as const).some((value) => value === organisationType)) {
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

    const websiteStatus = await checkWebsiteReachability(parsed.data.website);
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
        status: "pending",
        message: "F042 has not been connected yet. Approval remains safely disabled.",
      },
    ];

    return {
      kind: "checked",
      message: criteria.status === "passed"
        ? "Available checks completed. F042 is the only remaining approval dependency."
        : "Available checks completed. Resolve the client-criteria decision and connect F042 before approval.",
      checks,
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
