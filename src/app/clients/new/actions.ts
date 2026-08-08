"use server";

import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { manualEntrySchema } from "@/lib/manual-entry";
import { createClient } from "@/lib/supabase/server";

export type ManualEntryState = { kind: "idle" | "success" | "error"; message: string };

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
    const supabase = await createClient();
    const { error } = await supabase.rpc("submit_manual_entry", {
      p_legal_name: parsed.data.legalName,
      p_country_code: parsed.data.countryCode,
      p_website: parsed.data.website || null,
      p_contact_email: parsed.data.contactEmail || null,
      p_registry_name: parsed.data.registryName || null,
      p_registry_number: parsed.data.registryNumber || null,
      p_reason: parsed.data.reason,
    });
    if (error) throw error;
    revalidatePath("/admin/manual-entries");
    return { kind: "success", message: "Submitted for admin review. It is not an active client yet." };
  } catch (error) {
    await reportError(error, { operation: "manual_entry.submit", actorUserId: authorization.actor.id });
    return { kind: "error", message: "The manual entry could not be saved. The failure was recorded; please try again." };
  }
}
