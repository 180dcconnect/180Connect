"use client";

import { useActionState } from "react";
import { sendInviteAction } from "./invite-actions";
import type { InviteState } from "@/lib/auth/invite";

const initialInviteState: InviteState = { status: "idle" };

export function InviteForm() {
  const [state, formAction, pending] = useActionState(sendInviteAction, initialInviteState);
  const emailError = state.fieldErrors?.email?.[0];

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
        <select
          id="invite-role"
          name="role"
          defaultValue="cam"
          className="h-10 rounded-lg border border-black/15 bg-white px-3 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20"
        >
          <option value="cam">CAM</option>
          <option value="admin">Admin</option>
          <option value="viewer">Viewer</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="mt-2 h-10 w-full rounded-lg bg-brand px-5 text-sm font-bold text-white transition-colors hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Sending..." : "Send invite"}
      </button>
      <p aria-live="polite" className="w-full min-h-5 text-sm font-bold">
        {emailError ? (
          <span className="text-red-700">{emailError}</span>
        ) : state.message ? (
          <span
            className={
              state.status === "error"
                ? "text-red-700"
                : // The account exists but no email went out. Amber rather than the
                  // success green, because the admin has to do something about it —
                  // the invited person is waiting for a link that never arrived.
                  state.status === "warning"
                  ? "text-amber-700"
                  : "text-brand"
            }
          >
            {state.message}
          </span>
        ) : null}
      </p>
    </form>
  );
}
