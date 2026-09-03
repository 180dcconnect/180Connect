import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "@/lib/auth/permissions";
import { reportError } from "@/lib/error-logging";
import { logSecurityEvent } from "@/lib/log-security-event";
import { checkOwnershipConflict } from "@/lib/outreach/ownership-conflict";

export type ContactPermissionParams = {
  organisationId: string;
  actorId: string;
  actorRole: AppRole;
};

export type ContactPermissionResult =
  | { allowed: true }
  | { allowed: false; message: string };

type OrganisationOwnerRow = {
  owner_id: string | null;
  owner: { full_name: string | null } | null;
};

/**
 * F018 (#21): the contact-permission rule enforced at the send/schedule actions
 * themselves. Generation was already gated (outreach-preflight / stage-one /
 * stage-two all refuse with 409 ownership_conflict), but a draft that predates
 * a client's reassignment could still be sent or scheduled by the CAM who
 * authored it — this closes that hole at the point of send, so the action
 * itself is blocked, not merely hidden in the UI (AC1), and returns the
 * owner-naming conflict copy rather than a generic permission error (AC2).
 *
 * Admins pass through here untouched (checkOwnershipConflict never conflicts
 * them, AC3); ComposeButton layers the last-resort confirmation dialog on top.
 * Scheduled sends are checked HERE and in the schedule_outreach_send RPC only —
 * per PM decision (Bashir, Aug 2026) deliveries already queued are grandfathered:
 * the cron worker does not re-check ownership at delivery time.
 *
 * Fail-closed like the suppression check: an unreadable ownership row must not
 * read as "no conflict".
 */
export async function assertContactPermission(
  supabase: SupabaseClient,
  { organisationId, actorId, actorRole }: ContactPermissionParams,
): Promise<ContactPermissionResult> {
  const { data: orgRow, error: orgError } = await supabase
    .from("organisations")
    .select("owner_id, owner:users!organisations_owner_id_fkey(full_name)")
    .eq("id", organisationId)
    .maybeSingle<OrganisationOwnerRow>();

  if (orgError || !orgRow) {
    if (orgError) {
      await reportError(orgError, {
        operation: "outreach.contact_permission.org_lookup",
        organisationId,
        userId: actorId,
      });
    }
    logSecurityEvent("outreach.contact_permission_unavailable", {
      organisationId,
      userId: actorId,
      cause: orgError?.message ?? "organisation row not found",
    });
    return {
      allowed: false,
      message: "The client's ownership could not be verified. Nothing was sent. Try again.",
    };
  }

  const conflict = checkOwnershipConflict({
    ownerId: orgRow.owner_id ?? null,
    ownerName: orgRow.owner?.full_name ?? null,
    actorId,
    actorRole,
  });

  if (!conflict.hasConflict) return { allowed: true };

  logSecurityEvent("outreach.ownership_conflict_blocked", {
    organisationId,
    ownerId: conflict.ownerId,
    userId: actorId,
  });
  return { allowed: false, message: conflict.warning };
}
