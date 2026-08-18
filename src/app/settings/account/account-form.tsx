"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OriginButton } from "@/components/ui/origin-button";
import { MAX_FULL_NAME_LENGTH } from "@/lib/account-settings";
import { saveAccountSettingsAction, type AccountSettingsState } from "./actions";

const initialState: AccountSettingsState = { status: "idle" };

const FIELD_LABEL =
  "text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40";

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
    <form action={formAction} noValidate>
      <div className="rounded-2xl border border-black/[0.06] bg-white px-6 shadow-sm">
        <div className="py-6">
          <Label htmlFor="full_name" className={FIELD_LABEL}>
            Display name
          </Label>
          <Input
            id="full_name"
            name="full_name"
            type="text"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            maxLength={MAX_FULL_NAME_LENGTH}
            autoComplete="name"
            required
            aria-invalid={state.status === "error" || undefined}
            aria-describedby="full_name_hint"
            className="mt-2.5 bg-white"
          />
          <p id="full_name_hint" className="mt-2.5 text-sm leading-[1.7] text-foreground/65">
            The name your team sees on clients you own and in the activity feed.
          </p>
        </div>

        {/*
         * Email and role are shown but not editable (AC2). Rendered as plain
         * values rather than as disabled inputs: a greyed-out field invites
         * someone to look for the control that enables it, where a value plus
         * the note below says where the change actually happens.
         */}
        <dl className="divide-y divide-black/[0.06] border-t border-black/[0.06]">
          <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 py-5">
            <dt className={FIELD_LABEL}>Email</dt>
            <dd className="text-sm text-foreground/85">{email ?? "—"}</dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 py-5">
            <dt className={FIELD_LABEL}>Role</dt>
            <dd className="text-sm text-foreground/85">{role}</dd>
          </div>
        </dl>
      </div>

      <p className="mt-4 px-1 text-sm leading-[1.7] text-foreground/65">
        Your email is changed through your login details, and your role is set by
        an administrator — neither can be edited here.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <OriginButton type="submit" loading={pending} disabled={pending} size="md">
          {pending ? "Saving..." : "Save changes"}
        </OriginButton>
        <p aria-live="polite" className="text-sm font-bold">
          {state.message ? (
            <span className={state.status === "error" ? "text-destructive" : "text-brand"}>
              {state.message}
            </span>
          ) : null}
        </p>
      </div>
    </form>
  );
}
