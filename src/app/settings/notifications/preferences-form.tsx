"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { Check, Loader2 } from "lucide-react";
import { Pill } from "@/app/clients/[id]/section-card";
import { FiledCheckbox } from "@/components/ui/filed-checkbox";
import {
  NOTIFICATION_FREQUENCIES,
  NOTIFICATION_FREQUENCY_DESCRIPTIONS,
  NOTIFICATION_FREQUENCY_LABELS,
  isAlwaysImmediate,
  type NotificationFrequency,
} from "@/lib/notification-preferences";
import type { NotificationKind } from "@/lib/notification-catalogue";
import {
  saveEmailNotificationPreferencesAction,
  saveNotificationFrequencyAction,
} from "./actions";
import { CARD, CARD_HINT, CARD_TITLE, PRIMARY_BUTTON, QUIET_BUTTON } from "../styles";
import { OptionGroup } from "../option-group";

type SaveState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

function sameTypes(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  return a.size === b.size && [...a].every((type) => b.has(type));
}

/**
 * Both notification preferences — how eagerly the bell interrupts (F178) and
 * which notifications are also emailed (F179) — as one form with one save bar.
 *
 * They were two forms with two Save buttons, each saving only its own card,
 * so changing both and pressing the nearer button silently dropped the other.
 * The two server actions stay separate (they write separate columns); Save
 * calls whichever has changed.
 *
 * The email card is the full list of notifications a role can receive, not
 * only the emailable ones: someone deciding what to be emailed about should
 * see what exists, and "in-app only" is an answer too.
 */
export function NotificationPreferencesForm({
  initialFrequency,
  initialEmailTypes,
  notifications,
  email,
}: {
  initialFrequency: NotificationFrequency;
  initialEmailTypes: readonly string[];
  /** The notifications this role can receive, from the catalogue. */
  notifications: readonly NotificationKind[];
  email: string | null;
}) {
  const [savedFrequency, setSavedFrequency] = useState(initialFrequency);
  const [savedTypes, setSavedTypes] = useState<ReadonlySet<string>>(
    () => new Set(initialEmailTypes),
  );
  const [frequency, setFrequency] = useState(initialFrequency);
  const [emailTypes, setEmailTypes] = useState<ReadonlySet<string>>(
    () => new Set(initialEmailTypes),
  );
  const [state, setState] = useState<SaveState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  const frequencyDirty = frequency !== savedFrequency;
  const typesDirty = !sameTypes(emailTypes, savedTypes);
  const dirty = frequencyDirty || typesDirty;

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function toggleEmail(type: string, checked: boolean) {
    setState({ status: "idle" });
    setEmailTypes((current) => {
      const next = new Set(current);
      if (checked) next.add(type);
      else next.delete(type);
      return next;
    });
  }

  function discard() {
    setState({ status: "idle" });
    setFrequency(savedFrequency);
    setEmailTypes(savedTypes);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextFrequency = frequency;
    const nextTypes = emailTypes;

    startTransition(async () => {
      if (frequencyDirty) {
        const formData = new FormData();
        formData.set("frequency", nextFrequency);
        const result = await saveNotificationFrequencyAction({ status: "idle" }, formData);
        if (result.status === "error") {
          setState({ status: "error", message: result.message ?? "Could not save." });
          return;
        }
        setSavedFrequency(nextFrequency);
      }

      if (typesDirty) {
        const formData = new FormData();
        for (const type of nextTypes) formData.append("email_type", type);
        const result = await saveEmailNotificationPreferencesAction({ status: "idle" }, formData);
        if (result.status === "error") {
          setState({ status: "error", message: result.message ?? "Could not save." });
          return;
        }
        setSavedTypes(new Set(result.types ?? nextTypes));
      }

      setState({ status: "success", message: "Preferences saved." });
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <OptionGroup
        name="frequency"
        title="How often the bell interrupts you"
        hint="Every notification is waiting in the bell whatever you choose. Digests also email you a summary of what's still unread — and client replies always get your attention straight away."
        options={NOTIFICATION_FREQUENCIES}
        labels={NOTIFICATION_FREQUENCY_LABELS}
        descriptions={NOTIFICATION_FREQUENCY_DESCRIPTIONS}
        value={frequency}
        onChange={(next) => {
          setState({ status: "idle" });
          setFrequency(next);
        }}
        columns="sm:grid-cols-3"
      />

      <section aria-labelledby="notifications-heading" className={CARD}>
        <h2 id="notifications-heading" className={CARD_TITLE}>
          What you&apos;re notified about
        </h2>
        <p className={CARD_HINT}>
          All of these appear in the bell. Tick <span className="text-ink">Email me</span> to
          also get one by email
          {email ? (
            <>
              {" "}
              at <span className="text-ink">{email}</span>
            </>
          ) : null}
          , so it doesn&apos;t sit unread while you&apos;re away.
        </p>

        <ul className="mt-4">
          {notifications.map((kind) => {
            const checkboxId = `email-${kind.type}`;
            const descriptionId = `${checkboxId}-description`;
            return (
              <li
                key={kind.type}
                className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-rule-soft py-3.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                    {kind.label}
                    {isAlwaysImmediate(kind.type) && (
                      <Pill tone="lead" dot={false}>
                        Always immediate
                      </Pill>
                    )}
                  </p>
                  <p id={descriptionId} className="mt-0.5 text-[13px] leading-[1.55] text-dim">
                    {kind.description}
                  </p>
                </div>

                {kind.emailable ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <FiledCheckbox
                      id={checkboxId}
                      checked={emailTypes.has(kind.type)}
                      onCheckedChange={(checked) => toggleEmail(kind.type, checked === true)}
                      aria-describedby={descriptionId}
                      disabled={pending}
                    />
                    <label
                      htmlFor={checkboxId}
                      className="cursor-pointer text-[13px] font-medium text-ink select-none"
                    >
                      Email me
                    </label>
                  </div>
                ) : (
                  <span className="shrink-0 text-[13px] text-faint">In-app only</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {(dirty || state.status !== "idle") && (
        <div className="sticky bottom-4 z-10 mx-auto flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-panel border border-rule bg-white px-4 py-3 sm:w-1/2">
          <p aria-live="polite" className="mr-auto flex items-center gap-2 text-[13px]">
            {state.status === "error" ? (
              <span className="font-semibold text-stop">{state.message}</span>
            ) : dirty ? (
              <span className="flex items-center gap-2 text-ink">
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-hold" />
                Unsaved changes
              </span>
            ) : state.status === "success" ? (
              <span className="flex items-center gap-1.5 font-semibold text-go">
                <Check aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.5} />
                {state.message}
              </span>
            ) : null}
          </p>

          {dirty && (
            <button type="button" onClick={discard} disabled={pending} className={QUIET_BUTTON}>
              Discard
            </button>
          )}
          <button
            type="submit"
            disabled={pending || !dirty}
            aria-busy={pending || undefined}
            className={PRIMARY_BUTTON}
          >
            {pending && <Loader2 className="size-3.5 animate-spin" strokeWidth={2.2} />}
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </form>
  );
}
