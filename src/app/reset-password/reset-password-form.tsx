"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  isInviteSetupComplete,
  type ResetPasswordState,
} from "@/lib/auth/password-reset";
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
import { BrandCtaButton } from "@/components/brand/brand-cta";
import { NewPasswordField, PasswordField } from "@/components/brand/password-field";
import {
  bannerClass,
  fieldClass,
  fieldErrorClass,
} from "@/components/brand/fields";

const initialState: ResetPasswordState = { status: "idle" };

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

export function ResetPasswordForm({
  linkError,
  isInvite,
  email,
  existingFullName,
  inviteTokenHash,
}: {
  linkError?: string;
  isInvite?: boolean;
  email?: string;
  existingFullName?: string | null;
  /**
   * Deferred invite token from the link, verified when this form submits —
   * opening the link must not consume it. Hidden and never rendered.
   */
  inviteTokenHash?: string;
}) {
  const [state, action, pending] = useActionState(setNewPassword, initialState);
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [fullName, setFullName] = useState(existingFullName ?? "");
  const needsName = !existingFullName;
  // Setting up an account asks for a name and the terms; coming back through a
  // forgot-password link does not. That person already has an account, already
  // agreed to the terms, and knows which address they asked to reset — showing
  // their own name and email back to them is noise on a form whose only job is
  // the two password fields. A recovery account that somehow has no name still
  // gets the field, because the Server Action refuses to finish without one.
  const showName = Boolean(isInvite) || needsName;
  const showEmail = Boolean(isInvite) && Boolean(email);
  const showTerms = Boolean(isInvite);
  const inviteSetupIncomplete =
    Boolean(isInvite) && !isInviteSetupComplete(fullName, acceptedTerms);

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
      {inviteTokenHash && <input type="hidden" name="tokenHash" value={inviteTokenHash} />}
      {state.message && (
        <div role="alert" className={bannerClass("light", "error")}>
          {state.message}
        </div>
      )}

      {showEmail && (
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

      {showName && (
        <div className="flex flex-col gap-1">
          <FloatingLabelInput
            id="fullName"
            name="fullName"
            type="text"
            autoComplete="name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
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
      )}

      <NewPasswordField
        id="password"
        name="password"
        label={isInvite ? "Password" : "New password"}
        value={password}
        onChange={setPassword}
        error={state.fieldErrors?.password?.[0]}
      />

      <div className="flex flex-col gap-1">
        <PasswordField
          id="confirmPassword"
          name="confirmPassword"
          label="Confirm password"
          invalid={Boolean(state.fieldErrors?.confirmPassword)}
        />
        {state.fieldErrors?.confirmPassword?.[0] && (
          <p className={fieldErrorClass("light")}>
            {state.fieldErrors.confirmPassword[0]}
          </p>
        )}
      </div>

      {/* Terms & Conditions — account setup only. A password reset is not a
          new agreement: the person accepted these when they set the account
          up, so asking again would be a gate with nothing behind it. */}
      {showTerms && (
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
                <PreviewLinkCardTrigger
                  render={
                    <Link
                      href="/terms"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 font-semibold text-[#0c1014] underline underline-offset-4 hover:opacity-80"
                    >
                      Terms &amp; Conditions
                    </Link>
                  }
                />
                <PagePreviewPanel href="/terms" title="Terms & Conditions" />
              </PreviewLinkCard>{" "}
              and{" "}
              <PreviewLinkCard>
                <PreviewLinkCardTrigger
                  render={
                    <Link
                      href="/privacy"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 font-semibold text-[#0c1014] underline underline-offset-4 hover:opacity-80"
                    >
                      Privacy Policy
                    </Link>
                  }
                />
                <PagePreviewPanel href="/privacy" title="Privacy Policy" />
              </PreviewLinkCard>
              .
            </span>
          </label>
        </div>
      )}

      <BrandCtaButton
        label={
          pending
            ? "Saving…"
            : isInvite
              ? "Create account"
              : "Set new password"
        }
        disabled={pending || inviteSetupIncomplete}
        className="mt-2 self-start"
      />
    </form>
  );
}
