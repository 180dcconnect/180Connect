"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { OriginButton } from "@/components/ui/origin-button";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pill } from "./section-card";
import { SUGGESTIBLE_FIELDS, type ClientEditSuggestion } from "@/lib/client-edit-suggestions";

const STATUS_TONE = {
  pending: "warn",
  approved: "brand",
  rejected: "neutral",
} as const;

const STATUS_LABEL = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
} as const;

/**
 * F077 — the whole feature on this side: a CAM proposes a field correction, an
 * admin decides it elsewhere (F078/F079, not yet built), and the client profile
 * keeps showing the current value the entire time (AC3). The list above the form
 * is why: it is the closest a CAM gets to "this is proposed, not applied" without
 * that sentence being read on the field itself.
 *
 * `currentValues` comes from the same OrganisationDetailRow page.tsx already
 * queried for BasicInfoPanel — no second fetch for the six fields this form can
 * target.
 */
export function SuggestEditPanel({
  organisationId,
  suggestions,
  currentValues,
  canPropose,
}: {
  organisationId: string;
  suggestions: ClientEditSuggestion[];
  currentValues: Readonly<Record<string, string | null>>;
  canPropose: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fieldName, setFieldName] = useState("");
  const [proposedValue, setProposedValue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [isRefreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const saving = busy || isRefreshing;

  // Mirrors suggest_client_edit's own guard so the form doesn't offer a field
  // the RPC will refuse with "this field already has a pending suggestion".
  const pendingFields = new Set(
    suggestions.filter((suggestion) => suggestion.status === "pending").map((s) => s.fieldName),
  );
  const availableFields = SUGGESTIBLE_FIELDS.filter(
    (field) => !pendingFields.has(field.fieldName),
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fieldName) {
      setError("Choose which field you're correcting.");
      return;
    }
    if (!proposedValue.trim()) {
      setError("Enter the corrected value.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/clients/${organisationId}/suggest-edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldName,
          proposedValue,
          note: note.trim() || undefined,
        }),
      });
      if (response.ok) {
        setOpen(false);
        setFieldName("");
        setProposedValue("");
        setNote("");
        startRefresh(() => router.refresh());
        return;
      }
      const body = await response.json();
      setError(body.error ?? "The suggestion could not be sent.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-4">
      {suggestions.length === 0 ? (
        <p className="text-sm leading-[1.7] text-foreground/45">
          No corrections have been suggested for this client.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {suggestions.map((suggestion) => (
            <li
              key={suggestion.id}
              className="rounded-xl border border-black/[0.06] bg-black/[0.02] px-3.5 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                  {suggestion.fieldLabel}
                </span>
                <Pill tone={STATUS_TONE[suggestion.status]}>{STATUS_LABEL[suggestion.status]}</Pill>
              </div>
              <p className="mt-1.5 text-sm leading-[1.6] text-foreground/75">
                <span className="text-foreground/40 line-through">
                  {suggestion.currentValue ?? "Not provided"}
                </span>{" "}
                → <span className="font-bold">{suggestion.proposedValue}</span>
              </p>
              {suggestion.note && (
                <p className="mt-1 text-[13px] leading-[1.6] text-foreground/55">
                  &ldquo;{suggestion.note}&rdquo;
                </p>
              )}
              <p className="mt-1.5 text-[12px] text-foreground/40">
                Suggested by {suggestion.suggestedByName} on{" "}
                {new Date(suggestion.createdAt).toLocaleDateString("en-GB")}
              </p>
            </li>
          ))}
        </ul>
      )}

      {canPropose && (
        <div className="space-y-3">
          {open ? (
            <form className="space-y-3" onSubmit={submit}>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                  Field
                </span>
                <Select
                  value={fieldName}
                  disabled={saving}
                  onValueChange={(value) => {
                    setFieldName(value);
                    setError(null);
                  }}
                >
                  <SelectTrigger className="w-full rounded-xl bg-white">
                    <SelectValue placeholder="Choose a field" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableFields.map((field) => (
                      <SelectItem key={field.fieldName} value={field.fieldName}>
                        {field.fieldLabel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              {fieldName && (
                <p className="text-[13px] leading-[1.6] text-foreground/50">
                  Current value:{" "}
                  <span className="font-bold text-foreground/70">
                    {currentValues[fieldName] ?? "Not provided"}
                  </span>
                </p>
              )}

              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                  Corrected value
                </span>
                <Input
                  type="text"
                  value={proposedValue}
                  disabled={saving}
                  onChange={(event) => setProposedValue(event.target.value)}
                  placeholder="What it should say instead"
                  className="rounded-xl bg-white"
                />
              </label>

              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                  Note (optional)
                </span>
                <Textarea
                  value={note}
                  disabled={saving}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Why this needs correcting"
                  rows={2}
                  className="rounded-xl bg-white"
                />
              </label>

              <p className="text-[13px] leading-[1.6] text-foreground/45">
                This proposes a change — it does not apply it. The client profile keeps
                showing the current value until an admin reviews the suggestion.
              </p>

              <div className="flex items-center gap-2">
                <OriginButton type="submit" size="sm" loading={saving} disabled={saving}>
                  {saving ? "Sending…" : "Send suggestion"}
                </OriginButton>
                <OriginButton
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={saving}
                  onClick={() => {
                    setOpen(false);
                    setError(null);
                  }}
                >
                  Cancel
                </OriginButton>
              </div>
            </form>
          ) : (
            <OriginButton
              type="button"
              size="sm"
              variant="outline"
              disabled={availableFields.length === 0}
              onClick={() => setOpen(true)}
            >
              {availableFields.length === 0
                ? "Every field already has a pending suggestion"
                : "Suggest an edit"}
            </OriginButton>
          )}
        </div>
      )}

      {error && <InlineAlert message={error} />}
    </div>
  );
}
