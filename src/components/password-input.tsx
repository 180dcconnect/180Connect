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
        className="h-10 w-full rounded-lg border border-black/10 bg-[#fafafa] pl-3 pr-16 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20 aria-invalid:border-red-500"
      />
      <button
        type="button"
        onClick={() => setVisible((shown) => !shown)}
        aria-controls={id}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex items-center rounded-r-lg px-3 text-xs font-bold text-foreground/55 transition-colors hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {visible ? "Hide" : "Show"}
      </button>
    </div>
  );
}
