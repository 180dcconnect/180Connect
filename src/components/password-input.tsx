"use client";

import { useState } from "react";

/**
 * A password field with a show/hide toggle.
 *
 * Revealing the value is the reliable way to recover from a typo in a field
 * that is masked and has no "did you mean" — particularly on the reset form,
 * where a mistyped password becomes the one the user then cannot log in with.
 *
 * The toggle is a real `<button type="button">`: inside a form, a bare
 * `<button>` defaults to `submit` and would post the form instead. It is
 * reachable by keyboard and names the action it will perform rather than the
 * current state, which is what a screen reader needs to hear.
 *
 * Styled in the app's Filed Record tokens (`docs/app-design-system.md`) — it
 * is used inside settings, after sign-in.
 */
export function PasswordInput({
  id,
  name,
  value,
  onChange,
  autoComplete = "new-password",
  invalid = false,
  describedBy,
  required = false,
}: {
  id: string;
  name: string;
  /** Omit for an uncontrolled field. */
  value?: string;
  onChange?: (value: string) => void;
  autoComplete?: string;
  invalid?: boolean;
  describedBy?: string;
  required?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        required={required}
        // Room on the right so the value never runs under the toggle.
        className="h-10 w-full rounded-inset border border-rule bg-white pr-16 pl-3 text-sm text-ink outline-none focus-visible:border-lead focus-visible:ring-2 focus-visible:ring-lead/20 aria-invalid:border-stop"
      />
      <button
        type="button"
        onClick={() => setVisible((shown) => !shown)}
        aria-controls={id}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex items-center rounded-r-inset px-3 text-[13px] font-medium text-dim transition-colors hover:text-lead focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead"
      >
        {visible ? "Hide" : "Show"}
      </button>
    </div>
  );
}
