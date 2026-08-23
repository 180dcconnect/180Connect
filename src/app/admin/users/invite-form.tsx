"use client";

import { useActionState, useState } from "react";
import { OriginButton } from "@/components/ui/origin-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { sendInviteAction } from "./invite-actions";
import type { InviteState } from "@/lib/auth/invite";
import { InlineAlert } from "@/components/ui/inline-alert";

const initialInviteState: InviteState = { status: "idle" };

export function InviteForm() {
  const [state, formAction, pending] = useActionState(sendInviteAction, initialInviteState);
  const emailError = state.fieldErrors?.email?.[0];
  const [role, setRole] = useState("cam");

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="invite-email"
          className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/70"
        >
          Email address
        </label>
        <input
          id="invite-email"
          name="email"
          type="email"
          autoComplete="off"
          placeholder="name@180dc.org"
          aria-invalid={Boolean(emailError)}
          aria-describedby={emailError ? "invite-email-error" : undefined}
          className="h-10 w-full rounded-lg border border-black/15 bg-white px-3 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20 aria-invalid:border-red-500"
          required
        />
        {emailError && (
          <p id="invite-email-error" className="text-xs font-semibold text-red-600">
            {emailError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="invite-role"
          className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/70"
        >
          Role
        </label>
        <input type="hidden" name="role" value={role} />
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger id="invite-role" className="h-10 w-full bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cam">CAM (Client Acquisition Manager)</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="viewer">Viewer</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <OriginButton
        type="submit"
        disabled={pending}
        loading={pending}
        size="md"
        className="mt-2 w-full"
      >
        {pending ? "Sending..." : "Send invite"}
      </OriginButton>
      <div className="w-full min-h-5">
        {emailError ? (
          <InlineAlert message={emailError} />
        ) : state.status === "error" && state.message ? (
          <InlineAlert message={state.message} />
        ) : state.message ? (
          <InlineAlert
            tone={state.status === "warning" ? "warning" : "success"}
            message={state.message}
          />
        ) : null}
      </div>
    </form>
  );
}
