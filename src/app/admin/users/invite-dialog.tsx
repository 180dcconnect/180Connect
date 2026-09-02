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
import { UserPlus } from "lucide-react";
import { OriginButton } from "@/components/ui/origin-button";
import { InviteForm } from "./invite-form";

export function InviteDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <OriginButton size="md" type="button" className="shadow-xs">
          <span className="flex items-center gap-2">
            <UserPlus className="size-4" />
            <span>Invite a team member</span>
          </span>
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
