"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isInviteExpired, type PendingInvite } from "@/lib/admin/team-realtime";
import { cancelInviteAction, resendInviteAction } from "./invite-actions";
import { InlineAlert } from "@/components/ui/inline-alert";
import { DeleteButton } from "@/components/ui/delete-button";

type ActionResult = { text: string; status: "success" | "warning" | "error"; link?: string };

const ROLE_LABEL: Record<PendingInvite["role"], string> = {
  cam: "CAM",
  admin: "Admin",
  viewer: "Viewer",
};

export function PendingInvitesList({
  invites,
  error,
  onResendSuccess,
  onCancelSuccess,
}: {
  invites: PendingInvite[];
  error: boolean;
  onResendSuccess?: (id: string, newInvitedAt: string) => void;
  onCancelSuccess?: (id: string) => void;
}) {
  const router = useRouter();
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ActionResult>>({});

  async function handleResend(id: string) {
    setResendingId(id);

    const result = await resendInviteAction(id);
    setResendingId(null);

    if (result.message) {
      const isSuccess = result.status === "success" || result.status === "idle";
      if (isSuccess || result.status === "warning") {
        const nowIso = new Date().toISOString();
        onResendSuccess?.(id, nowIso);
        router.refresh();
      }
      setResults((current) => ({
        ...current,
        [id]: {
          text: result.message!,
          status: result.status === "idle" ? "success" : result.status,
          link: result.link,
        },
      }));
    }
  }

  async function handleCancel(id: string) {
    setCancellingId(id);

    const result = await cancelInviteAction(id);
    setCancellingId(null);

    if (result.message) {
      if (result.status === "success" || result.status === "idle") {
        onCancelSuccess?.(id);
        router.refresh();
      }
      setResults((current) => ({
        ...current,
        [id]: { text: result.message!, status: result.status === "idle" ? "success" : result.status },
      }));
    }
  }

  if (error) {
    return (
      <InlineAlert
        variant="page"
        message="Pending invites could not be loaded. Please refresh and try again."
      />
    );
  }

  if (invites.length === 0) {
    return <p className="text-sm text-foreground/60">No pending invites.</p>;
  }

  return (
    <ul className="divide-y divide-black/5 text-sm">
      {invites.map((invite) => {
        const result = results[invite.id];
        const expired = isInviteExpired(invite.invited_at);
        const busy = resendingId === invite.id || cancellingId === invite.id;
        return (
          <li key={invite.id} className="flex flex-col gap-1 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <span className="font-bold">{invite.email}</span>
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-bold text-foreground/70">
                  {ROLE_LABEL[invite.role]}
                </span>
              </span>
              <div className="flex items-center gap-2.5">
                <span className="text-xs text-foreground/60">
                  Invited {new Date(invite.invited_at).toLocaleDateString("en-GB")}
                  {expired && <span className="ml-2 font-bold text-red-700">Expired</span>}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleResend(invite.id)}
                  className="h-7 rounded-sm border border-black/10 bg-white px-3 text-xs font-semibold text-foreground shadow-2xs transition-all hover:border-brand/40 hover:bg-brand/5 hover:text-brand disabled:cursor-wait disabled:opacity-50"
                >
                  {resendingId === invite.id ? "Resending…" : "Resend"}
                </button>
                <DeleteButton
                  label="Cancel"
                  confirmLabel="Revoke?"
                  deletingLabel="Cancelling…"
                  size="xs"
                  variant="subtle"
                  disabled={busy}
                  loading={cancellingId === invite.id}
                  onConfirm={() => handleCancel(invite.id)}
                />
              </div>
            </div>
            {result &&
              (result.status === "error" ? (
                <InlineAlert message={result.text} />
              ) : (
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <p
                    aria-live="polite"
                    className={result.status === "warning" ? "text-xs text-amber-700" : "text-xs text-brand"}
                  >
                    {result.text}
                  </p>
                  {result.link && (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(result.link!);
                        setCopiedId(invite.id);
                        setTimeout(() => setCopiedId(null), 3000);
                      }}
                      className="cursor-pointer font-semibold text-xs text-brand underline underline-offset-2 hover:opacity-80"
                    >
                      {copiedId === invite.id ? "✓ Copied invite link" : "Copy invite link"}
                    </button>
                  )}
                </div>
              ))}
          </li>
        );
      })}
    </ul>
  );
}
