"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";
import { safeValidate, uuidField } from "@/lib/validation";
import { websiteAbsenceFailureMessage } from "@/lib/website-absence";

/**
 * "This client has no website" — the one write behind the mark that takes a
 * record off the website queue without inventing a website for it.
 *
 * The write goes through `set_website_absent` (20261018090000), a SECURITY
 * DEFINER RPC that re-checks the admin role and writes an audit_log row in the
 * same transaction. The check below is presentation — it stops a control the
 * reader cannot use from doing anything, and it turns a refusal into a sentence
 * rather than a stack trace. The RPC is the gate.
 *
 * Not a proposal: recording a fact about a client (they have no website) is an
 * admin correction to the record, the same class of write as the field edits on
 * this screen. A CAM's route to it is the suggestion queue, which is a separate
 * later change.
 */

export type SetWebsiteAbsentResult =
  | { kind: "success" }
  | { kind: "error"; message: string };

const setWebsiteAbsentSchema = z.object({
  organisationId: uuidField(
    "That client could not be identified. Refresh the page and try again.",
  ),
  absent: z.boolean(),
});

export async function setWebsiteAbsentAction(
  input: unknown,
): Promise<SetWebsiteAbsentResult> {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/admin/incomplete-records",
  });
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }

  const validation = safeValidate(setWebsiteAbsentSchema, input);
  if (!validation.success) {
    return {
      kind: "error",
      message:
        Object.values(validation.fieldErrors).flat()[0] ??
        "That could not be saved. Refresh the page and try again.",
    };
  }

  const { organisationId, absent } = validation.data;
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_website_absent", {
    p_organisation_id: organisationId,
    p_absent: absent,
  });

  if (error) {
    await reportError(error, {
      operation: "admin.incomplete_records.set_website_absent",
      organisationId,
      absent,
    });
    return { kind: "error", message: websiteAbsenceFailureMessage(error) };
  }

  // The queue's own counts and the client's record both change with this, and
  // the client profile shows the website as missing again.
  revalidatePath("/admin/incomplete-records");
  revalidatePath(`/clients/${organisationId}`);

  return { kind: "success" };
}
