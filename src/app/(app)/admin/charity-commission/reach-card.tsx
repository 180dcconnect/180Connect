"use client";

import { useActionState, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { HorizontalStickGauge } from "@/components/ui/horizontal-stick-gauge";
import { VIEW_ONLY_CONTROL_NOTE } from "@/lib/auth/view-only";
import { runReachBackfillNow, type ReachBackfillState } from "./register-actions";

const INITIAL: ReachBackfillState = { kind: "idle", message: "" };

/**
 * How far each charity works, and the control that fills it in.
 *
 * The same shape of gap as the two cards above it: the import works this out
 * from the areas a charity declares on its annual return, but only for
 * charities it is creating, so anything already on the client list never
 * received it — and re-importing skips them as duplicates.
 *
 * A local file read and one update per charity, so there is nothing to pace
 * against and one press normally finishes the job.
 */
export function GeographicReachCard({
  charities,
  covered,
  pending,
  maxBatchSize,
  readOnly = false,
}: {
  /** Charities on the client list with a registration number. */
  charities: number;
  /** Of those, how many need nothing — already filled in, or the charity
   *  declared no areas for us to read. */
  covered: number;
  /** Charities whose reach the register can tell us. */
  pending: number;
  /** Largest slice one press may take. */
  maxBatchSize: number;
  /**
   * Set for leadership: the counts still render, the control does not. The
   * action behind it refuses a viewer, so drawing the button would only offer
   * them a refusal.
   */
  readOnly?: boolean;
}) {
  const [state, action, running] = useActionState(runReachBackfillNow, INITIAL);

  // Null means untouched, and an untouched input tracks whatever is still
  // outstanding — the same rule as the cards above, so after a run the
  // revalidated count flows straight through rather than an effect resetting
  // state behind the reader.
  const [typed, setTyped] = useState<string | null>(null);
  const fallback = String(Math.min(pending, maxBatchSize) || 1);
  const batchInput = typed ?? fallback;

  const parsed = Number(batchInput);
  const selected =
    Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maxBatchSize) : pending;

  return (
    <section className="rounded-panel border border-rule bg-white px-5 py-5 sm:px-6">
      <h2 className="font-body text-[19px] leading-[1.3] font-normal tracking-[-0.01em] text-ink">
        How far each charity works
      </h2>
      <p className="mt-1.5 text-[13px] leading-[1.55] text-dim">
        Every charity tells the regulator which areas it operates in — one
        council, several, a whole nation, or countries abroad. That becomes
        local, regional, national or international on the client record, which
        is what outreach drafts read and what CAMs can prioritise by. Clients
        added before this was worked out never received it. Anything already
        filled in, by an import or by hand, is left exactly as it is.
      </p>

      <p className="mt-4 flex items-baseline gap-2">
        <span className="text-[clamp(1.75rem,4vw,2.5rem)] leading-none font-semibold tracking-[-0.03em] tabular-nums text-ink">
          {covered.toLocaleString()}
        </span>
        <span className="text-sm text-dim">
          of {charities.toLocaleString()} charities up to date
          {pending > 0 && <> · {pending.toLocaleString()} the register can tell us about</>}
        </span>
      </p>
      <div className="mt-3">
        <HorizontalStickGauge
          checked={covered}
          total={charities}
          ariaLabel="Charities holding how far they work"
        />
      </div>

      <div className="mt-4 border-t border-rule-soft pt-4">
        {readOnly ? (
          <p className="text-[13px] text-dim">{VIEW_ONLY_CONTROL_NOTE}</p>
        ) : pending === 0 && state.kind === "idle" ? (
          <p className="text-[13px] text-dim">
            Nothing outstanding. Every charity the register declares areas for
            already says how far it works.
          </p>
        ) : (
          <form action={action} className="flex flex-wrap items-center gap-x-3 gap-y-3">
            <label htmlFor="reach-batch-size" className="text-[13px] font-medium text-dim">
              Charities per run
            </label>
            <input
              id="reach-batch-size"
              name="batchSize"
              type="number"
              min={1}
              max={maxBatchSize}
              step={1}
              value={batchInput}
              onChange={(event) => setTyped(event.target.value)}
              disabled={running}
              inputMode="numeric"
              aria-describedby="reach-batch-size-hint"
              className="h-10 w-24 rounded-inset border border-rule bg-white px-3 text-sm font-semibold tabular-nums text-ink outline-none focus:border-lead disabled:opacity-50"
            />
            <span id="reach-batch-size-hint" className="sr-only">
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
