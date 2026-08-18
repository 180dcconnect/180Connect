"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { OriginButton } from "@/components/ui/origin-button";
import { reportError } from "@/lib/error-logging";
import { validateReassignOwnership } from "@/lib/ownership";

type TeamMember = { id: string; full_name: string | null };

/**
 * F163/F164 — admin assigns (F163) or changes/reassigns (F164) this client's owner.
 * Posts to /api/clients/[id]/assign-owner, which calls reassign_ownership.
 *
 * AC2's conflict warning is shown up front, not just after an error: when the
 * client already has an owner, the amber notice below the picker stays visible for
 * as long as the form does, the same treatment ClaimButton gives a 409 — so an
 * admin sees the existing assignment before submitting, not only if they retry
 * into one (F165's minimal form, reused rather than duplicated).
 */
export function AssignOwnerForm({
  organisationId,
  currentOwnerId,
  currentOwnerName,
  team,
}: {
  organisationId: string;
  currentOwnerId: string | null;
  currentOwnerName: string | null;
  team: TeamMember[];
}) {
  const router = useRouter();
  const [ownerId, setOwnerId] = useState(currentOwnerId ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isReassignment = Boolean(currentOwnerId);
  const isSameOwnerSelected = isReassignment && ownerId === currentOwnerId;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validation = validateReassignOwnership({
      organisationId,
      newOwnerId: ownerId,
      reason,
      currentOwnerId,
    });

    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/clients/${organisationId}/assign-owner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId, reason }),
      });
      if (response.ok) {
        setReason("");
        router.refresh();
        return;
      }
      const body = await response.json();
      setError(body.error ?? "This client could not be assigned.");
    } catch (err) {
      void reportError(err, { operation: "clients.assign_owner_client", organisationId });
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-5 space-y-3 border-t border-black/[0.06] pt-5" onSubmit={submit}>
      {currentOwnerId && (
        <p
          role="alert"
          className="rounded-xl border border-amber-500/20 bg-amber-500/[0.07] px-3.5 py-3 text-[13px] font-bold leading-[1.6] text-amber-800"
        >
          Currently owned by {currentOwnerName ?? "a former team member"}. Changing
          ownership moves this client and all associated open tasks away from them.
        </p>
      )}

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
          {isReassignment ? "Reassign to" : "Assign to"}
        </span>
        <Select
          value={ownerId}
          onValueChange={(val) => {
            setOwnerId(val);
            setError(null);
          }}
        >
          <SelectTrigger className="w-full rounded-xl bg-white text-sm">
            <SelectValue placeholder="Choose a CAM" />
          </SelectTrigger>
          <SelectContent>
            {team.map((member) => (
              <SelectItem key={member.id} value={member.id}>
                {member.full_name ?? "Unnamed CAM"}
                {member.id === currentOwnerId ? " (current owner)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
          Reason
        </span>
        <Input
          type="text"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            setError(null);
          }}
          placeholder={
            isReassignment
              ? "Why this owner change is happening"
              : "Why this assignment is being made"
          }
          className="rounded-xl bg-white"
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <OriginButton
          type="submit"
          size="sm"
          loading={busy}
          disabled={busy || isSameOwnerSelected}
        >
          {busy ? "Updating…" : isReassignment ? "Reassign owner" : "Assign owner"}
        </OriginButton>

        {/* The picker opens on the current owner, so the button starts disabled on
            an owned client — say why, rather than leaving a dead control. */}
        {isSameOwnerSelected && (
          <p className="text-[13px] leading-[1.6] text-foreground/50">
            {currentOwnerName ?? "This team member"} already owns this client. Choose a
            different CAM to change ownership.
          </p>
        )}
      </div>

      {error && (
        <p aria-live="polite" role="alert" className="text-[13px] font-bold text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
