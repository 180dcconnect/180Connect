"use client";

import { useActionState } from "react";
import { OriginButton } from "@/components/ui/origin-button";
import {
  linkAttachmentToTimelineAction,
  type LinkAttachmentState,
} from "./actions";

export type TimelineLinkOption = { key: string; label: string };

const INITIAL_STATE: LinkAttachmentState = { kind: "idle" };

export function LinkAttachmentForm({
  organisationId,
  attachmentId,
  currentKey,
  options,
}: {
  organisationId: string;
  attachmentId: string;
  currentKey: string;
  options: readonly TimelineLinkOption[];
}) {
  const [state, action, pending] = useActionState(
    linkAttachmentToTimelineAction,
    INITIAL_STATE,
  );

  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="attachmentId" value={attachmentId} />
      <label className="sr-only" htmlFor={`attachment-context-${attachmentId}`}>
        Timeline event for this attachment
      </label>
      <select
        id={`attachment-context-${attachmentId}`}
        name="contextKey"
        defaultValue={currentKey}
        disabled={pending}
        className="max-w-full rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs text-foreground/75"
      >
        {!options.some((option) => option.key === currentKey) && (
          <option value={currentKey}>Current linked event (temporarily unavailable)</option>
        )}
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
      <OriginButton type="submit" size="sm" variant="outline" loading={pending} disabled={pending}>
        Save link
      </OriginButton>
      {state.kind !== "idle" && (
        <span
          aria-live="polite"
          role={state.kind === "error" ? "alert" : "status"}
          className={`text-xs font-semibold ${state.kind === "error" ? "text-destructive" : "text-foreground/55"}`}
        >
          {state.message}
        </span>
      )}
    </form>
  );
}
