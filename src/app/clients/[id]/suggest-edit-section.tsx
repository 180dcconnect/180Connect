"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { OriginButton } from "@/components/ui/origin-button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AppRole } from "@/lib/auth/permissions.ts";
import {
  describePendingSuggestion,
  idleSuggestEditState,
  pendingSuggestionNotice,
  restrictedFieldLabel,
  suggestEditAvailability,
  suggestionDecisionNotice,
  type EditSuggestionRow,
} from "@/lib/edit-suggestions";
import { suggestEditAction } from "./actions";

/**
 * #79/#80/#81 + #23 (F077/F078/F079/F020) — one section serving both sides of the
 * edit-suggestion system, right under the values it governs so "live vs proposed"
 * reads in one glance.
 *
 * CAM side: proposes a correction to one of the restricted fields (the live list
 * comes from RESTRICTED_EDIT_FIELDS via the page, so an admin-added field appears
 * here without a deploy). Submitting creates a pending suggestion and changes nothing
 * else; the copy says so at every step. Their own settled proposals render the
 * outcome (approved / rejected with the admin's reason) — AC3 of #80's "notification
 * or a visible status", satisfied by visibility rather than the not-yet-built
 * notifications table.
 *
 * Admin side: each pending proposal becomes a decision card — current → proposed,
 * who asked, optional reason, Approve/Reject — PATCHing /api/admin/edit-suggestions,
 * which calls decide_edit_suggestion (stale-value guard, audit trail). Approval
 * applies the value; rejection leaves the record untouched.
 */
export function SuggestEditSection({
  organisationId,
  actorId,
  actorRole,
  restrictedFields,
  currentValues,
  suggestions,
}: {
  organisationId: string;
  actorId: string;
  actorRole: AppRole;
  /** The live active restricted fields, label included — F020's config table. */
  restrictedFields: { field_name: string; label: string }[];
  currentValues: Record<string, string | null>;
  suggestions: EditSuggestionRow[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    suggestEditAction,
    idleSuggestEditState,
  );
  const [fieldName, setFieldName] = useState(
    restrictedFields[0]?.field_name ?? "legal_name",
  );
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [decideMessage, setDecideMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const openSuggestions = suggestions.filter((row) => row.status === "pending");
  const ownDecided = suggestions.filter(
    (row) =>
      row.requested_by === actorId &&
      (row.status === "approved" || row.status === "rejected"),
  );

  const isAdmin = actorRole === "admin";

  // The proposal form is CAM-only; admins reach these fields through the normal
  // policy (matrix §3.2) and decide proposals instead. Availability mirrors
  // suggest_organisation_edit's guards: another CAM's pending field is blocked,
  // the caller's own stays open because resubmitting supersedes it.
  const availability = suggestEditAvailability({
    actorRole: isAdmin ? "admin" : actorRole,
    actorId,
    fieldName,
    pendingSuggestions: openSuggestions,
  });

  async function decide(suggestionId: string, approve: boolean) {
    setBusyId(suggestionId);
    setDecideMessage("");
    try {
      const response = await fetch("/api/admin/edit-suggestions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestionId,
          approve,
          reason: reasons[suggestionId] ?? "",
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setDecideMessage(body.error ?? "The decision could not be saved.");
        return;
      }
      setDecideMessage(
        approve
          ? "Approved. The live record now carries the proposed value."
          : "Rejected. The live record is unchanged.",
      );
      router.refresh();
    } catch {
      setDecideMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-labelledby="suggest-edit-heading" className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
      <h2
        id="suggest-edit-heading"
        className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40"
      >
        {isAdmin ? "Suggested edits" : "Suggest a correction"}
      </h2>
      <p className="mt-1.5 max-w-prose text-[13px] leading-[1.6] text-foreground/50">
        {isAdmin
          ? "CAM-proposed corrections to this client's sensitive fields. Approving applies the value; rejecting changes nothing. Either way it is audited."
          : "Spotted something wrong? Propose a fix and an admin will review it. The values below stay unchanged until an admin approves."}
      </p>

      {isAdmin && (
        <div className="mt-4 space-y-4">
          {openSuggestions.length === 0 ? (
            <p className="text-[13px] leading-[1.6] text-foreground/45">
              No corrections are waiting for review on this client.
            </p>
          ) : (
            openSuggestions.map((row) => (
              <div key={row.id} className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
                <p className="text-sm font-bold text-foreground/85">
                  {describePendingSuggestion(
                    restrictedFieldLabel(row.field_name),
                    row.current_value,
                    row.proposed_value,
                  )}
                </p>
                <p className="mt-1 text-xs text-foreground/50">
                  {row.requested_by_user?.full_name ?? row.requested_by_user?.email ?? "A team member"}{" "}
                  proposed this on {new Date(row.created_at).toLocaleString("en-GB")}
                </p>
                <label className="mt-3 block text-[13px] font-bold" htmlFor={`inline-reason-${row.id}`}>
                  Reason (optional, shown to the CAM)
                </label>
                <textarea
                  className="mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm"
                  disabled={busyId === row.id}
                  id={`inline-reason-${row.id}`}
                  onChange={(event) =>
                    setReasons((current) => ({ ...current, [row.id]: event.target.value }))
                  }
                  rows={2}
                  value={reasons[row.id] ?? ""}
                />
                <div className="mt-3 flex gap-2">
                  <OriginButton
                    size="sm"
                    disabled={busyId === row.id}
                    loading={busyId === row.id}
                    onClick={() => decide(row.id, true)}
                    type="button"
                  >
                    Approve and apply
                  </OriginButton>
                  <OriginButton
                    size="sm"
                    variant="outline"
                    disabled={busyId === row.id}
                    onClick={() => decide(row.id, false)}
                    type="button"
                  >
                    Reject
                  </OriginButton>
                </div>
              </div>
            ))
          )}
          {decideMessage && (
            <p aria-live="polite" role="alert" className="text-[13px] font-bold text-foreground/75">
              {decideMessage}
            </p>
          )}
        </div>
      )}

      {!isAdmin && (
        <>
          {ownDecided.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {ownDecided.map((row) => (
                <li
                  key={row.id}
                  className={`rounded-xl px-3.5 py-2.5 text-[13px] leading-[1.6] ${
                    row.status === "approved"
                      ? "border border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-800"
                      : "border border-black/[0.06] bg-black/[0.02] text-foreground/65"
                  }`}
                >
                  {suggestionDecisionNotice(
                    row.status as "approved" | "rejected",
                    restrictedFieldLabel(row.field_name),
                    row.rejection_reason,
                  )}                </li>
              ))}
            </ul>
          )}

          {openSuggestions.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {openSuggestions.map((suggestion) => (
                <li
                  key={suggestion.id}
                  className="rounded-xl border border-amber-500/20 bg-amber-500/[0.07] px-3.5 py-2.5 text-[13px] leading-[1.6] text-amber-800"
                >
                  {pendingSuggestionNotice(suggestion.field_name)}{" "}
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
              <Select value={fieldName} onValueChange={setFieldName}>
                <SelectTrigger size="sm" className="w-full rounded-xl bg-white" aria-label="Field to correct">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {restrictedFields.map((field) => (
                    <SelectItem key={field.field_name} value={field.field_name}>
                      {field.label}
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

            {!availability.available && availability.reason === "field_blocked" ? (
              <p
                aria-live="polite"
                className="rounded-xl border border-black/[0.06] bg-black/[0.02] px-3.5 py-3 text-[13px] leading-[1.6] text-foreground/65"
              >
                Another team member already has a correction pending for this field. Wait
                for the admin&rsquo;s decision before proposing yours.
              </p>
            ) : (
              <>
                {openSuggestions.some(
                  (suggestion) =>
                    suggestion.field_name === fieldName &&
                    suggestion.requested_by === actorId,
                ) && (
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
                    placeholder={`The correct ${restrictedFieldLabel(fieldName).toLowerCase()}`}
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
        </>
      )}
    </section>
  );
}
