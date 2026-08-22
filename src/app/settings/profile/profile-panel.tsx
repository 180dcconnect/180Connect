"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { OriginButton } from "@/components/ui/origin-button";
import { MAX_FULL_NAME_LENGTH } from "@/lib/account-settings";
import { saveAccountSettingsAction, type AccountSettingsState } from "./actions";

const initialState: AccountSettingsState = { status: "idle" };

const FIELD_LABEL =
  "text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40";

const ROW =
  "flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 py-5";

/**
 * The profile screen: a read-only view of what the team sees, with the one
 * editable field opening in place.
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
  role,
}: {
  initialFullName: string;
  email: string | null;
  role: string;
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
        // The stored value, echoed back by the action — not the raw keystrokes.
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
    setEditing(true);
  }

  function cancel() {
    setDraft(savedName);
    setEditing(false);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="rounded-2xl border border-black/[0.06] bg-white px-6 shadow-sm">
        <div className="border-b border-black/[0.06]">
          {editing ? (
            <div className="py-5">
              <label htmlFor="full_name" className={FIELD_LABEL}>
                Display name
              </label>
              <Input
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
                className="mt-2.5 bg-white"
              />
              <p
                id="full_name_hint"
                className="mt-2.5 text-sm leading-[1.7] text-foreground/65"
              >
                The name your team sees on clients you own and in the activity feed.
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <OriginButton type="submit" loading={pending} disabled={pending} size="sm">
                  {pending ? "Saving..." : "Save"}
                </OriginButton>
                <OriginButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={cancel}
                  disabled={pending}
                >
                  Cancel
                </OriginButton>
                {state.status === "error" && state.message ? (
                  <p aria-live="polite" className="text-sm font-bold text-destructive">
                    {state.message}
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className={ROW}>
              <span className={FIELD_LABEL}>Display name</span>
              <span className="flex items-center gap-3 text-sm text-foreground/85">
                {savedName.trim() || "Not set"}
                <button
                  type="button"
                  onClick={startEditing}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold text-brand transition-colors hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                  Edit<span className="sr-only"> display name</span>
                </button>
              </span>
            </div>
          )}
        </div>

        <dl>
          <div className={`${ROW} border-b border-black/[0.06]`}>
            <dt className={FIELD_LABEL}>Email</dt>
            <dd className="text-sm text-foreground/85">{email ?? "—"}</dd>
          </div>
          <div className={ROW}>
            <dt className={FIELD_LABEL}>Role</dt>
            <dd className="text-sm text-foreground/85">{role}</dd>
          </div>
        </dl>
      </div>

      <p className="mt-4 px-1 text-sm leading-[1.7] text-foreground/65">
        Your email is changed through your login details, and your role is set by
        an administrator — neither can be edited here.
      </p>

      {/* Success lives outside the row so it survives the switch back to view
          mode, where the edit form and its inline error are gone. */}
      {state.status === "success" && !editing && state.message ? (
        <p aria-live="polite" className="mt-3 px-1 text-sm font-bold text-brand">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
