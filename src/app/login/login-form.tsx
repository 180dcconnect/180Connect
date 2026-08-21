"use client";

import { useActionState, useCallback, useState } from "react";
import type { LoginState } from "@/lib/auth/login";
import { login } from "./actions";
import {
  CAPTCHA_HINT_ID,
  TurnstileChallenge,
} from "@/components/turnstile-challenge";
import { BrandCtaButton } from "@/components/brand/brand-cta";
import {
  bannerClass,
  fieldClass,
  fieldErrorClass,
  fieldWithAffordanceClass,
  iconButtonClass,
  quietLinkClass,
  type FieldTone,
} from "@/components/brand/fields";
import {
  FloatingInput,
  FloatingLabel,
  FloatingLabelInput,
} from "@/components/spectrumui/floating-label-input";

const initialLoginState: LoginState = { status: "idle" };

export function LoginForm({
  tone = "light",
  onForgotPassword,
}: {
  tone?: FieldTone;
  /** Swaps the dialog to its reset panel rather than navigating away. */
  onForgotPassword: () => void;
}) {
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
      className="mt-8 flex flex-col gap-5"
      noValidate
    >
      {state.message && (
        <div
          role={state.status === "error" ? "alert" : "status"}
          className={bannerClass(
            tone,
            state.status === "pending" ? "pending" : "error",
          )}
        >
          {state.message}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <FloatingLabelInput
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          defaultValue={state.email}
          aria-invalid={Boolean(emailError)}
          aria-describedby={emailError ? "email-error" : undefined}
          className={fieldClass(tone)}
          label="Email address"
          required
        />
        {emailError && (
          <p id="email-error" className={fieldErrorClass(tone)}>
            {emailError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div className="relative">
          <FloatingInput
            id="password"
            name="password"
            type={passwordVisible ? "text" : "password"}
            autoComplete="current-password"
            aria-invalid={Boolean(passwordError)}
            aria-describedby={passwordError ? "password-error" : undefined}
            className={fieldWithAffordanceClass(tone)}
            required
          />
          <FloatingLabel htmlFor="password">Password</FloatingLabel>

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
            className={iconButtonClass(tone)}
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
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onForgotPassword}
            className={quietLinkClass(tone)}
          >
            Forgot password?
          </button>
        </div>
        {passwordError && (
          <p id="password-error" className={fieldErrorClass(tone)}>
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
        tone={tone}
      />

      {/* The page's one lime element. Same two-capsule CTA the landing page
          leads with, so signing in is visibly the same action as "Get Started". */}
      <BrandCtaButton
        label={pending ? "Logging in…" : "Log in"}
        disabled={pending || !solved}
        describedBy={solved ? undefined : CAPTCHA_HINT_ID}
        tone={tone === "dark" ? "sheet" : "glass"}
        className="mt-1 self-start"
      />
    </form>
  );
}
