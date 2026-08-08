import type { PendingInvite } from "@/lib/admin/team-realtime";
import { isInviteExpired } from "@/lib/auth/invite-expiry";

export function PendingInvitesList({
  invites,
  error,
}: {
  invites: PendingInvite[];
  error: boolean;
}) {
  if (error) {
    return (
      <p className="mt-3 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800" role="alert">
        Pending invites could not be loaded. Please refresh and try again.
      </p>
    );
  }

  if (invites.length === 0) {
    return <p className="mt-3 text-sm text-foreground/60">No pending invites.</p>;
  }

  return (
    <ul className="mt-3 divide-y divide-black/5 text-sm">
      {invites.map((invite) => {
        // Expiry is computed here, not stored — F010 does not add a database
        // column for it. Supabase is still the only thing that actually
        // invalidates the token; this is what lets an admin see a stale invite
        // without waiting for the invited person to report a dead link.
        const expired = isInviteExpired(invite.invited_at);
        return (
          <li key={invite.id} className="flex items-center justify-between py-2">
            <span className="font-bold">{invite.email}</span>
            <span className={expired ? "font-bold text-red-700" : "text-foreground/60"}>
              {expired
                ? "Expired"
                : `Invited ${new Date(invite.invited_at).toLocaleDateString()}`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
