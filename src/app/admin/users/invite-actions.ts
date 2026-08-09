"use server";

import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import {
  cancelInvite,
  resendInvite,
  sendInvite,
  type InviteRole,
  type InviteState,
  type LookupPendingInvite,
} from "@/lib/auth/invite";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Shared by resend and cancel — both need "does this row still exist, and is
 * it still pending" before acting, from nothing but a row id.
 */
function makeLookupPendingInvite(
  supabase: Awaited<ReturnType<typeof createClient>>,
): LookupPendingInvite {
  return async (id: string) => {
    const { data, error } = await supabase
      .from("users")
      .select("email, invited_at, invite_accepted_at, role")
      .eq("id", id)
      .maybeSingle<{
        email: string;
        invited_at: string | null;
        invite_accepted_at: string | null;
        role: InviteRole;
      }>();
    if (error) throw new Error(error.message);
    // Not an invite at all — a seeded/bootstrapped account, or any other row
    // that never went through the invite flow — must not be actionable just
    // because invite_accepted_at happens to be null for it too. Same predicate
    // as team-realtime.ts's isPendingInvite().
    if (!data || !data.invited_at) return null;
    return { email: data.email, accepted: data.invite_accepted_at !== null, role: data.role };
  };
}

/**
 * Where the invite email's link should land. Reuses the `/auth/confirm` route
 * that password recovery already lands on (F004) — see
 * `src/app/auth/confirm/route.ts`, which now also accepts `type=invite`.
 *
 * `NEXT_PUBLIC_APP_URL` is required (`src/lib/env.ts`), so an unset value here is
 * a deployment fault rather than something to paper over with a request header.
 */
function inviteRedirectUrl(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!configuredUrl) throw new Error("NEXT_PUBLIC_APP_URL is not configured.");
  return `${configuredUrl}/auth/confirm`;
}

export async function sendInviteAction(
  _previousState: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) {
    return { status: "error", message: actorFailureMessage(authorization.reason) };
  }

  // Sending the invite needs the Supabase Admin API, which only the service-role
  // key can call — the same client already used for the login throttle and the
  // suspended-user check (src/lib/supabase/admin.ts). It is optional locally, so
  // an admin working without it sees a clear message instead of a crash.
  const adminClient = createAdminClient();
  if (!adminClient) {
    return {
      status: "error",
      message: "Invites are not configured in this environment.",
    };
  }

  let redirectTo: string;
  try {
    redirectTo = inviteRedirectUrl();
  } catch {
    return {
      status: "error",
      message: "Invites are not configured in this environment.",
    };
  }

  const supabase = await createClient();
  const lookupExistingUser = async (email: string) => {
    const { data, error } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle<{ id: string }>();
    if (error) throw new Error(error.message);
    return data;
  };

  const outcome = await sendInvite(
    lookupExistingUser,
    adminClient,
    authorization.actor.id,
    { email: formData.get("email"), role: formData.get("role") },
    redirectTo,
    undefined,
    {
      // Named in the email so the invitation reads as coming from a colleague.
      // Falls back through the address to a generic label rather than leaving a
      // blank where a name should be.
      inviterName:
        authorization.actor.fullName ?? authorization.actor.email ?? "An admin",
      // Runs as the signed-in admin (not the service-role client) so
      // `set_user_role`'s `app.is_admin()` check and its `audit_log` row
      // resolve to them, not to the service role.
      setUserRole: async (userId, role) => {
        const { error } = await supabase.rpc("set_user_role", {
          p_user_id: userId,
          p_new_role: role,
        });
        return { error };
      },
    },
  );

  if (outcome.ok) {
    // So the pending-invites list on /admin/users shows the new row immediately,
    // without the admin having to refresh (AC5).
    revalidatePath("/admin/users");
  }

  return outcome.state;
}

/**
 * F252. Called directly from the pending-invites list's "Resend" button — a
 * plain function call, not a form action, since there is no field to submit,
 * only a row id already known to the client.
 */
export async function resendInviteAction(userId: string): Promise<InviteState> {
  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) {
    return { status: "error", message: actorFailureMessage(authorization.reason) };
  }

  const adminClient = createAdminClient();
  if (!adminClient) {
    return {
      status: "error",
      message: "Invites are not configured in this environment.",
    };
  }

  let redirectTo: string;
  try {
    redirectTo = inviteRedirectUrl();
  } catch {
    return {
      status: "error",
      message: "Invites are not configured in this environment.",
    };
  }

  const supabase = await createClient();

  const outcome = await resendInvite(
    makeLookupPendingInvite(supabase),
    adminClient,
    authorization.actor.id,
    userId,
    redirectTo,
    {
      inviterName:
        authorization.actor.fullName ?? authorization.actor.email ?? "An admin",
    },
  );

  if (outcome.ok) {
    revalidatePath("/admin/users");
  }

  return outcome.state;
}

/**
 * Rescinds a pending invite by deleting the not-yet-accepted account. Called
 * directly from the pending-invites list's "Cancel" button, same shape as
 * `resendInviteAction`.
 */
export async function cancelInviteAction(userId: string): Promise<InviteState> {
  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) {
    return { status: "error", message: actorFailureMessage(authorization.reason) };
  }

  // Deleting the auth user needs the Admin API, same service-role client as
  // send/resend.
  const adminClient = createAdminClient();
  if (!adminClient) {
    return {
      status: "error",
      message: "Invites are not configured in this environment.",
    };
  }

  const supabase = await createClient();

  // The admin client already bypasses RLS (service role), so it doubles as the
  // audit-log writer here — the same tier `logRoleChangeDenial`
  // (src/lib/auth/permission-denial.ts) uses to write `audit_log` directly
  // rather than through a SECURITY DEFINER RPC.
  const outcome = await cancelInvite(
    makeLookupPendingInvite(supabase),
    adminClient,
    adminClient,
    authorization.actor.id,
    userId,
  );

  if (outcome.ok) {
    revalidatePath("/admin/users");
  }

  return outcome.state;
}
