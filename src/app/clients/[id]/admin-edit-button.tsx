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
import { restrictedFieldLabel } from "@/lib/edit-suggestions";

import { adminDirectEditAction, type AdminEditState } from "./admin-actions";

const idleAdminEditState: AdminEditState = { kind: "idle" };

export function AdminEditButton({
  organisationId,
  restrictedFields,
  currentValues,
}: {
  organisationId: string;
  restrictedFields: { field_name: string; label: string }[];
  currentValues: Record<string, string | null>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(adminDirectEditAction, idleAdminEditState);
  const [fieldName, setFieldName] = useState(restrictedFields[0]?.field_name ?? "legal_name");

  const [prevKind, setPrevKind] = useState(state.kind);
  if (state.kind !== prevKind) {
    setPrevKind(state.kind);
    if (state.kind === "success") {
      setOpen(false);
    }
  }

  useEffect(() => {
    if (state.kind === "success") {
      router.refresh();
    }
  }, [state, router]);

  if (restrictedFields.length === 0) return null;

  return (
    <>
      <OriginButton size="xs" variant="blue" onClick={() => setOpen(true)} type="button">
        <PencilLine aria-hidden="true" className="size-3.5" />
        Edit
      </OriginButton>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit field</DialogTitle>
            <DialogDescription>Change is applied immediately and audited. No approval needed.</DialogDescription>
          </DialogHeader>

          <form action={formAction} className="space-y-3">
            <input type="hidden" name="organisationId" value={organisationId} />
            <input type="hidden" name="fieldName" value={fieldName} />

            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-dim">Field</span>
              <Select value={fieldName} onValueChange={setFieldName}>
                <SelectTrigger size="sm" className="w-full rounded-inset bg-white" aria-label="Field to edit">
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
              Current value: <span className="font-semibold text-dim">{currentValues[fieldName]?.trim() || "Not provided"}</span>
            </p>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-[13px] font-medium text-dim">New value</span>
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
