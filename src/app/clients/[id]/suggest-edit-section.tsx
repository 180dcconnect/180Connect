"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OriginButton } from "@/components/ui/origin-button";
import { PencilLine } from "lucide-react";
import { Rise } from "@/components/dashboard-stage";
import { SectionCard } from "./section-card";
import type { AppRole } from "@/lib/auth/permissions.ts";
import {
  describePendingSuggestion,
  pendingSuggestionNotice,
  restrictedFieldLabel,
  suggestionDecisionNotice,
  type EditSuggestionRow,
} from "@/lib/edit-suggestions";

/**
 * #79/#80/#81 + #23 (F077/F078/F079/F020) — the *state* of the edit-suggestion
 * system on this record. The CAM's proposal form is no longer here: it lives
 * behind "Suggest an edit" in the "What we know" heading row
 * (`suggest-edit-button.tsx`), because an always-open form for a rare, deliberate
 * act cost a full card on every visit.
 *
 * What remains is only what you should see without opening anything, and the
 * card renders nothing at all when there is nothing to say:
 *
 * CAM side: their own settled proposals (approved / rejected with the admin's
 * reason) — AC3 of #80's "notification or a visible status", satisfied by
 * visibility rather than the not-yet-built notifications table — and anything
 * still pending on this client.
 *
 * Admin side: each pending proposal is a decision card — current → proposed, who
 * asked, optional reason, Approve/Reject — PATCHing /api/admin/edit-suggestions,
 * which calls decide_edit_suggestion (stale-value guard, audit trail). Approval
 * applies the value; rejection leaves the record untouched.
 */
export function SuggestEditSection({
  actorId,
  actorRole,
  suggestions,
}: {
  actorId: string;
  actorRole: AppRole;
  suggestions: EditSuggestionRow[];
}) {
  const router = useRouter();
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
      setDecideMessage(
        "Could not reach the server. Check your connection and try again.",
      );
    } finally {
      setBusyId(null);
    }
  }

  // Nothing proposed, nothing decided — no card. An empty "no corrections are
  // waiting" panel is a row of furniture that never earns its place.
  const hasSomethingToShow = isAdmin
    ? openSuggestions.length > 0 || decideMessage !== ""
    : openSuggestions.length > 0 || ownDecided.length > 0;
  if (!hasSomethingToShow) return null;

  return (
    <Rise>
      <SectionCard
        headingId="suggest-edit-heading"
        icon={<PencilLine />}
        title={isAdmin ? "Suggested edits" : "Your suggested edits"}
        hint={
          isAdmin
            ? "CAM-proposed corrections to this client's sensitive fields. Approving applies the value; rejecting changes nothing. Either way it is audited."
            : "Corrections you have proposed on this client. The values above stay unchanged until an admin approves."
        }
      >
        {isAdmin && (
          <div className="mt-4 space-y-4">
            {openSuggestions.map((row) => (
              <div
                key={row.id}
                className="rounded-inset border border-hold/25 bg-hold-wash p-4"
              >
                <p className="text-sm font-semibold text-ink">
                  {describePendingSuggestion(
                    restrictedFieldLabel(row.field_name),
                    row.current_value,
                    row.proposed_value,
                  )}
                </p>
                <p className="mt-1 text-xs text-dim">
                  {row.requested_by_user?.full_name ??
                    row.requested_by_user?.email ??
                    "A team member"}{" "}
                  proposed this on{" "}
                  {new Date(row.created_at).toLocaleString("en-GB")}
                </p>
                <label
                  className="mt-3 block text-[13px] font-semibold"
                  htmlFor={`inline-reason-${row.id}`}
                >
                  Reason (optional, shown to the CAM)
                </label>
                <textarea
                  className="mt-1 w-full rounded-inset border border-rule bg-white px-3 py-2 text-sm"
                  disabled={busyId === row.id}
                  id={`inline-reason-${row.id}`}
                  onChange={(event) =>
                    setReasons((current) => ({
                      ...current,
                      [row.id]: event.target.value,
                    }))
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
            ))}
            {decideMessage && (
              <p
                aria-live="polite"
                role="alert"
                className="text-[13px] font-semibold text-ink"
              >
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
                    className={`rounded-inset px-3.5 py-2.5 text-[13px] leading-[1.6] ${
                      row.status === "approved"
                        ? "border border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-800"
                        : "border border-rule bg-paper text-dim"
                    }`}
                  >
                    {suggestionDecisionNotice(
                      row.status as "approved" | "rejected",
                      restrictedFieldLabel(row.field_name),
                      row.rejection_reason,
                    )}
                  </li>
                ))}
              </ul>
            )}

            {openSuggestions.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {openSuggestions.map((suggestion) => (
                  <li
                    key={suggestion.id}
                    className="rounded-inset border border-hold/25 bg-hold-wash px-3.5 py-2.5 text-[13px] leading-[1.6] text-hold"
                  >
                    {pendingSuggestionNotice(suggestion.field_name)} Proposed:
                    &ldquo;{suggestion.proposed_value}&rdquo;
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </SectionCard>
    </Rise>
  );
}
