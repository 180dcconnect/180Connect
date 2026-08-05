import type { PendingInvite } from "@/lib/admin/team-realtime";

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
      {invites.map((invite) => (
        <li key={invite.id} className="flex items-center justify-between py-2">
          <span className="font-bold">{invite.email}</span>
          <span className="text-foreground/60">
            Invited {new Date(invite.invited_at).toLocaleDateString()}
          </span>
        </li>
      ))}
    </ul>
  );
}
