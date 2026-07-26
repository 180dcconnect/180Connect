"use client";

import Link from "next/link";
import { useActionState, useCallback, useEffect, useState } from "react";
import type { LoginState } from "@/lib/auth/login";
import { login } from "./actions";
import {
  CAPTCHA_HINT_ID,
  TurnstileChallenge,
} from "@/components/turnstile-challenge";

const initialLoginState: LoginState = { status: "idle" };

const inputClass =
  "h-10 rounded-lg border border-black/10 bg-[#fafafa] px-3 text-sm outline-none transition-colors placeholder:text-foreground/35 focus-visible:border-brand focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-brand/20 aria-invalid:border-red-500 aria-invalid:ring-2 aria-invalid:ring-red-500/20";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initialLoginState);
  const emailError = state.fieldErrors?.email?.[0];
  const passwordError = state.fieldErrors?.password?.[0];

  // Whether the visitor has passed the challenge. F003 AC1 requires the
  // CAPTCHA to pass *before* credentials are submitted, so this gates the
  // submit button — the server checks the token again regardless, but without
  // this the password leaves the browser on every blocked attempt.
  const [solved, setSolved] = useState(false);

  // A Turnstile token is single-use. Without this, a second attempt after any
  // failed one — wrong password, unapproved account, a validation error —
  // resubmits the spent token, and Supabase rejects it as a CAPTCHA failure no
  // matter what the user types. Reset the widget whenever an attempt comes back.
  useEffect(() => {
    if (state.status === "idle") return;
    window.turnstile?.reset();
  }, [state]);

  const onSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      // Belt and braces: the button is disabled, but a form can still be
      // submitted by pressing Enter inside a text field.
      if (!solved) {
        event.preventDefault();
        return;
      }
      // The token is spent by this submission, so close the gate again. The
      // effect above resets the widget once the attempt comes back, and
      // `onTurnstileSolved` reopens the gate when the fresh challenge passes.
      setSolved(false);
    },
    [solved],
  );

  return (
    <form
      action={formAction}
      onSubmit={onSubmit}
      className="mt-8 flex flex-col gap-4"
      noValidate
    >
      {state.message && (
        <div
          role={state.status === "error" ? "alert" : "status"}
          className={`rounded-lg border px-3 py-2.5 text-xs leading-relaxed ${
            state.status === "pending"
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {state.message}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-xs font-bold">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          defaultValue={state.email}
          aria-invalid={Boolean(emailError)}
          aria-describedby={emailError ? "email-error" : undefined}
          placeholder="name@180dc.org"
          className={inputClass}
          required
        />
        {emailError && (
          <p id="email-error" className="text-xs text-red-700">
            {emailError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <label htmlFor="password" className="text-xs font-bold">
            Password
          </label>
          <Link
            href="/forgot-password"
            className="text-xs text-foreground/50 underline-offset-4 hover:text-brand hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={Boolean(passwordError)}
          aria-describedby={passwordError ? "password-error" : undefined}
          placeholder="Enter your password"
          className={inputClass}
          required
        />
        {passwordError && (
          <p id="password-error" className="text-xs text-red-700">
            {passwordError}
          </p>
        )}
      </div>

      <TurnstileChallenge
        solved={solved}
        onSolvedChange={setSolved}
        action="log in"
        gerund="logging in"
      />

      <button
        type="submit"
        disabled={pending || !solved}
        aria-describedby={solved ? undefined : CAPTCHA_HINT_ID}
        className="mt-2 h-10 rounded-full bg-brand text-sm font-bold text-white transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Logging in..." : "Log in"}
      </button>
    </form>
  );
}
