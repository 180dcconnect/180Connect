"use client";

import { useState } from "react";
import { PASSWORD_RULES } from "@/lib/auth/password-rules";
import {
  FloatingInput,
  FloatingLabel,
} from "@/components/spectrumui/floating-label-input";
import { PasswordStrengthMeter } from "@/components/spectrumui/password-strength";
import {
  fieldErrorClass,
  fieldWithAffordanceClass,
  iconButtonClass,
  type FieldTone,
} from "@/components/brand/fields";

/**
 * The password field from account setup (`/reset-password`), shared so the
 * change-password panel in settings looks and behaves the same: floating label,
 * pill field, eye toggle.
 *
 * The floating label cuts the field's top border with the colour its surface
 * sets through `fieldVars` — the surface this lands on must set them.
 */
export function PasswordField({
  id,
  name,
  label,
  value,
  onChange,
  autoComplete = "new-password",
  invalid = false,
  describedBy,
  tone = "light",
}: {
  id: string;
  name: string;
  label: string;
  /** Omit for an uncontrolled field. */
  value?: string;
  onChange?: (value: string) => void;
  autoComplete?: string;
  invalid?: boolean;
  describedBy?: string;
  tone?: FieldTone;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <FloatingInput
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        className={fieldWithAffordanceClass(tone)}
        required
      />
      <FloatingLabel htmlFor={id}>{label}</FloatingLabel>

      <button
        type="button"
        onClick={() => setVisible((shown) => !shown)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-controls={id}
        className={iconButtonClass(tone)}
      >
        {visible ? (
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
  );
}

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
export function PasswordChecklist({ value }: { value: string }) {
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

/**
 * A new-password field with the strength meter and rule checklist under it —
 * the whole block from account setup.
 */
export function NewPasswordField({
  id,
  name,
  label,
  value,
  onChange,
  error,
  tone = "light",
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  tone?: FieldTone;
}) {
  const requirementsId = `${id}-requirements`;
  return (
    <div className="flex flex-col gap-1">
      <PasswordField
        id={id}
        name={name}
        label={label}
        value={value}
        onChange={onChange}
        invalid={Boolean(error)}
        describedBy={requirementsId}
        tone={tone}
      />

      <PasswordStrengthMeter
        value={value}
        rules={PASSWORD_RULES as unknown as Parameters<typeof PasswordStrengthMeter>[0]["rules"]}
      />

      <div id={requirementsId} className="mt-1">
        <PasswordChecklist value={value} />
        {error && <p className={fieldErrorClass(tone)}>{error}</p>}
      </div>
    </div>
  );
}
