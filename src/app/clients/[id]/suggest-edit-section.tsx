"use client";

import { useActionState, useState } from "react";
import { OriginButton } from "@/components/ui/origin-button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  idleSuggestEditState,
  pendingSuggestionNotice,
  SENSITIVE_FIELD_LABELS,
  SENSITIVE_ORG_FIELDS,
  suggestEditAvailability,
  type PendingSuggestion,
  type SensitiveOrgField,
} from "@/lib/edit-suggestions";
import { suggestEditAction } from "./actions";

/**
 * #79 (F077) — where a CAM proposes a correction to one of the six sensitive client
 * fields. Submitting creates a pending suggestion and changes nothing else: the live
 * values above stay on screen until an admin approves (F078), and the copy says so at
 * every step so nobody reads "submitted" as "applied".
 *
 * A field another CAM already has a pending suggestion for is shown as blocked rather
 * than offered (the RPC would refuse it); the caller's own pending suggestion keeps
 * the form open — resubmitting supersedes it, which is what the RPC does.
 */
export function SuggestEditSection({
  organisationId,
  actorId,
  currentValues,
  pendingSuggestions,
}: {
  organisationId: string;
  actorId: string;
  currentValues: Record<SensitiveOrgField, string | null>;
  pendingSuggestions: PendingSuggestion[];
}) {
  const [state, formAction, pending] = useActionState(
    suggestEditAction,
    idleSuggestEditState,
  );
  const [fieldName, setFieldName] = useState<SensitiveOrgField>("legal_name");

  const availability = suggestEditAvailability({
    actorRole: "cam",
    actorId,
    fieldName,
    pendingSuggestions,
  });
  const ownPending = pendingSuggestions.find(
    (suggestion) =>
      suggestion.field_name === fieldName && suggestion.requested_by === actorId,
  );
  const blocked = !availability.available && availability.reason === "field_blocked";

  return (
    <section aria-labelledby="suggest-edit-heading" className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
      <h2
        id="suggest-edit-heading"
        className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40"
      >
        Suggest a correction
      </h2>
      <p className="mt-1.5 max-w-prose text-[13px] leading-[1.6] text-foreground/50">
        Spotted something wrong? Propose a fix and an admin will review it. The values
        below stay unchanged until an admin approves.
      </p>

      {pendingSuggestions.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {pendingSuggestions.map((suggestion) => (
            <li
              key={suggestion.id}
              className="rounded-xl border border-amber-500/20 bg-amber-500/[0.07] px-3.5 py-2.5 text-[13px] leading-[1.6] text-amber-800"
            >
              {isSensitiveField(suggestion.field_name)
                ? pendingSuggestionNotice(suggestion.field_name)
                : null}{" "}
              Proposed: &ldquo;{suggestion.proposed_value}&rdquo;
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="mt-4 space-y-3">
        <input type="hidden" name="organisationId" value={organisationId} />
        <input type="hidden" name="fieldName" value={fieldName} />

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
            Field
          </span>
          <Select value={fieldName} onValueChange={(value) => setFieldName(value as SensitiveOrgField)}>
            <SelectTrigger size="sm" className="w-full rounded-xl bg-white" aria-label="Field to correct">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SENSITIVE_ORG_FIELDS.map((field) => (
                <SelectItem key={field} value={field}>
                  {SENSITIVE_FIELD_LABELS[field]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p className="text-[13px] leading-[1.6] text-foreground/45">
          Current value:{" "}
          <span className="font-bold text-foreground/70">
            {currentValues[fieldName]?.trim() || "Not provided"}
          </span>
        </p>

        {blocked ? (
          <p
            aria-live="polite"
            className="rounded-xl border border-black/[0.06] bg-black/[0.02] px-3.5 py-3 text-[13px] leading-[1.6] text-foreground/65"
          >
            Another team member already has a correction pending for this field. Wait
            for the admin&rsquo;s decision before proposing yours.
          </p>
        ) : (
          <>
            {ownPending && (
              <p className="rounded-xl border border-black/[0.06] bg-black/[0.02] px-3.5 py-3 text-[13px] leading-[1.6] text-foreground/65">
                You already have a correction pending for this field. Submitting again
                replaces it.
              </p>
            )}
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                Corrected value
              </span>
              <Input
                type="text"
                name="fieldValue"
                required
                placeholder={`The correct ${SENSITIVE_FIELD_LABELS[fieldName].toLowerCase()}`}
                className="rounded-xl bg-white"
              />
            </label>
            <OriginButton type="submit" size="sm" loading={pending} disabled={pending}>
              {pending ? "Submitting…" : "Submit suggestion"}
            </OriginButton>
          </>
        )}

        {state.kind === "success" && (
          <p aria-live="polite" className="text-[13px] font-bold text-emerald-700">
            {state.message}
          </p>
        )}
        {state.kind === "error" && (
          <p aria-live="polite" role="alert" className="text-[13px] font-bold text-destructive">
            {state.message}
          </p>
        )}
      </form>
    </section>
  );
}

function isSensitiveField(value: string): value is SensitiveOrgField {
  return (SENSITIVE_ORG_FIELDS as readonly string[]).includes(value);
}
