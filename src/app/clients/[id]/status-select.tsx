"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PIPELINE_STATUSES, formatOutreachStatus, type PipelineStatus } from "@/lib/organisation-format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OriginButton } from "@/components/ui/origin-button";

/**
 * F145 — lets the client's owner (CAM) or an admin move it through the pipeline.
 * Posts to /api/clients/[id]/status, which calls set_outreach_status; that RPC
 * re-checks permission and writes the audit_log row, so this component only needs
 * to reflect the outcome. Same fetch/busy/error shape as ClaimButton.
 */
export function StatusSelect({
  organisationId,
  currentStatus,
}: {
  organisationId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<PipelineStatus>(
    (PIPELINE_STATUSES as readonly string[]).includes(currentStatus)
      ? (currentStatus as PipelineStatus)
      : PIPELINE_STATUSES[0],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = selected !== currentStatus;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/clients/${organisationId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: selected }),
      });
      if (response.ok) {
        router.refresh();
        return;
      }
      const body = await response.json();
      setError(body.error ?? "This status could not be saved.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2.5">
      <label className="sr-only" htmlFor={`status-${organisationId}`}>
        Pipeline status
      </label>
      <Select
        value={selected}
        disabled={busy}
        onValueChange={(value) => setSelected(value as PipelineStatus)}
      >
        <SelectTrigger id={`status-${organisationId}`} className="w-fit rounded-full bg-white text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PIPELINE_STATUSES.map((status) => (
            <SelectItem key={status} value={status}>
              {formatOutreachStatus(status)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <OriginButton
        type="button"
        size="sm"
        loading={busy}
        disabled={busy || !dirty}
        onClick={save}
      >
        {busy ? "Saving…" : "Save status"}
      </OriginButton>
      {error && (
        <p aria-live="polite" role="alert" className="w-full text-[13px] font-bold text-destructive">
          {error}
        </p>
      )}
      {currentStatus === "responded" && (
        // F149 AC3: 'responded' is intermediate — this status alone doesn't
        // conclude the interaction, so a CAM viewing it needs a nudge to
        // actually check the reply content and decide next steps.
        <p className="w-full text-[13px] text-foreground/60">
          A reply has come in. Check the reply content and decide the next step.
        </p>
      )}
    </div>
  );
}
