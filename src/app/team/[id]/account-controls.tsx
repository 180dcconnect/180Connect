"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, UserCheck, UserX } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/animate-ui/components/radix/dialog";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { reportError } from "@/lib/error-logging";
import { NETWORK_ERROR_MESSAGE } from "@/lib/network-error";
import { deleteTeamMember, reactivateTeamMember, suspendTeamMember } from "./account-actions";

/** An active CAM or admin who can take on a departing member's clients. */
export type HandoverDestination = {
  id: string;
  name: string;
  role: "cam" | "admin";
};

/** Select values that are not a person. Neither is a valid uuid, so no collision. */
const KEEP = "keep";
const POOL = "pool";

type Change = "suspend" | "delete";

const PILL =
  "inline-flex h-8.5 items-center gap-1.5 rounded-full border border-rule bg-white px-3.5 text-xs font-semibold text-ink transition-colors hover:border-faint hover:bg-paper focus-visible:outline-2 focus-visible:outline-lead-mid disabled:pointer-events-none disabled:opacity-50";

/**
 * Suspend / reactivate / delete, on the member's profile. Admin-only; the page does not
 * render this for anyone else, and the database refuses them regardless.
 *
 * Suspension is reversible and moves nothing unless the admin chooses to hand the
 * member's work on. Deletion is not reversible, so it always asks where the work goes
 * and why — the database refuses it otherwise.
 */
export function AccountControls({
  userId,
  displayName,
  isActive,
  ownedClientCount,
  destinations,
}: {
  userId: string;
  displayName: string;
  isActive: boolean;
  ownedClientCount: number;
  destinations: HandoverDestination[];
}) {
  const router = useRouter();
  const [change, setChange] = useState<Change | null>(null);
  const [handover, setHandover] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reactivateError, setReactivateError] = useState<string | null>(null);

  function openDialog(next: Change) {
    setChange(next);
    // A deletion with clients has no safe default: the admin must choose.
    setHandover(next === "suspend" ? KEEP : ownedClientCount > 0 ? "" : POOL);
    setReason("");
    setError(null);
  }

  const movesWork = change === "delete" || handover !== KEEP;
  const canSubmit = !busy && handover !== "" && (!movesWork || reason.trim() !== "");

  function handoverFields() {
    if (handover === KEEP) return {};
    if (handover === POOL) return { releaseClients: true };
    return { reassignTo: handover };
  }

  async function submit() {
    if (!change) return;
    setBusy(true);
    setError(null);
    try {
      const result =
        change === "delete"
          ? await deleteTeamMember({ userId, reason: reason.trim(), ...handoverFields() })
          : await suspendTeamMember({
              userId,
              ...(movesWork ? { reason: reason.trim() } : {}),
              ...handoverFields(),
            });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setChange(null);
      if (change === "delete") {
        router.push("/admin/users");
      }
      router.refresh();
    } catch (err) {
      void reportError(err, { operation: `team.detail.${change}_user` });
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  async function reactivate() {
    setBusy(true);
    setReactivateError(null);
    try {
      const result = await reactivateTeamMember({ userId });
      if (!result.ok) {
        setReactivateError(result.error);
        return;
      }
      router.refresh();
    } catch (err) {
      void reportError(err, { operation: "team.detail.reactivate_user" });
      setReactivateError(NETWORK_ERROR_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  const clientPhrase =
    ownedClientCount > 0
      ? `Their ${ownedClientCount} client${ownedClientCount === 1 ? "" : "s"} and open actions`
      : "Their open actions";

  return (
    <>
      {isActive ? (
        <button type="button" onClick={() => openDialog("suspend")} className={PILL}>
          <UserX aria-hidden="true" className="size-3.5 text-faint" />
          <span>Suspend</span>
        </button>
      ) : (
        <button type="button" onClick={reactivate} disabled={busy} className={PILL}>
          {busy ? (
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin text-faint" />
          ) : (
            <UserCheck aria-hidden="true" className="size-3.5 text-go" />
          )}
          <span>Reactivate</span>
        </button>
      )}

      <button
        type="button"
        onClick={() => openDialog("delete")}
        className={`${PILL} text-stop hover:border-stop/40 hover:bg-stop-wash`}
      >
        <Trash2 aria-hidden="true" className="size-3.5" />
        <span>Delete</span>
      </button>

      {reactivateError && (
        <span className="max-w-[260px]">
          <InlineAlert tone="error" message={reactivateError} />
        </span>
      )}

      <Dialog
        open={change !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setChange(null);
        }}
      >
        <DialogContent className="rounded-panel border-rule bg-white">
          <DialogHeader>
            <DialogTitle className="text-ink">
              {change === "delete" ? `Delete ${displayName}?` : `Suspend ${displayName}?`}
            </DialogTitle>
            <DialogDescription className="text-dim">
              {change === "delete"
                ? "This cannot be undone. If they have done anything here — notes, emails, approvals — their name and email are replaced with “Former member”, so that history keeps an author. If they have not, the account is removed completely."
                : "They are signed out everywhere and cannot sign in until an admin reactivates them. Nothing they own moves unless you hand it on."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-1.5 text-xs">
              <span id="handover-label" className="font-semibold text-ink">
                {clientPhrase}
              </span>
              <Select value={handover} onValueChange={setHandover} disabled={busy}>
                <SelectTrigger aria-labelledby="handover-label" className="w-full">
                  <SelectValue placeholder="Choose who takes them on" />
                </SelectTrigger>
                <SelectContent>
                  {change === "suspend" && (
                    <SelectItem value={KEEP}>Leave with them</SelectItem>
                  )}
                  <SelectItem value={POOL}>Release to the unowned pool</SelectItem>
                  {destinations.map((destination) => (
                    <SelectItem key={destination.id} value={destination.id}>
                      {destination.name} · {destination.role === "admin" ? "Admin" : "CAM"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {movesWork && (
              <label className="grid gap-1.5 text-xs">
                <span className="font-semibold text-ink">Reason</span>
                <Textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={500}
                  rows={3}
                  disabled={busy}
                  placeholder={
                    change === "delete"
                      ? "Why is this account being deleted?"
                      : "Why is their work being handed on?"
                  }
                />
              </label>
            )}

            {error && <InlineAlert tone="error" message={error} />}
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => setChange(null)}
              disabled={busy}
              className={PILL}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className={
                change === "delete"
                  ? "inline-flex h-8.5 items-center gap-1.5 rounded-full bg-stop px-3.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
                  : "inline-flex h-8.5 items-center gap-1.5 rounded-full bg-ink px-3.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
              }
            >
              {busy && <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />}
              {change === "delete" ? "Delete permanently" : "Suspend"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
