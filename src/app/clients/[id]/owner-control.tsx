"use client";

import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/animate-ui/components/radix/dialog";

import { ClaimButton } from "./claim-button";
import { AssignOwnerForm } from "./assign-owner-form";

type TeamMember = { id: string; full_name: string | null };

/**
 * Who this record belongs to, and the one control that changes it — in the
 * header, on every tab.
 *
 * Ownership used to be shown twice: read-only in the hero, with the actual claim
 * and reassign controls in a card far below it in the right-hand column, under a
 * hero line that read "Claim it from the Ownership card below." A record's owner
 * is the first thing a CAM checks and among the first things an admin changes,
 * so the display and the control are now the same thing, and the card is gone.
 *
 * Reassign opens a dialog rather than expanding in place: the form carries a
 * picker plus a required reason that lands in the audit log, which is more than
 * a header should ever grow to hold inline.
 */
export function OwnerControl({
  organisationId,
  ownerId,
  ownerName,
  ownerInitials,
  isSelf,
  canEdit,
  isAdmin,
  team,
}: {
  organisationId: string;
  ownerId: string | null;
  ownerName: string | null;
  ownerInitials: string;
  isSelf: boolean;
  canEdit: boolean;
  isAdmin: boolean;
  team: TeamMember[];
}) {
  const [assigning, setAssigning] = useState(false);

  return (
    <div className="min-w-[13rem] rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-bold tracking-[0.16em] text-[#f4f4ef]/40 uppercase">
          Owner
        </p>
        {isAdmin && (
          <button
            className="cursor-pointer text-[10px] font-bold tracking-[0.08em] text-[#e6f5c0]/75 uppercase transition-colors hover:text-[#e6f5c0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e6f5c0]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1c1a18] rounded"
            onClick={() => setAssigning(true)}
            type="button"
          >
            {ownerId ? "Reassign" : "Assign"}
          </button>
        )}
      </div>

      {ownerId ? (
        <div className="mt-2.5 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-[13px] font-bold text-[#f4f4ef]/85 ring-1 ring-white/15"
          >
            {ownerInitials || "?"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-[#f4f4ef]/90">{ownerName}</p>
            {isSelf && (
              <p className="text-[11px] font-bold tracking-[0.08em] text-[#e6f5c0]/80 uppercase">
                That&apos;s you
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-2.5 space-y-2.5">
          <p className="text-sm font-bold text-[#f4f4ef]/70">Unassigned</p>
          {canEdit && <ClaimButton onDark organisationId={organisationId} />}
        </div>
      )}

      {isAdmin && (
        <Dialog open={assigning} onOpenChange={setAssigning}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{ownerId ? "Reassign this client" : "Assign an owner"}</DialogTitle>
              <DialogDescription>
                The reason is required and is written to the audit log alongside the
                change.
              </DialogDescription>
            </DialogHeader>
            <AssignOwnerForm
              organisationId={organisationId}
              currentOwnerId={ownerId}
              currentOwnerName={ownerName}
              team={team}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/**
 * Pipeline status, on the header's dark band. `StatusSelect` renders a white
 * trigger and its own save button, which sits fine on ink — this only supplies
 * the label and keeps the spacing consistent with the owner tile beside it.
 */
export function HeaderControlShell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-[13rem] rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10">
      <p className="text-[10px] font-bold tracking-[0.16em] text-[#f4f4ef]/40 uppercase">
        {label}
      </p>
      {children}
    </div>
  );
}
