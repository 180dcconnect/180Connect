"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { Check, Loader2 } from "lucide-react";
import { MAX_FULL_NAME_LENGTH } from "@/lib/account-settings";
import { saveAccountSettingsAction, type AccountSettingsState } from "./actions";
import {
  CARD,
  CARD_HINT,
  CARD_TITLE,
  FIELD_LABEL,
  FOOTNOTE,
  INPUT,
  PRIMARY_BUTTON,
  QUIET_BUTTON,
  ROW,
  ROW_ACTION,
} from "../styles";

const initialState: AccountSettingsState = { status: "idle" };

/**
 * The profile and account settings screen (F200 / F201):
 * - Displays name, role and email
 * - Lets the user update their display name in place
 *
 * Notification delivery frequency is deliberately not here (F178): it lives on
 * its own screen (/settings/notifications), which is the one place it is set —
 * the rail's Notifications row sits right next to this page.
 *
 * Read-first rather than a form that happens to be pre-filled. Someone opening
 * this screen is nearly always checking their details, not changing them, and a
 * page of live inputs makes the common case look like unsaved work. Email and
 * role never get an edit affordance at all — F200 AC2 keeps them off this
 * screen, so offering a disabled control for them would advertise something
 * that is not on the menu.
 */
export function ProfilePanel({
  initialFullName,
  email,
  roleLabel,
  roleDescription,
}: {
  initialFullName: string;
  email: string | null;
  roleLabel: string;
  /** What the role can do — the invite sheet's copy for it. */
  roleDescription: string | null;
}) {
  // Submitted through `useTransition` rather than `useActionState`, because
  // this form has to *do* something when the action returns — close the row and
  // adopt the saved name. With `useActionState` that reaction can only live in
  // an effect watching the result, which is a cascading render; here it is just
  // the rest of the submit handler.
  const [state, setState] = useState<AccountSettingsState>(initialState);
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [savedName, setSavedName] = useState(initialFullName);
  const [draft, setDraft] = useState(initialFullName);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await saveAccountSettingsAction(state, formData);
      setState(result);
      if (result.status === "success") {
        // The stored name, echoed back by the action — not the raw keystrokes.
        setSavedName(result.fullName ?? draft);
        setEditing(false);
      }
    });
  }

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function startEditing() {
    setDraft(savedName);
    setState(initialState);
    setEditing(true);
  }

  function cancel() {
    setDraft(savedName);
    setEditing(false);
  }

  return (
    <section aria-labelledby="profile-heading" className={CARD}>
      <h2 id="profile-heading" className={CARD_TITLE}>
        Your details
      </h2>
      <p className={CARD_HINT}>
        How you appear to the team — on clients you own and in the activity feed.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-4">
        {editing ? (
          <div className="border-t border-rule-soft pt-4">
            <label htmlFor="full_name" className={FIELD_LABEL}>
              Display name
            </label>
            <input
              ref={inputRef}
              id="full_name"
              name="full_name"
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancel();
                }
              }}
              maxLength={MAX_FULL_NAME_LENGTH}
              autoComplete="name"
              required
              aria-invalid={state.status === "error" || undefined}
              aria-describedby="full_name_hint"
              className={`mt-2 ${INPUT}`}
            />
            <p id="full_name_hint" className="mt-2 text-[13px] leading-[1.55] text-dim">
              Up to {MAX_FULL_NAME_LENGTH} characters. Press Esc to cancel.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
              <button
                type="submit"
                disabled={pending}
                aria-busy={pending || undefined}
                className={PRIMARY_BUTTON}
              >
                {pending && <Loader2 className="size-3.5 animate-spin" strokeWidth={2.2} />}
                {pending ? "Saving…" : "Save name"}
              </button>
              <button
                type="button"
                onClick={cancel}
                disabled={pending}
                className={QUIET_BUTTON}
              >
                Cancel
              </button>
              {state.status === "error" && state.message ? (
                <p aria-live="polite" className="text-[13px] font-semibold text-stop">
                  {state.message}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <dl>
            <div className={ROW}>
              <dt className={FIELD_LABEL}>Display name</dt>
              <dd className="flex items-center gap-3 text-sm text-ink">
                {savedName.trim() || <span className="text-faint">Not set</span>}
                <button type="button" onClick={startEditing} className={ROW_ACTION}>
                  Edit<span className="sr-only"> display name</span>
                </button>
              </dd>
            </div>
            <div className={ROW}>
              <dt className={FIELD_LABEL}>Email</dt>
              <dd className="text-sm text-ink">{email ?? "—"}</dd>
            </div>
            <div className={`${ROW} items-start`}>
              <dt className="min-w-0 flex-1">
                <span className={FIELD_LABEL}>Role</span>
                {roleDescription && (
                  <span className="mt-1 block text-[13px] leading-[1.55] text-dim">
                    {roleDescription}
                  </span>
                )}
              </dt>
              <dd className="text-sm text-ink">{roleLabel}</dd>
            </div>
          </dl>
        )}
      </form>

      <div className="mt-4 border-t border-rule-soft pt-4">
        {/* Success lives outside the form so it survives the switch back to
            view mode, where the edit form and its inline error are gone. */}
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
          Your email is changed through your login details, and your role is set
          by an administrator — neither can be edited here. Notification delivery
          is set under Notifications.
        </p>
      </div>
    </section>
  );
}
