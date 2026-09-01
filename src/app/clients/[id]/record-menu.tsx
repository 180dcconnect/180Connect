"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/animate-ui/components/radix/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/animate-ui/components/radix/dialog";
import type { OwnershipRequestStatus } from "@/lib/ownership-requests";

import { SuppressButton } from "./suppress-button";
import { LiftSuppressionButton } from "./lift-suppression-button";
import { RequestOwnershipForm } from "./request-ownership-form";

/**
 * The record's rarely-used, record-wide actions, collected behind one `⋯` in the
 * header rather than given a card each.
 *
 * Each used to cost a full section: "Do not contact" was a `tone="danger"`
 * SectionCard in the right column, and the other two had no UI at all — the
 * lift-suppression and request-ownership components existed, and their API
 * routes existed, but nothing rendered them, so an admin could suppress a client
 * and never unsuppress it, and a CAM had no way to ask for a handover that
 * `docs/` says is the only legitimate route to one (a CAM never overrides
 * another CAM's ownership).
 *
 * Menu item → dialog, rather than the forms living inline in the menu: two of
 * the three need a written reason that goes on file, and a reason field inside a
 * dropdown is a reason field people dismiss by clicking away from it.
 */

type MenuDialog = "suppress" | "lift" | "ownership" | null;

export function RecordMenu({
  organisationId,
  canSuppress,
  isAdmin,
  suppressed,
  suppressionPending,
  suppressionId,
  ownerName,
  canRequestOwnership,
  ownershipRequestStatus,
  ownershipDecisionNote,
}: {
  organisationId: string;
  canSuppress: boolean;
  isAdmin: boolean;
  suppressed: boolean;
  suppressionPending: boolean;
  suppressionId?: string;
  ownerName: string | null;
  canRequestOwnership: boolean;
  ownershipRequestStatus: OwnershipRequestStatus | null;
  ownershipDecisionNote: string | null;
}) {
  const [dialog, setDialog] = useState<MenuDialog>(null);

  const showSuppress = canSuppress && !suppressed && !suppressionPending;
  const showLift = isAdmin && suppressed;
  const showOwnership = canRequestOwnership;

  // No actions available to this viewer on this record — render nothing rather
  // than a menu that opens onto an empty list.
  if (!showSuppress && !showLift && !showOwnership) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="More actions for this client"
          className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-white/[0.08] text-[#f4f4ef]/70 ring-1 ring-white/10 transition-colors hover:bg-white/[0.16] hover:text-[#f4f4ef] focus-visible:ring-2 focus-visible:ring-[#e6f5c0]/70 focus-visible:outline-none"
        >
          <MoreHorizontal aria-hidden="true" className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[13rem]">
          {showSuppress && (
            <DropdownMenuItem variant="destructive" onSelect={() => setDialog("suppress")}>
              Flag as Do Not Contact
            </DropdownMenuItem>
          )}
          {showLift && (
            <DropdownMenuItem onSelect={() => setDialog("lift")}>
              Lift suppression
            </DropdownMenuItem>
          )}
          {showOwnership && (
            <DropdownMenuItem onSelect={() => setDialog("ownership")}>
              Request ownership
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog === "suppress"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Do not contact</DialogTitle>
            <DialogDescription>
              Hides this client from the active working list and blocks outreach.
              {isAdmin
                ? " As an admin this takes effect immediately."
                : " An admin reviews this before it takes effect."}
            </DialogDescription>
          </DialogHeader>
          <SuppressButton
            defaultExpanded
            organisationId={organisationId}
            selfApproves={isAdmin}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "lift"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lift suppression</DialogTitle>
            <DialogDescription>
              Restores this client to the standard list and unblocks outreach.
            </DialogDescription>
          </DialogHeader>
          <LiftSuppressionButton
            defaultExpanded
            organisationId={organisationId}
            suppressionId={suppressionId}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "ownership"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request ownership</DialogTitle>
            <DialogDescription>
              Ownership stays where it is until an admin decides. Nothing changes when
              you submit this.
            </DialogDescription>
          </DialogHeader>
          <RequestOwnershipForm
            organisationId={organisationId}
            ownerName={ownerName}
            defaultOpen
            existingStatus={ownershipRequestStatus}
            decisionNote={ownershipDecisionNote}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
