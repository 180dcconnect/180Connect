"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  requestPasswordReset,
  type ForgotPasswordState,
} from "./actions";

const initialState: ForgotPasswordState = { status: "idle" };

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(
    requestPasswordReset,
    initialState,
  );
  const emailError = state.fieldErrors?.email?.[0];

  if (state.status === "success") {
    return (
      <div className="mt-8">
        <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm leading-relaxed text-green-900">
          {state.message}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-foreground/55">
          Check your spam folder too. The link can only be used once.
        </p>
        <Link href="/login" className="mt-6 block text-center text-sm font-bold text-brand underline-offset-4 hover:underline">
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="mt-8 flex flex-col gap-4" noValidate>
      {state.message && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
          {state.message}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-xs font-bold">Email address</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          defaultValue={state.email}
          aria-invalid={Boolean(emailError)}
          aria-describedby={emailError ? "email-error" : undefined}
          className="h-10 rounded-lg border border-black/10 bg-[#fafafa] px-3 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20 aria-invalid:border-red-500"
          required
        />
        {emailError && <p id="email-error" className="text-xs text-red-700">{emailError}</p>}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="mt-2 h-10 rounded-full bg-brand text-sm font-bold text-white hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Sending..." : "Send reset instructions"}
      </button>
      <Link href="/login" className="text-center text-xs text-foreground/55 underline-offset-4 hover:text-brand hover:underline">
        Back to log in
      </Link>
    </form>
  );
}

