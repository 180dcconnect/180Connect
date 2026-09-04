"use client";

import { useMemo, useRef, useState } from "react";
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
  /**
   * Rows held in the DOM past the point the data says they're gone. The cancel
   * button plays a ~0.65s dissolve after `onConfirm` resolves, but both the
   * parent's optimistic removal and the realtime `users` subscription would
   * unmount the row before that finishes, so the animation never got seen.
   * A held row is released in `onComplete`, once the dissolve has played out.
   */
  const [heldInvites, setHeldInvites] = useState<{ invite: PendingInvite; index: number }[]>([]);
  const cancelSucceeded = useRef<Set<string>>(new Set());
  /**
   * Bumped when a cancel fails. The button vanishes at the end of its dissolve
   * regardless of the outcome, so a failed row would otherwise be left with no
   * way to retry until a full remount; changing its key gives it back.
   */
  const [cancelAttempts, setCancelAttempts] = useState<Record<string, number>>({});

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

    // Snapshot the row before the request goes out — realtime can drop it from
    // `invites` at any point once the delete commits.
    const index = invites.findIndex((invite) => invite.id === id);
    if (index >= 0) {
      const invite = invites[index];
      setHeldInvites((current) =>
        current.some((held) => held.invite.id === id) ? current : [...current, { invite, index }],
      );
    }

    const result = await cancelInviteAction(id);
    setCancellingId(null);

    if (result.status === "success" || result.status === "idle") {
      // No success message: the action resolves while the dissolve is still
      // playing, so rendering "Invite was cancelled." underneath would grow the
      // row by a line mid-animation — and the row is about to disappear anyway.
      // The dissolve is the confirmation.
      cancelSucceeded.current.add(id);
      return;
    }

    setCancelAttempts((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
    setHeldInvites((current) => current.filter((held) => held.invite.id !== id));

    const message = result.message;
    if (message) {
      setResults((current) => ({
        ...current,
        [id]: { text: message, status: result.status === "warning" ? "warning" : "error" },
      }));
    }
  }

  /** Runs after the dissolve has finished, so the row leaves on the animation. */
  function handleCancelComplete(id: string) {
    setHeldInvites((current) => current.filter((held) => held.invite.id !== id));
    if (!cancelSucceeded.current.delete(id)) return;
    onCancelSuccess?.(id);
    router.refresh();
  }

  // Held rows are spliced back at the index they occupied so a mid-dissolve row
  // doesn't jump to the end of the list.
  const visibleInvites = useMemo(() => {
    if (heldInvites.length === 0) return invites;
    const present = new Set(invites.map((invite) => invite.id));
    const merged = [...invites];
    for (const { invite, index } of heldInvites) {
      if (present.has(invite.id)) continue;
      merged.splice(Math.min(index, merged.length), 0, invite);
    }
    return merged;
  }, [invites, heldInvites]);

  if (error) {
    return (
      <InlineAlert
        variant="page"
        message="Pending invites could not be loaded. Please refresh and try again."
      />
    );
  }

  if (visibleInvites.length === 0) {
    return <p className="text-sm text-foreground/60">No pending invites.</p>;
  }

  return (
    <ul className="divide-y divide-black/5 text-sm">
      {visibleInvites.map((invite) => {
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
                  className="h-7 rounded-sm border border-black/10 bg-white px-3 text-xs font-semibold text-foreground shadow-2xs transition-all hover:border-neutral-300 hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-wait disabled:opacity-50"
                >
                  {resendingId === invite.id ? "Resending…" : "Resend"}
                </button>
                <DeleteButton
                  key={`cancel-${invite.id}-${cancelAttempts[invite.id] ?? 0}`}
                  label="Cancel"
                  confirmLabel="Revoke?"
                  deletingLabel="Cancelling…"
                  size="xs"
                  variant="subtle"
                  disabled={busy}
                  loading={cancellingId === invite.id}
                  onConfirm={() => handleCancel(invite.id)}
                  onComplete={() => handleCancelComplete(invite.id)}
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
