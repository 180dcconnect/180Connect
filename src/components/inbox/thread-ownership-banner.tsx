"use client";

import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { OriginButton } from "@/components/ui/origin-button";
import { RequestOwnershipForm } from "@/app/clients/[id]/request-ownership-form";
import {
  getMyOwnershipRequest,
  takeOverClientOwnership,
  type MyOwnershipRequest,
} from "@/app/inbox/actions";
import type { AppRole } from "@/lib/auth/permissions";

/**
 * Stands in for the Reply control on a thread the viewer does not own.
 *
 * - Admin: "Change ownership" moves the client to them through reassign_ownership
 *   (audited; the former owner is notified by the owner-change trigger). The
 *   current owner id travels as the concurrency guard, so a client that moved
 *   while the thread sat open is not seized from whoever holds it now.
 * - CAM: a CAM never overrides another CAM (#406) — they ask an admin, through
 *   the same request form the client record uses.
 * - Anyone else cannot contact clients at all, so the banner only explains.
 */
export function ThreadOwnershipBanner({
  organisationId,
  ownerId,
  ownerName,
  viewerRole,
  onOwnershipChanged,
}: {
  organisationId: string;
  ownerId: string;
  ownerName: string | null;
  viewerRole: AppRole;
  onOwnershipChanged: () => void;
}) {
  const owner = ownerName?.trim() || "another team member";

  return (
    <div
      role="alert"
      className="rounded-panel border border-stop/25 bg-stop-wash px-4 py-3.5"
    >
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-stop" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-[1.6] text-stop">
            This is not your client — it belongs to {owner}.
          </p>
          <p className="text-[13px] leading-[1.6] text-dim">
            {viewerRole === "admin"
              ? "Change ownership to contact this client."
              : viewerRole === "cam"
                ? "Request an ownership change to contact this client."
                : "Only the owner can contact this client."}
          </p>

          {viewerRole === "admin" && (
            <AdminTakeOver
              key={organisationId}
              organisationId={organisationId}
              ownerId={ownerId}
              ownerName={owner}
              onOwnershipChanged={onOwnershipChanged}
            />
          )}
          {viewerRole === "cam" && (
            <CamRequest key={organisationId} organisationId={organisationId} ownerName={owner} />
          )}
        </div>
      </div>
    </div>
  );
}

function AdminTakeOver({
  organisationId,
  ownerId,
  ownerName,
  onOwnershipChanged,
}: {
  organisationId: string;
  ownerId: string;
  ownerName: string;
  onOwnershipChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    const result = await takeOverClientOwnership(organisationId, ownerId);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setConfirming(false);
    onOwnershipChanged();
  }

  return (
    <div className="mt-3 space-y-2">
      {confirming ? (
        <>
          <p className="text-[13px] leading-[1.6] text-dim">
            The client moves to you. {ownerName} will be notified.
          </p>
          <div className="flex items-center gap-2">
            <OriginButton type="button" size="sm" loading={busy} disabled={busy} onClick={confirm}>
              {busy ? "Changing…" : "Confirm change"}
            </OriginButton>
            <OriginButton
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
            >
              Cancel
            </OriginButton>
          </div>
        </>
      ) : (
        <OriginButton type="button" size="sm" onClick={() => setConfirming(true)}>
          Change ownership
        </OriginButton>
      )}
      {error && (
        <p aria-live="polite" role="alert" className="text-[13px] font-semibold text-stop">
          {error}
        </p>
      )}
    </div>
  );
}

function CamRequest({ organisationId, ownerName }: { organisationId: string; ownerName: string }) {
  const [existing, setExisting] = useState<MyOwnershipRequest | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void getMyOwnershipRequest(organisationId).then((request) => {
      if (!cancelled) setExisting(request);
    });
    return () => {
      cancelled = true;
    };
  }, [organisationId]);

  // Hold the form until the lookup lands, so a CAM with a pending ask is never
  // offered a second one that the RPC would refuse.
  if (existing === undefined) return null;

  return (
    <RequestOwnershipForm
      organisationId={organisationId}
      ownerName={ownerName}
      existingStatus={existing?.status ?? null}
      decisionNote={existing?.decisionNote ?? null}
    />
  );
}
