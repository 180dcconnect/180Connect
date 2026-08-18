"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { OriginButton } from "@/components/ui/origin-button";
import {
  decidedRequestNotice,
  pendingRequestNotice,
  type OwnershipRequestStatus,
} from "@/lib/ownership-requests";

/**
 * #408 — the escalation off F165's conflict warning. A CAM looking at a client another
 * CAM owns can ask an admin to hand it over; they cannot take it.
 *
 * The form is the whole feature on this side: submitting creates a pending request and
 * changes nothing else. Ownership stays where it is until an admin decides, and the
 * copy says so at every step, so nobody reads "requested" as "granted".
 */
export function RequestOwnershipForm({
  organisationId,
  ownerName,
  existingStatus,
  decisionNote,
}: {
  organisationId: string;
  ownerName: string | null;
  existingStatus: OwnershipRequestStatus | null;
  decisionNote: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const pending = submitted || existingStatus === "pending";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason.trim()) {
      setError("Say why you should take this client on — an admin decides on it.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/clients/${organisationId}/request-ownership`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (response.ok) {
        setSubmitted(true);
        setReason("");
        setOpen(false);
        router.refresh();
        return;
      }
      const body = await response.json();
      setError(body.error ?? "The request could not be sent.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (pending) {
    return (
      <p
        aria-live="polite"
        className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] px-3.5 py-3 text-[13px] font-bold leading-[1.6] text-amber-800"
      >
        {pendingRequestNotice(ownerName)}
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      {existingStatus && (
        <p className="rounded-xl border border-black/[0.06] bg-black/[0.02] px-3.5 py-3 text-[13px] leading-[1.6] text-foreground/65">
          {decidedRequestNotice(existingStatus, decisionNote)}
        </p>
      )}

      {open ? (
        <form className="space-y-3" onSubmit={submit}>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
              Why you should take this on
            </span>
            <Input
              type="text"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="What the admin needs to know to decide"
              className="rounded-xl bg-white"
            />
          </label>
          <p className="text-[13px] leading-[1.6] text-foreground/45">
            This asks an admin to move the client to you. It does not move it — ownership
            stays with {ownerName ?? "the current owner"} unless an admin agrees.
          </p>
          <div className="flex items-center gap-2">
            <OriginButton type="submit" size="sm" loading={busy} disabled={busy}>
              {busy ? "Sending…" : "Send request"}
            </OriginButton>
            <OriginButton
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
            >
              Cancel
            </OriginButton>
          </div>
        </form>
      ) : (
        <OriginButton type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
          Request this client
        </OriginButton>
      )}

      {error && (
        <p aria-live="polite" role="alert" className="text-[13px] font-bold text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
