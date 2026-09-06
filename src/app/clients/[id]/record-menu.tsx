"use client";

import { useState } from "react";
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
 *
 * "View in inbox" is the exception to all of that: it navigates rather than
 * acting, so it sits above a separator, away from the three things that change
 * state. It needs no permission prop — /inbox/[orgId] is gated on `client:view`,
 * the same permission the record page itself required to render, so anyone who
 * can read this header can open the thread (app-shell.tsx gates the sidebar's
 * Inbox link on exactly the same check). The thread page handles an
 * organisation with no messages on its own, printing "No conversation history
 * yet", so the item does not need hiding on a record nobody has emailed —
 * an empty thread is a truthful answer to "what have we said to them", and it
 * is where you go to find out.
 *
 * It is a real `<Link>` inside the item rather than a router push on select,
 * because a menu row that navigates should support cmd-click and "open in new
 * tab" like any other link. The styled item cannot take `asChild` — the
 * primitive consumes it to render its own motion element — so the item drops
 * its padding and the anchor fills the row instead.
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

  // The menu always has at least "View in inbox", so there is no empty-list case
  // to guard against any more. `hasActions` only decides whether the separator
  // under it has anything to separate.
  const hasActions = showSuppress || showLift || showOwnership;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="More actions for this client"
          className="flex size-[30px] cursor-pointer items-center justify-center rounded-inset border border-rule bg-white text-dim transition-colors hover:bg-paper hover:text-ink focus-visible:ring-2 focus-visible:ring-lead-mid focus-visible:outline-none"
        >
          <MoreHorizontal aria-hidden="true" className="size-[15px]" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[13rem]">
          <DropdownMenuItem className="p-0">
            <Link
              className="flex w-full items-center px-2 py-1.5"
              href={`/inbox/${organisationId}`}
            >
              View in inbox
            </Link>
          </DropdownMenuItem>

          {hasActions && <DropdownMenuSeparator />}

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
