"use client";

import { useState, useTransition } from "react";
import { HandCoins, RefreshCw } from "lucide-react";

import { OriginButton } from "@/components/ui/origin-button";
import { fetchGrantsForClient } from "./grant-history-actions";

/**
 * Asks 360Giving what grants this organisation has received.
 *
 * Two jobs, one button, distinguished only by whether anything is on record:
 * "Fetch grant history" for a record that has never been checked, "Check for new
 * grants" for one that has. Same call underneath — the label just stops it
 * reading as though it were about to replace what is already there.
 *
 * ── Why this is a button and not something the page does on its own ──
 *
 * Fetching on render would put a third-party API in the critical path of opening
 * a client record. 360Giving has been returning 502 for at least a day at the
 * time of writing, and the failure mode of an automatic fetch is a record that
 * hangs or errors for reasons that have nothing to do with the record. A
 * background queue keeps the data current (three-sixty-giving-backfill.ts); this
 * is the override for when a CAM wants it *now*, mid-call.
 */
export function GrantFetchButton({
  organisationId,
  hasGrants,
}: {
  organisationId: string;
  hasGrants: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function run() {
    setResult(null);
    startTransition(async () => {
      const outcome = await fetchGrantsForClient({ organisationId });
      setResult({ ok: outcome.ok, message: outcome.message });
    });
  }

  const Icon = hasGrants ? RefreshCw : HandCoins;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <OriginButton onClick={run} disabled={pending} size="sm" type="button">
        <Icon className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} strokeWidth={2.2} />
        {pending
          ? "Checking 360Giving…"
          : hasGrants
            ? "Check for new grants"
            : "Fetch grant history"}
      </OriginButton>

      {result && (
        <p
          className={`text-xs font-semibold ${result.ok ? "text-foreground/60" : "text-red-800"}`}
          role="status"
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
