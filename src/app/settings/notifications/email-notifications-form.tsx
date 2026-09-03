"use client";

import { useState, useTransition, type FormEvent } from "react";
import { OriginButton } from "@/components/ui/origin-button";
import { EMAIL_NOTIFICATION_TYPE_OPTIONS } from "@/lib/email-notification-preferences";
import {
  saveEmailNotificationPreferencesAction,
  type EmailNotificationPreferencesState,
} from "./actions";

/** F179 AC1 — one checkbox per emailable notification type. */
export function EmailNotificationsForm({
  initialTypes,
}: {
  initialTypes: readonly string[];
}) {
  const [state, setState] = useState<EmailNotificationPreferencesState>({ status: "idle" });
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set(initialTypes));

  function toggle(type: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    for (const type of selected) formData.append("email_type", type);

    startTransition(async () => {
      const result = await saveEmailNotificationPreferencesAction(state, formData);
      setState(result);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8" noValidate>
      <section className="rounded-2xl border border-black/[0.06] bg-white p-6 shadow-sm space-y-4">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
          Also email me for
        </h2>
        <p className="text-sm text-foreground/65">
          These arrive in-app either way. Checking a box here also sends an email, so
          you don&apos;t miss it if you&apos;re not looking at 180Connect.
        </p>

        <div className="space-y-3 pt-2">
          {EMAIL_NOTIFICATION_TYPE_OPTIONS.map((option) => {
            const checked = selected.has(option.type);
            return (
              <label
                key={option.type}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-black/[0.08] p-4 transition-colors hover:border-black/20"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(option.type)}
                  className="mt-0.5 size-4 shrink-0 accent-brand"
                />
                <span>
                  <span className="block text-sm font-bold text-foreground">{option.label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-foreground/60">
                    {option.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <OriginButton type="submit" loading={pending} disabled={pending}>
          {pending ? "Saving…" : "Save preference"}
        </OriginButton>

        {state.status === "success" && state.message && (
          <p aria-live="polite" className="ml-2 text-sm font-bold text-brand">
            {state.message}
          </p>
        )}
        {state.status === "error" && state.message && (
          <p aria-live="polite" className="ml-2 text-sm font-bold text-destructive">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
