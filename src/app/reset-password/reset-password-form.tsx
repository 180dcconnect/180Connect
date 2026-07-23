"use client";

import Link from "next/link";
import { useActionState } from "react";
import { setNewPassword, type ResetPasswordState } from "./actions";

const initialState: ResetPasswordState = { status: "idle" };

export function ResetPasswordForm({ linkError }: { linkError?: string }) {
  const [state, action, pending] = useActionState(setNewPassword, initialState);
  const message = linkError || state.message;

  if (linkError) {
    return (
      <div className="mt-8">
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{linkError}</div>
        <Link href="/forgot-password" className="mt-6 block text-center text-sm font-bold text-brand underline-offset-4 hover:underline">
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="mt-8 flex flex-col gap-4" noValidate>
      {message && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{message}</div>}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-xs font-bold">New password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" aria-invalid={Boolean(state.fieldErrors?.password)} className="h-10 rounded-lg border border-black/10 bg-[#fafafa] px-3 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20 aria-invalid:border-red-500" required />
        {state.fieldErrors?.password?.[0] && <p className="text-xs text-red-700">{state.fieldErrors.password[0]}</p>}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirmPassword" className="text-xs font-bold">Confirm new password</label>
        <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" aria-invalid={Boolean(state.fieldErrors?.confirmPassword)} className="h-10 rounded-lg border border-black/10 bg-[#fafafa] px-3 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20 aria-invalid:border-red-500" required />
        {state.fieldErrors?.confirmPassword?.[0] && <p className="text-xs text-red-700">{state.fieldErrors.confirmPassword[0]}</p>}
      </div>
      <p className="text-xs leading-relaxed text-foreground/55">Use 12 or more characters with uppercase, lowercase, and a number.</p>
      <button type="submit" disabled={pending} className="mt-2 h-10 rounded-full bg-brand text-sm font-bold text-white hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60">
        {pending ? "Updating..." : "Set new password"}
      </button>
    </form>
  );
}

