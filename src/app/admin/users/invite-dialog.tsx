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
import { OriginButton } from "@/components/ui/origin-button";
import { InviteForm } from "./invite-form";

export function InviteDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <OriginButton size="md" type="button">
          Invite a team member
        </OriginButton>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
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
