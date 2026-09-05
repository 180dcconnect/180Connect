"use client";

import { useActionState, useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import type { JobStatus } from "@/lib/ingestion/type";
import { HorizontalStickGauge } from "@/components/ui/horizontal-stick-gauge";
import {
  getBackfillAttemptStatus,
  runBackfillBatchNow,
  type BackfillState,
} from "./actions";

const INITIAL: BackfillState = { kind: "idle", message: "" };

/**
 * Seconds one organisation costs against 360Giving: 600ms pacing plus the
 * request itself. Matches the ~1s/org arithmetic in
 * three-sixty-giving-backfill.ts. Only a fallback now: the live heartbeat
 * count below is the real signal, and this covers the seconds before the
 * first poll lands.
 */
const SECONDS_PER_ORG = 1;

/** How often the live count is re-read while the batch runs. */
const POLL_INTERVAL_MS = 2000;

function formatDuration(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  return `${minutes}:${String(clamped % 60).padStart(2, "0")}`;
}

type LiveAttempt = {
  status: JobStatus;
  walked: number | null;
  total: number | null;
};

/**
 * How much of the client list has been checked against 360Giving, and the
 * control that moves it along by one slice.
 *
 * The coverage figure is the honest replacement for the old bulk-import
 * button. That button claimed to walk the whole client list and could not —
 * it ran out of time partway through, every time, and reported the partial
 * result as a finished one. A count that goes up on its own says the same
 * thing truthfully: this is a job in progress, here is where it has got to.
 */
export function BackfillCard({
  checked,
  total,
  defaultBatchSize,
  maxBatchSize,
  cronBatchSize,
  oldestPending,
}: {
  checked: number;
  total: number;
  /** Organisations the button checks per press when the input is untouched. */
  defaultBatchSize: number;
  /** Largest slice one press may take — enforced by the input and the action. */
  maxBatchSize: number;
  /** Organisations the 15-minute schedule drains per run (the big slice). */
  cronBatchSize: number;
  /** When the least recently checked organisation was last looked at. */
  oldestPending: string | null;
}) {
  const [state, action, pending] = useActionState(runBackfillBatchNow, INITIAL);
  // Slice size for the next press. Kept as the raw input string so typing
  // stays natural; the selection below (and the action itself) clamps it to
  // 1..maxBatchSize, so an empty or wild input can never widen the slice.
  const [batchInput, setBatchInput] = useState(String(defaultBatchSize));
  const parsedInput = Number(batchInput);
  const selectedBatch =
    Number.isInteger(parsedInput) && parsedInput > 0
      ? Math.min(parsedInput, maxBatchSize)
      : defaultBatchSize;

  // Elapsed timer while the Server Action is in flight. The resets happen in
  // the submit handler (an event, not an effect) so the effect bodies stay pure.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!pending) return;
    const startedAt = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, [pending]);

  // Live progress: while the action runs, a separate request re-reads this
  // attempt's ingestion_runs row every couple of seconds. The browser holds
  // the action's connection open and these polls ride alongside it — the
  // runner writes one heartbeat per organisation walked, so the count ticks
  // up about once a second with real data, not an estimate.
  const [attemptSince, setAttemptSince] = useState<string | null>(null);
  const [live, setLive] = useState<LiveAttempt | null>(null);
  useEffect(() => {
    if (!pending || !attemptSince) return;
    let cancelled = false;
    const poll = async () => {
      const status = await getBackfillAttemptStatus({ since: attemptSince });
      if (cancelled) return;
      if (status.ok && status.found) {
        setLive({ status: status.status, walked: status.walked, total: status.total });
      }
    };
    void poll();
    const id = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pending, attemptSince]);

  const remaining = Math.max(total - checked, 0);

  const liveWalked = live?.walked ?? null;
  const liveTotal = live?.total ?? null;
  const hasLiveCount = liveWalked !== null && liveTotal !== null && liveTotal > 0;
  const liveCountLabel = hasLiveCount
    ? `Checked ${liveWalked.toLocaleString()} of ${liveTotal.toLocaleString()} so far.`
    : null;
  const finishing = live !== null && live.status !== "running";

  const estimatedTotal = Math.max(selectedBatch, 1) * SECONDS_PER_ORG;
  const estimatedLeft = Math.max(estimatedTotal - elapsed, 0);
  const attemptPercent = Math.min(95, Math.round((elapsed / estimatedTotal) * 100));

  return (
    <section className="rounded-panel border border-rule bg-white px-5 py-5 sm:px-6">
      <h2 className="font-body text-[19px] font-normal leading-[1.3] tracking-[-0.01em] text-ink">
        Grant history coverage
      </h2>
      <p className="mt-1.5 text-[13px] leading-[1.55] text-dim">
        We look up your clients in the 360Giving grants database a few at a
        time. The system checks {cronBatchSize.toLocaleString()} automatically
        every fifteen minutes — this button checks the next{" "}
        {selectedBatch.toLocaleString()} now instead of waiting (about{" "}
        {formatDuration(estimatedTotal)}).
      </p>

      <p className="mt-4 flex items-baseline gap-2">
        <span className="text-[clamp(1.75rem,4vw,2.5rem)] font-semibold leading-none tabular-nums tracking-[-0.03em] text-ink">
          {checked.toLocaleString()}
        </span>
        <span className="text-sm text-dim">
          of {total.toLocaleString()} clients checked
          {remaining > 0 && <> · {remaining.toLocaleString()} still to check</>}
        </span>
      </p>
      <div className="mt-3">
        <HorizontalStickGauge
          checked={checked}
          total={total}
          ariaLabel="Clients checked against 360Giving"
        />
      </div>

      {oldestPending && remaining > 0 && (
        <p className="mt-2 text-xs text-dim">
          The client waiting longest was last checked on{" "}
          {new Date(oldestPending).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
          .
        </p>
      )}

      <div className="mt-4 border-t border-rule-soft pt-4">
        <form
          action={action}
          onSubmit={() => {
            setElapsed(0);
            setLive(null);
            // The poll selects this attempt by start time with a backwards
            // margin: a client clock running ahead of the server would otherwise
            // place `since` after the run's own started_at and miss it. Latest
            // first, so an older press never shadows the live one.
            setAttemptSince(new Date(Date.now() - 60_000).toISOString());
          }}
          className="flex flex-wrap items-center gap-x-3 gap-y-3"
        >
          <label
            htmlFor="backfill-batch-size"
            className="text-[13px] font-medium text-dim"
          >
            Clients per check
          </label>
          <input
            id="backfill-batch-size"
            name="batchSize"
            type="number"
            min={1}
            max={maxBatchSize}
            step={1}
            value={batchInput}
            onChange={(event) => setBatchInput(event.target.value)}
            disabled={pending}
            inputMode="numeric"
            aria-describedby="backfill-batch-size-hint"
            className="h-10 w-20 rounded-inset border border-rule bg-white px-3 text-sm font-semibold tabular-nums text-ink outline-none focus:border-lead disabled:opacity-50"
          />
          <span id="backfill-batch-size-hint" className="sr-only">
            A whole number from 1 to {maxBatchSize}. Larger slices take longer.
          </span>
          <button
            type="submit"
            disabled={pending}
            aria-busy={pending || undefined}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-inset border border-lead bg-lead px-2.5 py-1 text-[13px] font-medium text-white transition-colors hover:bg-lead-mid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30 disabled:pointer-events-none disabled:opacity-50"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" strokeWidth={2.2} />}
            {pending ? "Checking…" : `Check the next ${selectedBatch.toLocaleString()} now`}
          </button>
          {state.kind !== "idle" && !pending && (
            <p
              className={`flex w-full items-start gap-1.5 text-xs font-semibold ${
                state.kind === "error" ? "text-stop" : "text-go"
              }`}
              role="status"
            >
              {state.kind === "success" && (
                <Check
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 shrink-0 text-go"
                  strokeWidth={2.5}
                />
              )}
              {state.message}
            </p>
          )}
        </form>

        {pending && (
          <div className="mt-3" aria-live="polite">
            {hasLiveCount ? (
              <>
                <p className="text-xs font-semibold text-ink" role="status">
                  {finishing ? "Done checking — saving the grants to the client records." : liveCountLabel}{" "}
                  <span className="font-normal text-dim">{formatDuration(elapsed)} so far.</span>
                </p>
                <div className="mt-2">
                  <HorizontalStickGauge
                    checked={liveWalked}
                    total={liveTotal}
                    ariaLabel="Current batch progress"
                    stickHeight={12}
                  />
                </div>
              </>
            ) : (
              <>
                <p className="text-xs font-semibold text-ink" role="status">
                  Checking {selectedBatch.toLocaleString()} clients, one by one —{" "}
                  {formatDuration(elapsed)} so far · about {formatDuration(estimatedLeft)} to go.
                </p>
                <div className="mt-2">
                  <HorizontalStickGauge
                    checked={Math.min(selectedBatch - 1, Math.round((attemptPercent / 100) * selectedBatch))}
                    total={selectedBatch}
                    ariaLabel="Current batch progress (estimated)"
                    stickHeight={12}
                  />
                </div>
              </>
            )}
            <p className="mt-1.5 text-xs text-dim">
              You can leave this page open — the results will appear here when
              the check finishes. You don&apos;t need to wait: the system keeps
              working through the list on its own.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
