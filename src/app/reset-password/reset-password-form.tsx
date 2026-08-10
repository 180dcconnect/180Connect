"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { PasswordInput } from "@/components/password-input";
import { PASSWORD_RULES } from "@/lib/auth/password-rules";
import type { ResetPasswordState } from "@/lib/auth/password-reset";
import { setNewPassword } from "./actions";

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
function PasswordChecklist({ value }: { value: string }) {
  return (
    <ul className="flex flex-col gap-1" aria-label="Password requirements">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(value);
        return (
          <li
            key={rule.id}
            className={`flex items-center gap-2 text-xs transition-colors ${
              met ? "text-green-700" : "text-foreground/55"
            }`}
          >
            <span
              aria-hidden="true"
              className={`flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] leading-none transition-colors ${
                met
                  ? "border-green-600 bg-green-600 text-white"
                  : "border-black/20 text-transparent"
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
  existingFullName,
}: {
  linkError?: string;
  existingFullName?: string | null;
}) {
  const [state, action, pending] = useActionState(setNewPassword, initialState);
  const [password, setPassword] = useState("");
  const needsName = !existingFullName;

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
      {state.message && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{state.message}</div>}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="fullName" className="text-xs font-bold">Your name</label>
        <input
          id="fullName"
          name="fullName"
          type="text"
          autoComplete="name"
          defaultValue={existingFullName ?? ""}
          aria-invalid={Boolean(state.fieldErrors?.fullName)}
          required={needsName}
          maxLength={120}
          className="h-10 w-full rounded-lg border border-black/10 bg-[#fafafa] px-3 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20 aria-invalid:border-red-500"
        />
        {state.fieldErrors?.fullName?.[0] && <p className="text-xs text-red-700">{state.fieldErrors.fullName[0]}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-xs font-bold">New password</label>
        <PasswordInput
          id="password"
          name="password"
          value={password}
          onChange={setPassword}
          invalid={Boolean(state.fieldErrors?.password)}
          describedBy="password-requirements"
          required
        />
      </div>

      <div id="password-requirements">
        <PasswordChecklist value={password} />
        {/* The checklist covers the rules; this carries anything else the
            server rejected the password for, such as exceeding the maximum. */}
        {state.fieldErrors?.password?.[0] && (
          <p className="mt-2 text-xs text-red-700">{state.fieldErrors.password[0]}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirmPassword" className="text-xs font-bold">Confirm new password</label>
        <PasswordInput
          id="confirmPassword"
          name="confirmPassword"
          invalid={Boolean(state.fieldErrors?.confirmPassword)}
          required
        />
        {state.fieldErrors?.confirmPassword?.[0] && <p className="text-xs text-red-700">{state.fieldErrors.confirmPassword[0]}</p>}
      </div>

      <button type="submit" disabled={pending} className="mt-2 h-10 rounded-full bg-brand text-sm font-bold text-white hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60">
        {pending ? "Updating..." : "Set new password"}
      </button>
    </form>
  );
}
