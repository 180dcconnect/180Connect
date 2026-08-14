"use client";

import { useActionState, useCallback, useState } from "react";

import { BrandCtaButton } from "@/components/brand/brand-cta";
import {
  bannerClass,
  fieldClass,
  fieldErrorClass,
  quietLinkClass,
  type FieldTone,
} from "@/components/brand/fields";
import { FloatingLabelInput } from "@/components/spectrumui/floating-label-input";
import {
  CAPTCHA_HINT_ID,
  TurnstileChallenge,
} from "@/components/turnstile-challenge";
import type { ForgotPasswordState } from "@/lib/auth/password-reset";
import { requestPasswordReset } from "./actions";

const initialState: ForgotPasswordState = { status: "idle" };

export function ForgotPasswordForm({
  tone = "light",
  onBack,
}: {
  tone?: FieldTone;
  /** Swaps the dialog back to its sign-in panel rather than navigating away. */
  onBack: () => void;
}) {
  const [state, action, pending] = useActionState(
    requestPasswordReset,
    initialState,
  );
  const emailError = state.fieldErrors?.email?.[0];

  // This form makes the server send mail, so it is CAPTCHA-gated exactly as
  // login is (F003). The server checks the token again regardless.
  const [solved, setSolved] = useState(false);

  const onSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      // The button is disabled, but Enter inside a text field still submits.
      if (!solved) {
        event.preventDefault();
        return;
      }
      setSolved(false);
    },
    [solved],
  );

  if (state.status === "success") {
    return (
      <div className="mt-8">
        <div role="status" className={bannerClass(tone, "success")}>
          {state.message}
        </div>
        <p
          className={`mt-3 font-body text-xs leading-relaxed ${
            tone === "dark" ? "text-[#f4f4ef]/50" : "text-[#0c1014]/50"
          }`}
        >
          Check your spam folder too. The link can only be used once.
        </p>
        <button
          type="button"
          onClick={onBack}
          className={`mt-6 ${quietLinkClass(tone)}`}
        >
          Back to log in
        </button>
      </div>
    );
  }

  return (
    <form
      action={action}
      onSubmit={onSubmit}
      className="mt-8 flex flex-col gap-5"
      noValidate
    >
      {state.message && (
        <div role="alert" className={bannerClass(tone, "error")}>
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

      <TurnstileChallenge
        solved={solved}
        onSolvedChange={setSolved}
        action="send reset instructions"
        gerund="sending reset instructions"
        resetKey={state}
        tone={tone}
      />

      <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-3">
        <BrandCtaButton
          label={pending ? "Sending…" : "Send instructions"}
          disabled={pending || !solved}
          describedBy={solved ? undefined : CAPTCHA_HINT_ID}
          tone={tone === "dark" ? "sheet" : "glass"}
        />
        <button type="button" onClick={onBack} className={quietLinkClass(tone)}>
          Back to log in
        </button>
      </div>
    </form>
  );
}
