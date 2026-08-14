"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { PASSWORD_RULES } from "@/lib/auth/password-rules";
import type { ResetPasswordState } from "@/lib/auth/password-reset";
import { setNewPassword } from "./actions";
import {
  FloatingInput,
  FloatingLabel,
  FloatingLabelInput,
} from "@/components/spectrumui/floating-label-input";
import { Checkbox } from "@/components/animate-ui/components/radix/checkbox";
import {
  PreviewLinkCard,
  PreviewLinkCardTrigger,
  PreviewLinkCardPanel,
} from "@/components/animate-ui/components/base/preview-link-card";
import { PasswordStrengthMeter } from "@/components/spectrumui/password-strength";
import { BrandCtaButton } from "@/components/brand/brand-cta";
import {
  bannerClass,
  fieldClass,
  fieldErrorClass,
  fieldWithAffordanceClass,
  iconButtonClass,
} from "@/components/brand/fields";

const initialState: ResetPasswordState = { status: "idle" };

/**
 * Live checklist of the password rules.
 *
 * Rendered from `PASSWORD_RULES`, the same list `passwordSchema` is built from,
 * so what the user is told and what the server enforces cannot drift apart.
 *
 * The list is always present rather than appearing on first keystroke: a
 * checklist that materialises under the cursor shifts the layout and is easy to
 * miss. Each item carries its state in text for screen readers, since colour
 * and a tick glyph alone do not convey it.
 */
/**
 * Live preview of a real route, shrunk to fit the panel.
 *
 * Renders the actual page in an iframe at full size and scales the whole
 * thing down with a CSS transform, so what the user sees is the page itself
 * (not a hand-written blurb that can drift from what the page actually says).
 */
const PREVIEW_PAGE_WIDTH = 1280;
const PREVIEW_PAGE_HEIGHT = 832;
const PREVIEW_SCALE = 0.25;

function PagePreviewPanel({ href, title }: { href: string; title: string }) {
  return (
    <PreviewLinkCardPanel
      className="w-80 overflow-hidden rounded-xl border border-[#0c1014]/10 bg-white p-0 shadow-xl"
      style={{ height: PREVIEW_PAGE_HEIGHT * PREVIEW_SCALE }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none origin-top-left"
        style={{
          width: PREVIEW_PAGE_WIDTH,
          height: PREVIEW_PAGE_HEIGHT,
          transform: `scale(${PREVIEW_SCALE})`,
        }}
      >
        <iframe
          src={href}
          tabIndex={-1}
          title={`${title} preview`}
          loading="lazy"
          className="h-full w-full border-0"
        />
      </div>
    </PreviewLinkCardPanel>
  );
}

function PasswordChecklist({ value }: { value: string }) {
  return (
    <ul className="flex flex-col gap-1.5 pt-1" aria-label="Password requirements">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(value);
        return (
          <li
            key={rule.id}
            className={`flex items-center gap-2 text-xs font-body transition-colors ${
              met ? "text-green-700" : "text-[#0c1014]/50"
            }`}
          >
            <span
              aria-hidden="true"
              className={`flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] leading-none transition-colors ${
                met
                  ? "border-green-600 bg-green-600 text-white"
                  : "border-[#0c1014]/20 text-transparent"
              }`}
            >
              ✓
            </span>
            {rule.label}
            <span className="sr-only">{met ? " — met" : " — not yet met"}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function ResetPasswordForm({
  linkError,
  isInvite,
  email,
  existingFullName,
}: {
  linkError?: string;
  isInvite?: boolean;
  email?: string;
  existingFullName?: string | null;
}) {
  const [state, action, pending] = useActionState(setNewPassword, initialState);
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const needsName = !existingFullName;

  if (linkError) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <div role="alert" className={bannerClass("light", "error")}>
          {linkError}
        </div>
        {isInvite ? (
          // No self-service path for an invite: only an admin can send another
          // one (F252), so there is nothing to link to here.
          <p className="text-center font-body text-xs text-[#0c1014]/50">
            Contact your administrator for a new invite.
          </p>
        ) : (
          <Link
            href="/forgot-password"
            className="block text-center font-body text-xs font-bold text-[#0c1014] underline underline-offset-4 hover:opacity-80"
          >
            Request a new link
          </Link>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="mt-6 flex flex-col gap-5" noValidate>
      {state.message && (
        <div role="alert" className={bannerClass("light", "error")}>
          {state.message}
        </div>
      )}

      {email && (
        <div className="flex flex-col gap-1">
          <div className="relative">
            <FloatingInput
              id="email"
              name="email"
              type="email"
              value={email}
              readOnly
              className={`${fieldClass("light")} cursor-not-allowed text-[#0c1014]/80`}
            />
            <FloatingLabel htmlFor="email">Email address</FloatingLabel>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <FloatingLabelInput
          id="fullName"
          name="fullName"
          type="text"
          autoComplete="name"
          defaultValue={existingFullName ?? ""}
          aria-invalid={Boolean(state.fieldErrors?.fullName)}
          className={fieldClass("light")}
          label="Your name"
          required={needsName}
          maxLength={120}
        />
        {state.fieldErrors?.fullName?.[0] && (
          <p className={fieldErrorClass("light")}>
            {state.fieldErrors.fullName[0]}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div className="relative">
          <FloatingInput
            id="password"
            name="password"
            type={passwordVisible ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={Boolean(state.fieldErrors?.password)}
            aria-describedby="password-requirements"
            className={fieldWithAffordanceClass("light")}
            required
          />
          <FloatingLabel htmlFor="password">
            {isInvite ? "Password" : "New password"}
          </FloatingLabel>

          <button
            type="button"
            onClick={() => setPasswordVisible((visible) => !visible)}
            aria-label={passwordVisible ? "Hide password" : "Show password"}
            aria-controls="password"
            className={iconButtonClass("light")}
          >
            {passwordVisible ? (
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

        {/* Animated Password Strength Bar */}
        <PasswordStrengthMeter value={password} rules={PASSWORD_RULES as unknown as Parameters<typeof PasswordStrengthMeter>[0]["rules"]} />

        <div id="password-requirements" className="mt-1">
          <PasswordChecklist value={password} />
          {state.fieldErrors?.password?.[0] && (
            <p className={fieldErrorClass("light")}>
              {state.fieldErrors.password[0]}
            </p>
          )}
        </div>
      </div>


      <div className="flex flex-col gap-1">
        <div className="relative">
          <FloatingInput
            id="confirmPassword"
            name="confirmPassword"
            type={confirmPasswordVisible ? "text" : "password"}
            aria-invalid={Boolean(state.fieldErrors?.confirmPassword)}
            className={fieldWithAffordanceClass("light")}
            required
          />
          <FloatingLabel htmlFor="confirmPassword">
            Confirm password
          </FloatingLabel>

          <button
            type="button"
            onClick={() => setConfirmPasswordVisible((visible) => !visible)}
            aria-label={
              confirmPasswordVisible ? "Hide password" : "Show password"
            }
            aria-controls="confirmPassword"
            className={iconButtonClass("light")}
          >
            {confirmPasswordVisible ? (
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

        {state.fieldErrors?.confirmPassword?.[0] && (
          <p className={fieldErrorClass("light")}>
            {state.fieldErrors.confirmPassword[0]}
          </p>
        )}
      </div>

      {/* Terms & Conditions Checkbox with PreviewLinkCard */}
      <div className="pt-1">
        <label htmlFor="terms" className="flex items-center gap-3 cursor-pointer select-none font-body text-xs leading-snug text-[#0c1014]/75">
          <Checkbox
            id="terms"
            name="terms"
            checked={acceptedTerms}
            onCheckedChange={(checked) => setAcceptedTerms(Boolean(checked))}
            required
            className="border-[#0c1014]/30 data-[state=checked]:bg-[#0c1014] data-[state=checked]:text-[#f4f4ef]"
          />
          <span>
            I agree to the{" "}
            <PreviewLinkCard>
              <PreviewLinkCardTrigger asChild>
                <Link
                  href="/terms"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 font-semibold text-[#0c1014] underline underline-offset-4 hover:opacity-80"
                >
                  Terms &amp; Conditions
                </Link>
              </PreviewLinkCardTrigger>
              <PagePreviewPanel href="/terms" title="Terms & Conditions" />
            </PreviewLinkCard>{" "}
            and{" "}
            <PreviewLinkCard>
              <PreviewLinkCardTrigger asChild>
                <Link
                  href="/privacy"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 font-semibold text-[#0c1014] underline underline-offset-4 hover:opacity-80"
                >
                  Privacy Policy
                </Link>
              </PreviewLinkCardTrigger>
              <PagePreviewPanel href="/privacy" title="Privacy Policy" />
            </PreviewLinkCard>
            .
          </span>
        </label>
      </div>

      <BrandCtaButton
        label={
          pending
            ? "Saving…"
            : isInvite
              ? "Create account"
              : "Set new password"
        }
        disabled={pending || !acceptedTerms}
        className="mt-2 self-start"
      />
    </form>
  );
}

