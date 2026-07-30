"use client";

import Link from "next/link";
import { useActionState, useCallback, useState } from "react";
import type { LoginState } from "@/lib/auth/login";
import { login } from "./actions";
import {
  CAPTCHA_HINT_ID,
  TurnstileChallenge,
} from "@/components/turnstile-challenge";

const initialLoginState: LoginState = { status: "idle" };

const inputBase =
  "h-10 rounded-lg border border-black/10 bg-[#fafafa] text-sm outline-none transition-colors placeholder:text-foreground/35 focus-visible:border-brand focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-brand/20 aria-invalid:border-red-500 aria-invalid:ring-2 aria-invalid:ring-red-500/20";

const inputClass = `${inputBase} px-3`;

// The password field carries a reveal button inside its right edge, so its
// padding is written per-side. Appending `pr-10` to `inputClass` would leave two
// competing utilities and depend on Tailwind's output order to resolve them.
const passwordInputClass = `${inputBase} w-full pl-3 pr-10`;

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initialLoginState);
  const emailError = state.fieldErrors?.email?.[0];
  const passwordError = state.fieldErrors?.password?.[0];

  // Whether the visitor has passed the challenge. F003 AC1 requires the
  // CAPTCHA to pass *before* credentials are submitted, so this gates the
  // submit button — the server checks the token again regardless, but without
  // this the password leaves the browser on every blocked attempt.
  const [solved, setSolved] = useState(false);

  // Reveal is deliberately not persisted anywhere. It resets on every render of a
  // fresh form, so a password never comes back visible on a shared machine.
  const [passwordVisible, setPasswordVisible] = useState(false);

  const onSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      // Belt and braces: the button is disabled, but a form can still be
      // submitted by pressing Enter inside a text field.
      if (!solved) {
        event.preventDefault();
        return;
      }
      // The token is spent by this submission, so close the gate again.
      // `resetKey` below starts a fresh challenge once the attempt comes back,
      // which reopens the gate when it passes.
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
        <div className="relative flex">
          <input
            id="password"
            name="password"
            type={passwordVisible ? "text" : "password"}
            autoComplete="current-password"
            aria-invalid={Boolean(passwordError)}
            aria-describedby={passwordError ? "password-error" : undefined}
            placeholder="Enter your password"
            className={passwordInputClass}
            required
          />
          {/*
            type="button" is load-bearing: a bare <button> inside a form defaults
            to submit, so revealing the password would post the form instead.

            The label names the action rather than the state ("Show password", not
            "Password hidden"), which is what a screen reader user needs to decide
            whether to press it. aria-pressed is left off on purpose — paired with
            a label that already changes, it announces twice and contradicts itself.
          */}
          <button
            type="button"
            onClick={() => setPasswordVisible((visible) => !visible)}
            aria-label={passwordVisible ? "Hide password" : "Show password"}
            aria-controls="password"
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-foreground/45 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {passwordVisible ? (
              // Eye with a slash — pressing it hides the password again.
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 3l18 18" />
                <path d="M10.6 10.6a2 2 0 002.8 2.8" />
                <path d="M9.4 5.2A9.4 9.4 0 0112 5c4.6 0 8.3 3.2 9.6 7a12 12 0 01-2.4 3.9" />
                <path d="M6.2 6.7A12 12 0 002.4 12c1.3 3.8 5 7 9.6 7a9.7 9.7 0 004-.85" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M2.4 12C3.7 8.2 7.4 5 12 5s8.3 3.2 9.6 7c-1.3 3.8-5 7-9.6 7s-8.3-3.2-9.6-7Z" />
                <circle cx="12" cy="12" r="2.6" />
              </svg>
            )}
          </button>
        </div>
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
        resetKey={state}
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
