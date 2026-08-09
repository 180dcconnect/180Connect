"use server";

import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { manualEntrySchema, reviewManualEntryFields } from "@/lib/manual-entry";
import { createClient } from "@/lib/supabase/server";
import { checkWebsiteReachability } from "@/lib/website-reachability";

export type ManualEntryState = {
  kind: "idle" | "success" | "error";
  message: string;
  warnings?: string[];
};

export async function submitManualEntry(
  _previous: ManualEntryState,
  formData: FormData,
): Promise<ManualEntryState> {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/new" });
  if (!authorization.ok) return { kind: "error", message: actorFailureMessage(authorization.reason) };

  const parsed = manualEntrySchema.safeParse({
    legalName: formData.get("legalName"),
    countryCode: formData.get("countryCode"),
    website: formData.get("website"),
    contactEmail: formData.get("contactEmail"),
    registryName: formData.get("registryName"),
    registryNumber: formData.get("registryNumber"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { kind: "error", message: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  try {
    const websiteStatus = await checkWebsiteReachability(parsed.data.website);
    const fieldReview = reviewManualEntryFields(parsed.data, websiteStatus);
    const storedEmail = fieldReview.email.status === "valid"
      ? fieldReview.email.value
      : parsed.data.contactEmail;
    const storedWebsite = fieldReview.website.status === "valid" || fieldReview.website.status === "reachable"
      ? fieldReview.website.url
      : parsed.data.website;
    const supabase = await createClient();
    const { error } = await supabase.rpc("submit_manual_entry", {
      p_legal_name: parsed.data.legalName,
      p_country_code: parsed.data.countryCode,
      p_website: storedWebsite || null,
      p_contact_email: storedEmail || null,
      p_registry_name: parsed.data.registryName || null,
      p_registry_number: parsed.data.registryNumber || null,
      p_reason: parsed.data.reason,
    });
    if (error) throw error;
    revalidatePath("/admin/manual-entries");
    return {
      kind: "success",
      message: "Submitted for admin review. It is not an active client yet.",
      warnings: fieldReview.warnings,
    };
  } catch (error) {
    await reportError(error, { operation: "manual_entry.submit", actorUserId: authorization.actor.id });
    return { kind: "error", message: "The manual entry could not be saved. The failure was recorded; please try again." };
  }
}
