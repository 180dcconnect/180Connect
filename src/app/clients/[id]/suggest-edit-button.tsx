"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PencilLine } from "lucide-react";

import { OriginButton } from "@/components/ui/origin-button";
import { GooeyTextInput } from "@/components/ui/gooey-text-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/animate-ui/components/radix/dialog";
import {
  restrictedFieldLabel,
  suggestEditAvailability,
  idleSuggestEditState,
  type EditSuggestionRow,
} from "@/lib/edit-suggestions";

import { suggestEditAction } from "./actions";

/**
 * #79/#80/#81 + #23 (F077/F078/F079/F020), CAM side — the proposal itself.
 *
 * This used to be an always-open form in a card of its own, sitting under
 * "What we know" on every visit whether or not anyone had anything to correct.
 * Proposing an edit is a rare, deliberate act, so it is a control on the card
 * whose values it governs — top right of "What we know" — and the fields only
 * appear once you have said you want them.
 *
 * The pending/decided *state* stays outside the dialog (`suggest-edit-section`),
 * because that is information you should see without opening anything.
 */
export function SuggestEditButton({
  organisationId,
  actorId,
  restrictedFields,
  currentValues,
  suggestions,
}: {
  organisationId: string;
  actorId: string;
  /** The live active restricted fields, label included — F020's config table. */
  restrictedFields: { field_name: string; label: string }[];
  currentValues: Record<string, string | null>;
  suggestions: EditSuggestionRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    suggestEditAction,
    idleSuggestEditState,
  );
  const [fieldName, setFieldName] = useState(
    restrictedFields[0]?.field_name ?? "legal_name",
  );

  // The proposal lands as a pending row that the section below renders, so the
  // record has to catch up the moment it is accepted.
  useEffect(() => {
    if (state.kind === "success") router.refresh();
  }, [state, router]);

  // Nothing is configured as correctable — no control rather than a control that
  // opens onto an empty select.
  if (restrictedFields.length === 0) return null;

  const openSuggestions = suggestions.filter((row) => row.status === "pending");

  // Mirrors suggest_organisation_edit's guards: another CAM's pending field is
  // blocked, the caller's own stays open because resubmitting supersedes it.
  const availability = suggestEditAvailability({
    actorRole: "cam",
    actorId,
    fieldName,
    pendingSuggestions: openSuggestions,
  });

  const ownPendingOnField = openSuggestions.some(
    (row) => row.field_name === fieldName && row.requested_by === actorId,
  );

  return (
    <>
      <OriginButton
        size="xs"
        variant="blue"
        onClick={() => setOpen(true)}
        type="button"
      >
        <PencilLine aria-hidden="true" className="size-3.5" />
        Suggest an edit
      </OriginButton>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suggest a correction</DialogTitle>
            <DialogDescription>
              Spotted something wrong? Propose a fix and an admin will review it. The
              record stays exactly as it is until an admin approves.
            </DialogDescription>
          </DialogHeader>

          <form action={formAction} className="space-y-3">
            <input type="hidden" name="organisationId" value={organisationId} />
            <input type="hidden" name="fieldName" value={fieldName} />

            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-dim">Field</span>
              <Select value={fieldName} onValueChange={setFieldName}>
                <SelectTrigger
                  size="sm"
                  className="w-full rounded-inset bg-white"
                  aria-label="Field to correct"
                >
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

            <p className="text-[13px] leading-[1.6] text-dim break-words">
              Current value:{" "}
              <span className="font-semibold text-dim">
                {currentValues[fieldName]?.trim() || "Not provided"}
              </span>
            </p>

            {!availability.available && availability.reason === "field_blocked" ? (
              <p
                aria-live="polite"
                className="rounded-inset border border-rule bg-paper px-3.5 py-3 text-[13px] leading-[1.6] text-dim"
              >
                Another team member already has a correction pending for this field. Wait
                for the admin&rsquo;s decision before proposing yours.
              </p>
            ) : (
              <>
                {ownPendingOnField && (
                  <p className="rounded-inset border border-rule bg-paper px-3.5 py-3 text-[13px] leading-[1.6] text-dim">
                    You already have a correction pending for this field. Submitting again
                    replaces it.
                  </p>
                )}
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-[13px] font-medium text-dim">Corrected value</span>
                  <div className="flex justify-center w-full overflow-visible py-1">
                    <GooeyTextInput
                      key={fieldName}
                      name="fieldValue"
                      defaultValue={currentValues[fieldName]?.trim() ?? ""}
                      size="xl"
                      fieldWidth={330}
                      pending={pending}
                      placeholder={`The correct ${restrictedFieldLabel(fieldName).toLowerCase()}`}
                    />
                  </div>
                </label>
              </>
            )}

            {state.kind === "success" && (
              <p aria-live="polite" className="text-[13px] font-semibold text-emerald-700">
                {state.message}
              </p>
            )}
            {state.kind === "error" && (
              <p aria-live="polite" role="alert" className="text-[13px] font-semibold text-stop">
                {state.message}
              </p>
            )}
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
