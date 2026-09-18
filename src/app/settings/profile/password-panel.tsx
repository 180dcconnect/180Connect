"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { Check, Loader2 } from "lucide-react";
import { NewPasswordField, PasswordField } from "@/components/brand/password-field";
import { fieldErrorClass, fieldVars } from "@/components/brand/fields";
import type { ChangePasswordState } from "@/lib/auth/change-password";
import { changePasswordAction } from "./actions";
import {
  CARD,
  CARD_HINT,
  CARD_TITLE,
  FIELD_LABEL,
  FOOTNOTE,
  PRIMARY_BUTTON,
  QUIET_BUTTON,
  ROW,
  ROW_ACTION,
} from "../styles";

const initialState: ChangePasswordState = { status: "idle" };

/**
 * Change password, on the Profile & Account screen.
 *
 * Same read-first shape as `ProfilePanel`: a single row with a Change button,
 * opening in place into the form. The checklist is rendered from
 * `PASSWORD_RULES`, the list the server-side schema is built from, so what is
 * shown and what is enforced cannot drift.
 */
export function PasswordPanel() {
  const [state, setState] = useState<ChangePasswordState>(initialState);
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState("");
  const firstFieldRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing) firstFieldRef.current?.querySelector("input")?.focus();
  }, [editing]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      const result = await changePasswordAction(state, formData);
      setState(result);
      if (result.status === "success") {
        form.reset();
        setPassword("");
        setEditing(false);
      }
    });
  }

  function startEditing() {
    setState(initialState);
    setPassword("");
    setEditing(true);
  }

  function cancel() {
    setState(initialState);
    setPassword("");
    setEditing(false);
  }

  const errors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <section aria-labelledby="password-heading" className={CARD}>
      <h2 id="password-heading" className={CARD_TITLE}>
        Password
      </h2>
      <p className={CARD_HINT}>
        The password you sign in to 180Connect with.
      </p>

      {editing ? (
        <form
          onSubmit={handleSubmit}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
          noValidate
          // The floating labels cut the field border with the card's own colour.
          style={fieldVars("light", "#ffffff")}
          className="mt-4 flex flex-col gap-5 border-t border-rule-soft pt-5"
        >
          <div ref={firstFieldRef} className="flex flex-col gap-1">
            <PasswordField
              id="currentPassword"
              name="currentPassword"
              label="Current password"
              autoComplete="current-password"
              invalid={Boolean(errors?.currentPassword)}
            />
            {errors?.currentPassword?.[0] && (
              <p className={fieldErrorClass("light")}>{errors.currentPassword[0]}</p>
            )}
          </div>

          <NewPasswordField
            id="password"
            name="password"
            label="New password"
            value={password}
            onChange={setPassword}
            error={errors?.password?.[0]}
          />

          <div className="flex flex-col gap-1">
            <PasswordField
              id="confirmPassword"
              name="confirmPassword"
              label="Confirm new password"
              invalid={Boolean(errors?.confirmPassword)}
            />
            {errors?.confirmPassword?.[0] && (
              <p className={fieldErrorClass("light")}>{errors.confirmPassword[0]}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
            <button
              type="submit"
              disabled={pending}
              aria-busy={pending || undefined}
              className={PRIMARY_BUTTON}
            >
              {pending && <Loader2 className="size-3.5 animate-spin" strokeWidth={2.2} />}
              {pending ? "Changing…" : "Change password"}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={pending}
              className={QUIET_BUTTON}
            >
              Cancel
            </button>
            {/* Field-level errors already sit under their inputs; the summary
                line is for failures that belong to no single field. */}
            {state.status === "error" && state.message && !errors ? (
              <p aria-live="polite" className="text-[13px] font-semibold text-stop">
                {state.message}
              </p>
            ) : null}
          </div>
        </form>
      ) : (
        <dl className="mt-4">
          <div className={ROW}>
            <dt className={FIELD_LABEL}>Password</dt>
            <dd className="flex items-center gap-3 text-sm text-ink">
              <span aria-hidden="true" className="tracking-[0.2em] text-dim">
                ••••••••
              </span>
              <button type="button" onClick={startEditing} className={ROW_ACTION}>
                Change<span className="sr-only"> password</span>
              </button>
            </dd>
          </div>
        </dl>
      )}

      <div className="mt-4 border-t border-rule-soft pt-4">
        {state.status === "success" && !editing && state.message ? (
          <p
            aria-live="polite"
            className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-go"
          >
            <Check aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.5} />
            {state.message}
          </p>
        ) : null}
        <p className={FOOTNOTE}>
          Changing your password signs you out on every other device. Forgotten it?
          Sign out and use &ldquo;Forgot password&rdquo; on the login page.
        </p>
      </div>
    </section>
  );
}
