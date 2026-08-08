"use server";

import { revalidatePath } from "next/cache";
import { getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";

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
