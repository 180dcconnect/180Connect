"use client";

import { useActionState, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { HorizontalStickGauge } from "@/components/ui/horizontal-stick-gauge";
import {
  runAnnualReturnBackfillNow,
  type AnnualReturnBackfillState,
} from "./register-actions";

const INITIAL: AnnualReturnBackfillState = { kind: "idle", message: "" };

/**
 * Staff and volunteer counts, and the control that fills them in.
 *
 * The counts come from Part B of the annual return, which only the bulk extract
 * publishes. Anything whose accounts arrived through the API has income for
 * five years and a blank where the headcount should be, and the import screen
 * cannot fix it: a charity already on the client list is treated as a match, not
 * re-imported. So this is its own button.
 *
 * Unlike the 360Giving backfill next door there is nothing to pace against. The
 * register is a file already sitting in the deployment, so the whole thing is a
 * local read and one press normally finishes the job. No timer, no live count,
 * no fifteen minute schedule — a progress bar that reaches the end in a second
 * would be theatre.
 */
export function AnnualReturnCard({
  charities,
  covered,
  pending,
  pendingPeriods,
  maxBatchSize,
}: {
  /** Charities on the client list with a registration number. */
  charities: number;
  /** Of those, how many the register can add nothing to. */
  covered: number;
  /** Charities with details on the register that we have not copied across. */
  pending: number;
  /** Filed years those charities are missing between them. */
  pendingPeriods: number;
  /** Largest slice one press may take. */
  maxBatchSize: number;
}) {
  const [state, action, running] = useActionState(runAnnualReturnBackfillNow, INITIAL);

  // Null means untouched, and an untouched input tracks whatever is still
  // outstanding — normally that is one press for the whole job, and after a run
  // the revalidated count flows straight through without an effect resetting
  // state behind the reader. Once typed in, the raw string is kept so typing
  // stays natural; the action clamps it again, so an empty or wild value can
  // never widen the slice.
  const [typed, setTyped] = useState<string | null>(null);
  const fallback = String(Math.min(pending, maxBatchSize) || 1);
  const batchInput = typed ?? fallback;

  const parsed = Number(batchInput);
  const selected =
    Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maxBatchSize) : pending;

  return (
    <section className="rounded-panel border border-rule bg-white px-5 py-5 sm:px-6">
      <h2 className="font-body text-[19px] leading-[1.3] font-normal tracking-[-0.01em] text-ink">
        Staff and volunteer counts
      </h2>
      <p className="mt-1.5 text-[13px] leading-[1.55] text-dim">
        Charities report how many staff and volunteers they have on their annual
        return. That part of the return is only published in the register file,
        never through the live lookup, so clients whose accounts came in that way
        show no headcount at all. This copies it across from the register you
        already have.
      </p>

      <p className="mt-4 flex items-baseline gap-2">
        <span className="text-[clamp(1.75rem,4vw,2.5rem)] leading-none font-semibold tracking-[-0.03em] tabular-nums text-ink">
          {covered.toLocaleString()}
        </span>
        <span className="text-sm text-dim">
          of {charities.toLocaleString()} charities up to date
          {pending > 0 && (
            <>
              {" "}
              · {pending.toLocaleString()} with {pendingPeriods.toLocaleString()}{" "}
              {pendingPeriods === 1 ? "year" : "years"} to fill in
            </>
          )}
        </span>
      </p>
      <div className="mt-3">
        <HorizontalStickGauge
          checked={covered}
          total={charities}
          ariaLabel="Charities holding everything the register publishes"
        />
      </div>

      <div className="mt-4 border-t border-rule-soft pt-4">
        {pending === 0 && state.kind === "idle" ? (
          <p className="text-[13px] text-dim">
            Nothing outstanding. Every charity on the list already holds
            everything the register publishes about its filed years.
          </p>
        ) : (
          <form action={action} className="flex flex-wrap items-center gap-x-3 gap-y-3">
            <label
              htmlFor="annual-return-batch-size"
              className="text-[13px] font-medium text-dim"
            >
              Charities per run
            </label>
            <input
              id="annual-return-batch-size"
              name="batchSize"
              type="number"
              min={1}
              max={maxBatchSize}
              step={1}
              value={batchInput}
              onChange={(event) => setTyped(event.target.value)}
              disabled={running}
              inputMode="numeric"
              aria-describedby="annual-return-batch-size-hint"
              className="h-10 w-24 rounded-inset border border-rule bg-white px-3 text-sm font-semibold tabular-nums text-ink outline-none focus:border-lead disabled:opacity-50"
            />
            <span id="annual-return-batch-size-hint" className="sr-only">
              A whole number from 1 to {maxBatchSize}.
            </span>
            <button
              type="submit"
              disabled={running || pending === 0}
              aria-busy={running || undefined}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-inset border border-lead bg-lead px-2.5 py-1 text-[13px] font-medium text-white transition-colors hover:bg-lead-mid focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
            >
              {running && <Loader2 className="size-3.5 animate-spin" strokeWidth={2.2} />}
              {running
                ? "Filling in…"
                : selected >= pending
                  ? "Fill in all of them"
                  : `Fill in the next ${selected.toLocaleString()}`}
            </button>
            {state.kind !== "idle" && !running && (
              <p
                className={`flex w-full items-start gap-1.5 text-xs font-semibold ${
                  state.kind === "error" ? "text-stop" : "text-go"
                }`}
                role="status"
              >
                {state.kind === "done" && (
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
        )}
      </div>
    </section>
  );
}
