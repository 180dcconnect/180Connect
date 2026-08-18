"use client";

import { useActionState, useState } from "react";
import { OriginButton } from "@/components/ui/origin-button";
import { MAX_FULL_NAME_LENGTH } from "@/lib/account-settings";
import { saveAccountSettingsAction, type AccountSettingsState } from "./actions";

const initialState: AccountSettingsState = { status: "idle" };

export function AccountSettingsForm({
  initialFullName,
  email,
  role,
}: {
  initialFullName: string;
  email: string | null;
  role: string;
}) {
  const [state, formAction, pending] = useActionState(
    saveAccountSettingsAction,
    initialState,
  );
  // Controlled so the field keeps what was typed when the action comes back with
  // a validation error — `defaultValue` would reset it to the saved name and
  // make the person retype a long entry to fix a small mistake.
  const [fullName, setFullName] = useState(initialFullName);

  return (
    <form action={formAction} className="mt-6 space-y-8" noValidate>
      <div>
        <label
          htmlFor="full_name"
          className="text-xs font-bold uppercase tracking-wide text-foreground/60"
        >
          Display name
        </label>
        <input
          id="full_name"
          name="full_name"
          type="text"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          maxLength={MAX_FULL_NAME_LENGTH}
          autoComplete="name"
          required
          aria-describedby="full_name_hint"
          className="mt-2 h-10 w-full rounded-lg border border-black/15 bg-white px-3 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20"
        />
        <p id="full_name_hint" className="mt-2 text-xs text-foreground/60">
          This is the name your team sees on clients you own and in the activity
          feed.
        </p>
      </div>

      {/*
       * Email and role are shown but not editable (AC2). They are rendered as a
       * description list rather than as disabled inputs: a greyed-out field
       * invites someone to look for the control that enables it, where a plain
       * value plus the note below says where the change actually happens.
       */}
      <dl className="space-y-4 border-t border-black/10 pt-6">
        <div>
          <dt className="text-xs font-bold uppercase tracking-wide text-foreground/60">
            Email
          </dt>
          <dd className="mt-1 text-sm text-foreground/85">{email ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs font-bold uppercase tracking-wide text-foreground/60">
            Role
          </dt>
          <dd className="mt-1 text-sm text-foreground/85">{role}</dd>
        </div>
      </dl>

      <p className="text-sm text-foreground/65">
        Your email is changed through your login details, and your role is set by
        an administrator — neither can be edited here.
      </p>

      <div className="flex items-center gap-4">
        <OriginButton type="submit" loading={pending} disabled={pending} size="md">
          {pending ? "Saving..." : "Save changes"}
        </OriginButton>
        <p aria-live="polite" className="text-sm font-bold">
          {state.message ? (
            <span className={state.status === "error" ? "text-red-700" : "text-brand"}>
              {state.message}
            </span>
          ) : null}
        </p>
      </div>
    </form>
  );
}
