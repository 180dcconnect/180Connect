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
import { cn } from "@/lib/utils";

const initialInviteState: InviteState = { status: "idle" };

const ROLE_OPTIONS = [
  {
    value: "cam",
    title: "CAM (Client Acquisition Manager)",
    badge: "Outreach & Pipeline",
    badgeStyle: "bg-emerald-50 text-emerald-800 border-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60",
    description:
      "For team members running outreach campaigns, claiming and managing client pipelines, drafting emails, and logging notes.",
  },
  {
    value: "admin",
    title: "Administrator",
    badge: "Full Access",
    badgeStyle: "bg-purple-50 text-purple-800 border-purple-200/80 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800/60",
    description:
      "Full administrative access to manage members, user roles, data imports, and system settings — includes all CAM client outreach and pipeline management capabilities.",
  },
  {
    value: "viewer",
    title: "Viewer",
    badge: "Read-only",
    badgeStyle: "bg-sky-50 text-sky-800 border-sky-200/80 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/60",
    description:
      "For stakeholders and observers who need read-only access to browse clients, metrics, and team activity without making changes.",
  },
] as const;

export function InviteForm() {
  const [state, formAction, pending] = useActionState(sendInviteAction, initialInviteState);
  const emailError = state.fieldErrors?.email?.[0];
  const [role, setRole] = useState("cam");

  const selectedRoleInfo = ROLE_OPTIONS.find((opt) => opt.value === role) ?? ROLE_OPTIONS[0];

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="invite-email" className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/70">
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
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="invite-role" className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/70">
          Role
        </label>
        <input type="hidden" name="role" value={role} />
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger id="invite-role" className="h-10 w-full bg-white">
            <SelectValue>{selectedRoleInfo.title}</SelectValue>
          </SelectTrigger>
          <SelectContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
            {ROLE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="py-2.5 px-3 cursor-pointer items-start">
                <div className="flex flex-col gap-1 text-left pr-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[13px] text-foreground">{opt.title}</span>
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide",
                        opt.badgeStyle,
                      )}
                    >
                      {opt.badge}
                    </span>
                  </div>
                  <span className="text-[11.5px] text-foreground/60 leading-normal font-normal">
                    {opt.description}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-0.5 text-[11.5px] leading-normal text-foreground/60">
          {selectedRoleInfo.description}
        </p>
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
