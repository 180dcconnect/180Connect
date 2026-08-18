"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { OriginButton } from "@/components/ui/origin-button";
import {
  MAX_FULL_NAME_LENGTH,
  NOTIFICATION_FREQUENCIES,
  NOTIFICATION_FREQUENCY_LABELS,
  NOTIFICATION_FREQUENCY_DESCRIPTIONS,
  type NotificationFrequency,
} from "@/lib/account-settings";
import { saveAccountSettingsAction, type AccountSettingsState } from "./actions";

const initialState: AccountSettingsState = { status: "idle" };

const FIELD_LABEL =
  "text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40";

const ROW =
  "flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 py-5";

/**
 * The profile and account settings screen (F200 / F201):
 * - Displays name and role/email
 * - Lets user update display name and notification delivery frequency in place
 */
export function ProfilePanel({
  initialFullName,
  initialNotificationFrequency = "immediate",
  email,
  role,
}: {
  initialFullName: string;
  initialNotificationFrequency?: NotificationFrequency;
  email: string | null;
  role: string;
}) {
  const [state, setState] = useState<AccountSettingsState>(initialState);
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [savedName, setSavedName] = useState(initialFullName);
  const [draft, setDraft] = useState(initialFullName);
  const [savedFrequency, setSavedFrequency] = useState<NotificationFrequency>(initialNotificationFrequency);
  const [draftFrequency, setDraftFrequency] = useState<NotificationFrequency>(initialNotificationFrequency);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await saveAccountSettingsAction(state, formData);
      setState(result);
      if (result.status === "success") {
        setSavedName(result.fullName ?? draft);
        setSavedFrequency(result.notificationFrequency ?? draftFrequency);
        setEditing(false);
      }
    });
  }

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function startEditing() {
    setDraft(savedName);
    setDraftFrequency(savedFrequency);
    setState(initialState);
    setEditing(true);
  }

  function cancel() {
    setDraft(savedName);
    setDraftFrequency(savedFrequency);
    setEditing(false);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="rounded-2xl border border-black/[0.06] bg-white px-6 shadow-sm">
        {editing ? (
          <div className="py-6 space-y-6">
            <div>
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
            </div>

            <fieldset className="border-t border-black/[0.06] pt-6">
              <legend className={FIELD_LABEL}>Notification delivery frequency (F201 / F178)</legend>
              <p className="mt-1 text-sm leading-[1.7] text-foreground/65">
                Choose how often the platform delivers notifications, digest alerts, and follow-up reminders.
              </p>
              <div className="mt-3 space-y-2">
                {NOTIFICATION_FREQUENCIES.map((freq) => (
                  <label
                    key={freq}
                    htmlFor={`freq-${freq}`}
                    className={`flex cursor-pointer select-none items-start gap-3 rounded-xl border p-3.5 transition-colors ${
                      draftFrequency === freq
                        ? "border-brand bg-brand/5"
                        : "border-black/[0.08] bg-white hover:border-black/20"
                    }`}
                  >
                    <input
                      type="radio"
                      id={`freq-${freq}`}
                      name="notification_frequency"
                      value={freq}
                      checked={draftFrequency === freq}
                      onChange={() => setDraftFrequency(freq)}
                      className="mt-1 text-brand focus:ring-brand"
                    />
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold text-foreground">
                        {NOTIFICATION_FREQUENCY_LABELS[freq]}
                      </p>
                      <p className="text-xs text-foreground/60">
                        {NOTIFICATION_FREQUENCY_DESCRIPTIONS[freq]}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="pt-2 flex flex-wrap items-center gap-3">
              <OriginButton type="submit" loading={pending} disabled={pending} size="sm">
                {pending ? "Saving..." : "Save changes"}
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
          <div>
            <div className={`${ROW} border-b border-black/[0.06]`}>
              <span className={FIELD_LABEL}>Display name</span>
              <span className="flex items-center gap-3 text-sm text-foreground/85">
                {savedName.trim() || "Not set"}
                <button
                  type="button"
                  onClick={startEditing}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold text-brand transition-colors hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                  Edit<span className="sr-only"> account details</span>
                </button>
              </span>
            </div>

            <div className={`${ROW} border-b border-black/[0.06]`}>
              <div>
                <dt className={FIELD_LABEL}>Notification delivery</dt>
                <dd className="mt-1 text-sm font-medium text-foreground">
                  {NOTIFICATION_FREQUENCY_LABELS[savedFrequency]}
                </dd>
                <p className="mt-0.5 text-xs text-foreground/55">
                  {NOTIFICATION_FREQUENCY_DESCRIPTIONS[savedFrequency]}
                </p>
              </div>
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
        )}
      </div>

      <p className="mt-4 px-1 text-sm leading-[1.7] text-foreground/65">
        Your email is changed through your login details, and your role is set by
        an administrator — neither can be edited here.
      </p>

      {state.status === "success" && !editing && state.message ? (
        <p aria-live="polite" className="mt-3 px-1 text-sm font-bold text-brand">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
