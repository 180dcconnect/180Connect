"use server";

import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";

export type AdminEditState = { kind: "idle" } | { kind: "success"; message: string } | { kind: "error"; message: string };

export async function adminDirectEditAction(_prev: AdminEditState, formData: FormData): Promise<AdminEditState> {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/[id]" });
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }
  if (authorization.actor.role !== "admin") {
    return { kind: "error", message: "Only an admin can directly edit." };
  }

  const organisationId = String(formData.get("organisationId") ?? "").trim();
  const fieldName = String(formData.get("fieldName") ?? "").trim();
  const fieldValue = String(formData.get("fieldValue") ?? "").trim();

  if (!organisationId || !fieldName || !fieldValue) {
    return { kind: "error", message: "Organisation, field and value are required." };
  }

  // Allowlist to prevent arbitrary column writes — mirrors restricted_edit_fields for now.
  const allowed = new Set(["legal_name", "organisation_type", "city", "country_code", "contact_email", "website", "sector", "sub_sector", "geographic_reach"]);
  if (!allowed.has(fieldName)) {
    return { kind: "error", message: "That field cannot be edited directly." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("organisations").update({ [fieldName]: fieldValue }).eq("id", organisationId);

  if (error) {
    await reportError(error, { operation: "clients.admin_direct_edit", organisationId, fieldName });
    return { kind: "error", message: error.message ?? "Could not save change." };
  }

  revalidatePath(`/clients/${organisationId}`, "layout");
  return { kind: "success", message: "Saved." };
}
