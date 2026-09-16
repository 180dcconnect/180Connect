"use client";

import { useActionState, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { HorizontalStickGauge } from "@/components/ui/horizontal-stick-gauge";
import { VIEW_ONLY_CONTROL_NOTE } from "@/lib/auth/view-only";
import {
  runCompanyNumberBackfillNow,
  type CompanyNumberBackfillState,
} from "./register-actions";

const INITIAL: CompanyNumberBackfillState = { kind: "idle", message: "" };

/**
 * The second registration number, and the control that fills it in.
 *
 * A charity that is also a company has two numbers, and the register publishes
 * both. A client created from the register or from an import carries both; one
 * added by hand carries only the number the person typed — so the record cannot
 * answer "is this also a company", and the grant lookup can only ask 360Giving
 * about one of the two. Re-importing does not help, because an organisation
 * already on the list is recognised as a duplicate and skipped.
 *
 * A local file read and one inserted row per charity, so there is nothing to
 * pace against and one press normally finishes the job.
 */
export function CompanyNumberCard({
  charities,
  covered,
  pending,
  maxBatchSize,
  readOnly = false,
}: {
  /** Charities on the client list with a registration number. */
  charities: number;
  /** Of those, how many need nothing — a company number is already held, or the
   *  register publishes none for this charity. */
  covered: number;
  /** Charities whose second number the register file can supply. */
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
  const [state, action, running] = useActionState(runCompanyNumberBackfillNow, INITIAL);

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
        Companies House numbers
      </h2>
      <p className="mt-1.5 text-[13px] leading-[1.55] text-dim">
        A charity that is also a company has two registration numbers, and the
        register publishes both. A client that came in through the register or an
        import already carries both. One added by hand carries only the number
        somebody typed, which is why a client can look like it has no company
        number at all. This copies the register&rsquo;s own company number onto
        those clients as a second number, so the record and the grant lookup can
        use either.
      </p>
      <p className="mt-1.5 text-[13px] leading-[1.55] text-dim">
        Nothing here is changed or removed: a client that already has a company
        number, or that the register says is not a company, is left exactly as it
        is.
      </p>

      <p className="mt-4 flex items-baseline gap-2">
        <span className="text-[clamp(1.75rem,4vw,2.5rem)] leading-none font-semibold tracking-[-0.03em] tabular-nums text-ink">
          {covered.toLocaleString()}
        </span>
        <span className="text-sm text-dim">
          of {charities.toLocaleString()} charities up to date
          {pending > 0 && <> · {pending.toLocaleString()} with a company number to add</>}
        </span>
      </p>
      <div className="mt-3">
        <HorizontalStickGauge
          checked={covered}
          total={charities}
          ariaLabel="Charities holding every number the register publishes for them"
        />
      </div>

      <div className="mt-4 border-t border-rule-soft pt-4">
        {readOnly ? (
          <p className="text-[13px] text-dim">{VIEW_ONLY_CONTROL_NOTE}</p>
        ) : pending === 0 && state.kind === "idle" ? (
          <p className="text-[13px] text-dim">
            Nothing outstanding. Every charity the register publishes a company
            number for already carries it.
          </p>
        ) : (
          <form action={action} className="flex flex-wrap items-center gap-x-3 gap-y-3">
            <label htmlFor="company-number-batch-size" className="text-[13px] font-medium text-dim">
              Charities per run
            </label>
            <input
              id="company-number-batch-size"
              name="batchSize"
              type="number"
              min={1}
              max={maxBatchSize}
              step={1}
              value={batchInput}
              onChange={(event) => setTyped(event.target.value)}
              disabled={running}
              inputMode="numeric"
              aria-describedby="company-number-batch-size-hint"
              className="h-10 w-24 rounded-inset border border-rule bg-white px-3 text-sm font-semibold tabular-nums text-ink outline-none focus:border-lead disabled:opacity-50"
            />
            <span id="company-number-batch-size-hint" className="sr-only">
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
                ? "Adding…"
                : selected >= pending
                  ? "Add them all"
                  : `Add the next ${selected.toLocaleString()}`}
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
