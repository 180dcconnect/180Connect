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

type TeamMember = { id: string; full_name: string | null };

/**
 * F163 — admin assigns or reassigns this client's owner. Posts to
 * /api/clients/[id]/assign-owner, which calls reassign_ownership.
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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ownerId) {
      setError("Choose a CAM to assign.");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required so the handover can be understood later.");
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
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-3 space-y-3" onSubmit={submit}>
      {currentOwnerId && (
        <p
          role="alert"
          className="rounded-lg bg-amber-50 p-3 text-xs font-bold text-amber-800"
        >
          Currently owned by {currentOwnerName ?? "a former team member"}. Assigning a
          new owner moves this client away from them — this is not silent.
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-foreground/65">Assign to</span>
        <Select value={ownerId} onValueChange={setOwnerId}>
          <SelectTrigger className="w-full text-sm">
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

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-foreground/65">Reason</span>
        <input
          type="text"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why this handover is happening"
          className="rounded-lg border border-black/10 px-3 py-2 text-sm"
        />
      </label>

      <button
        type="submit"
        disabled={busy}
        className="rounded-full border border-brand/30 px-4 py-1.5 text-xs font-bold text-brand hover:bg-brand/5 disabled:opacity-50"
      >
        {busy ? "Assigning…" : currentOwnerId ? "Reassign owner" : "Assign owner"}
      </button>

      {error && (
        <p aria-live="polite" role="alert" className="text-xs font-bold text-red-800">
          {error}
        </p>
      )}
    </form>
  );
}
