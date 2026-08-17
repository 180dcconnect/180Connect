"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/animate-ui/components/radix/dialog";
import { InviteForm } from "./invite-form";

export function InviteDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="group inline-flex shrink-0 items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
          type="button"
        >
          Invite a team member
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
          <DialogDescription>
            Send an email invitation for a new team member to join the workspace.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2">
          <InviteForm />
        </div>
      </DialogContent>
    </Dialog>
  );
}
