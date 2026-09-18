"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { nonEmptyTrimmed, safeValidate, uuidField } from "@/lib/validation";
import {
  SUPPRESSION_SELECT,
  suppressionRpcFailure,
  type SuppressionRow,
} from "@/lib/suppressions";

const createSchema = z.object({
  organisationId: uuidField("That client could not be read. Choose the client again."),
  reason: nonEmptyTrimmed(2_000, "Enter a reason for suppressing this client."),
});

const decideSchema = z.object({
  suppressionId: uuidField("That request could not be read. Refresh the page and try again."),
  approve: z.boolean(),
  note: z.string().trim().max(2_000, "Keep the note to 2,000 characters or fewer.").optional(),
});

const liftSchema = z.object({
  suppressionId: uuidField("That suppression could not be read. Refresh the page and try again."),
  reason: nonEmptyTrimmed(2_000, "Enter a reason for lifting this suppression."),
});

export type SuppressionActionResult =
  | { ok: true; suppressions: SuppressionRow[] | null }
  | { ok: false; error: string };

function validationError(fieldErrors: Record<string, string[] | undefined>): SuppressionActionResult {
  const firstError = Object.values(fieldErrors).flat()[0] ?? "Check the details and try again.";
  return { ok: false, error: firstError };
}

async function updatedSuppressions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  context: Record<string, unknown>,
): Promise<SuppressionRow[] | null> {
  const { data, error } = await supabase
    .from("suppressions")
    .select(SUPPRESSION_SELECT)
    .order("created_at", { ascending: false })
    .overrideTypes<SuppressionRow[], { merge: false }>();

  if (error) {
    await reportError(error, {
      operation: "admin.suppressions.refresh_after_change",
      ...context,
    });
    return null;
  }

  return data ?? [];
}

/** An admin's own request becomes active immediately inside the audited RPC. */
export async function suppressClientAction(input: unknown): Promise<SuppressionActionResult> {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/admin/suppressions",
  });
  if (!authorization.ok) {
    return { ok: false, error: actorFailureMessage(authorization.reason) };
  }

  const validation = safeValidate(createSchema, input);
  if (!validation.success) return validationError(validation.fieldErrors);

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_suppression", {
    p_organisation_id: validation.data.organisationId,
    p_reason: validation.data.reason,
  });

  if (error) {
    await reportError(error, {
      operation: "admin.suppressions.request",
      actorUserId: authorization.actor.id,
      organisationId: validation.data.organisationId,
    });
    const { error: message } = suppressionRpcFailure(error);
    return { ok: false, error: message };
  }

  revalidatePath("/admin/suppressions");
  return {
    ok: true,
    suppressions: await updatedSuppressions(supabase, {
      actorUserId: authorization.actor.id,
      organisationId: validation.data.organisationId,
    }),
  };
}

/** Approves or declines one CAM request through the audited decision RPC. */
export async function decideSuppressionAction(input: unknown): Promise<SuppressionActionResult> {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/admin/suppressions",
  });
  if (!authorization.ok) {
    return { ok: false, error: actorFailureMessage(authorization.reason) };
  }

  const validation = safeValidate(decideSchema, input);
  if (!validation.success) return validationError(validation.fieldErrors);

  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_suppression_request", {
    p_suppression_id: validation.data.suppressionId,
    p_approve: validation.data.approve,
    p_note: validation.data.note || null,
  });

  if (error) {
    await reportError(error, {
      operation: "admin.suppressions.decide",
      actorUserId: authorization.actor.id,
      suppressionId: validation.data.suppressionId,
    });
    const { error: message } = suppressionRpcFailure(error);
    return { ok: false, error: message };
  }

  revalidatePath("/admin/suppressions");
  return {
    ok: true,
    suppressions: await updatedSuppressions(supabase, {
      actorUserId: authorization.actor.id,
      suppressionId: validation.data.suppressionId,
    }),
  };
}

/** Restores one active client to working lists and outreach, with an audited reason. */
export async function liftSuppressionAction(input: unknown): Promise<SuppressionActionResult> {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/admin/suppressions",
  });
  if (!authorization.ok) {
    return { ok: false, error: actorFailureMessage(authorization.reason) };
  }

  const validation = safeValidate(liftSchema, input);
  if (!validation.success) return validationError(validation.fieldErrors);

  const supabase = await createClient();
  const { error } = await supabase.rpc("lift_suppression", {
    p_suppression_id: validation.data.suppressionId,
    p_reason: validation.data.reason,
  });

  if (error) {
    await reportError(error, {
      operation: "admin.suppressions.lift",
      actorUserId: authorization.actor.id,
      suppressionId: validation.data.suppressionId,
    });
    const { error: message } = suppressionRpcFailure(error);
    return { ok: false, error: message };
  }

  revalidatePath("/admin/suppressions");
  return {
    ok: true,
    suppressions: await updatedSuppressions(supabase, {
      actorUserId: authorization.actor.id,
      suppressionId: validation.data.suppressionId,
    }),
  };
}
