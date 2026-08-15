"use client";

import { useState } from "react";
import { isInviteExpired, type PendingInvite } from "@/lib/admin/team-realtime";
import { cancelInviteAction, resendInviteAction } from "./invite-actions";

type ActionResult = { text: string; status: "success" | "warning" | "error" };

const ROLE_LABEL: Record<PendingInvite["role"], string> = {
  cam: "CAM",
  admin: "Admin",
  viewer: "Viewer",
};

export function PendingInvitesList({
  invites,
  error,
}: {
  invites: PendingInvite[];
  error: boolean;
}) {
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ActionResult>>({});

  async function handleResend(id: string) {
    setResendingId(id);

    const result = await resendInviteAction(id);
    setResendingId(null);

    if (result.message) {
      setResults((current) => ({
        ...current,
        [id]: { text: result.message!, status: result.status === "idle" ? "success" : result.status },
      }));
    }
  }

  async function handleCancel(id: string, email: string) {
    if (!confirm(`Cancel the invite to ${email}? They'll need a brand-new invite to join.`)) {
      return;
    }

    setCancellingId(id);

    const result = await cancelInviteAction(id);
    setCancellingId(null);

    if (result.message) {
      setResults((current) => ({
        ...current,
        [id]: { text: result.message!, status: result.status === "idle" ? "success" : result.status },
      }));
    }
  }

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
        const result = results[invite.id];
        const expired = isInviteExpired(invite.invited_at);
        const busy = resendingId === invite.id || cancellingId === invite.id;
        return (
          <li key={invite.id} className="flex flex-col gap-1 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <span className="font-bold">{invite.email}</span>
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-bold text-foreground/70">
                  {ROLE_LABEL[invite.role]}
                </span>
              </span>
              <div className="flex items-center gap-3">
                <span className="text-foreground/60">
                  Invited {new Date(invite.invited_at).toLocaleDateString("en-GB")}
                  {expired && <span className="ml-2 font-bold text-red-700">Expired</span>}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleResend(invite.id)}
                  className="rounded-lg border border-black/15 px-3 py-1.5 text-xs font-bold transition-colors hover:border-brand disabled:cursor-wait disabled:opacity-50"
                >
                  {resendingId === invite.id ? "Resending..." : "Resend"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleCancel(invite.id, invite.email)}
                  className="rounded-lg border border-black/15 px-3 py-1.5 text-xs font-bold text-red-700 transition-colors hover:border-red-700 disabled:cursor-wait disabled:opacity-50"
                >
                  {cancellingId === invite.id ? "Cancelling..." : "Cancel"}
                </button>
              </div>
            </div>
            {result && (
              <p
                aria-live="polite"
                className={
                  result.status === "error"
                    ? "text-xs text-red-700"
                    : result.status === "warning"
                      ? "text-xs text-amber-700"
                      : "text-xs text-brand"
                }
              >
                {result.text}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
