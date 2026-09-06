"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Check } from "lucide-react";
import { OriginButton } from "@/components/ui/origin-button";
import {
  NOTIFICATION_FREQUENCIES,
  NOTIFICATION_FREQUENCY_DESCRIPTIONS,
  NOTIFICATION_FREQUENCY_LABELS,
  type NotificationFrequency,
} from "@/lib/notification-preferences";
import { saveNotificationFrequencyAction, type NotificationPreferencesState } from "./actions";

/** F178 AC1 — one card per option, same selectable-card pattern as the accessibility settings form. */
export function NotificationFrequencyForm({
  initialFrequency,
}: {
  initialFrequency: NotificationFrequency;
}) {
  const [state, setState] = useState<NotificationPreferencesState>({ status: "idle" });
  const [pending, startTransition] = useTransition();
  const [frequency, setFrequency] = useState<NotificationFrequency>(initialFrequency);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("frequency", frequency);

    startTransition(async () => {
      const result = await saveNotificationFrequencyAction(state, formData);
      setState(result);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8" noValidate>
      <section className="rounded-2xl border border-black/[0.06] bg-white p-6 shadow-sm space-y-4">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
          Delivery frequency
        </h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 pt-2">
          {NOTIFICATION_FREQUENCIES.map((option) => {
            const active = frequency === option;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setFrequency(option)}
                className={`relative flex flex-col items-start rounded-xl border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                  active
                    ? "border-brand bg-brand/5 shadow-xs"
                    : "border-black/[0.08] bg-white hover:border-black/20"
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="text-sm font-bold text-foreground">
                    {NOTIFICATION_FREQUENCY_LABELS[option]}
                  </span>
                  {active && (
                    <span className="flex size-5 items-center justify-center rounded-full bg-brand text-white">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                  )}
                </div>
                <span className="mt-1.5 text-xs leading-relaxed text-foreground/60">
                  {NOTIFICATION_FREQUENCY_DESCRIPTIONS[option]}
                </span>
              </button>
            );
          })}
        </div>

        <p className="pt-1 text-[13px] leading-[1.6] text-foreground/45">
          Some notifications, like a client replying, always arrive immediately regardless
          of this setting.
        </p>
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
