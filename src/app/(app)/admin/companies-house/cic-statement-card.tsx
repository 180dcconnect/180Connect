"use client";

import { useActionState, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { HorizontalStickGauge } from "@/components/ui/horizontal-stick-gauge";
import { runCicStatementBackfillNow, type CicBackfillState } from "./register-actions";

const INITIAL: CicBackfillState = { kind: "idle", message: "" };

/**
 * What a company says it is for, and the control that reads it.
 *
 * The companies-side twin of the charity screen's "Mission and sector from the
 * register" card, and it closes a worse gap. A charity files a description of
 * its work that we ingest as a matter of course; Companies House publishes no
 * such field for a company, so every company on the client list arrives with no
 * purpose text at all and a booklet written from one says as much.
 *
 * Community Interest Companies do file one — the CIC36 community interest
 * statement, at incorporation, approved by the CIC Regulator. It is only ever
 * published as a scanned page, so reading it means fetching the filing and
 * transcribing it. Nothing is generated: the stored text is the company's own
 * filed words, and where the scan is poor it is imperfectly transcribed rather
 * than plausibly invented.
 *
 * Unlike the charity card beside it, one press does not finish the job. Each
 * company costs two API calls, a ~1.2MB download and several seconds of OCR, so
 * the batch is small on purpose and a full catch-up belongs to
 * `npm run backfill:cic-statements`, which has no timeout to run into.
 */
export function CicStatementCard({
  companies,
  checked,
  withStatement,
  pending,
  maxBatchSize,
  unavailableReason,
}: {
  /** Companies on the client list carrying a company number. */
  companies: number;
  /** Of those, how many have been asked about — including the ones with no CIC36. */
  checked: number;
  /** …and how many of those actually yielded a statement. */
  withStatement: number;
  /** Still to ask about. */
  pending: number;
  /** Largest slice one press may take. */
  maxBatchSize: number;
  /** Why the job cannot run at all, if it cannot — a missing language model or
   *  API key. Shown in place of the control, because a disabled button with no
   *  explanation is the thing people file bugs about. */
  unavailableReason: string | null;
}) {
  const [state, action, running] = useActionState(runCicStatementBackfillNow, INITIAL);

  // Null means untouched, and an untouched input tracks whatever is still
  // outstanding — same rule as the charity card, for the same reason: after a
  // run the revalidated count flows straight through rather than an effect
  // resetting state behind the reader.
  const [typed, setTyped] = useState<string | null>(null);
  const fallback = String(Math.min(pending, maxBatchSize) || 1);
  const batchInput = typed ?? fallback;

  const parsed = Number(batchInput);
  const selected =
    Number.isInteger(parsed) && parsed > 0
      ? Math.min(parsed, maxBatchSize)
      : Math.min(pending, maxBatchSize);

  return (
    <section className="rounded-panel border border-rule bg-white px-5 py-5 sm:px-6">
      <h2 className="font-body text-[19px] leading-[1.3] font-normal tracking-[-0.01em] text-ink">
        Community interest statements
      </h2>
      <p className="mt-1.5 text-[13px] leading-[1.55] text-dim">
        Every Community Interest Company files a CIC36 at incorporation saying
        which community it intends to benefit and what it will actually do. It is
        the closest thing a company has to a charity&rsquo;s filed activities,
        and Companies House publishes it only as a scanned page — so this reads
        the filing and transcribes it. The text stored is the company&rsquo;s
        own, and it is usually cut short where the form&rsquo;s box ran out.
      </p>

      <p className="mt-4 flex items-baseline gap-2">
        <span className="text-[clamp(1.75rem,4vw,2.5rem)] leading-none font-semibold tracking-[-0.03em] tabular-nums text-ink">
          {withStatement.toLocaleString()}
        </span>
        <span className="text-sm text-dim">
          of {companies.toLocaleString()} companies with a statement on record
          {checked > withStatement && (
            <>
              {" "}
              · {(checked - withStatement).toLocaleString()} had no CIC36 to read
            </>
          )}
          {pending > 0 && <> · {pending.toLocaleString()} still to ask about</>}
        </span>
      </p>
      <div className="mt-3">
        <HorizontalStickGauge
          checked={checked}
          total={companies}
          ariaLabel="Companies whose filings have been checked for a CIC36"
        />
      </div>

      <div className="mt-4 border-t border-rule-soft pt-4">
        {unavailableReason ? (
          <p className="text-[13px] text-stop">{unavailableReason}</p>
        ) : pending === 0 && state.kind === "idle" ? (
          <p className="text-[13px] text-dim">
            Nothing outstanding. Every company on the list has been checked —
            the ones without a statement have no CIC36 on file.
          </p>
        ) : (
          <form action={action} className="flex flex-wrap items-center gap-x-3 gap-y-3">
            <label htmlFor="cic-batch-size" className="text-[13px] font-medium text-dim">
              Companies per run
            </label>
            <input
              id="cic-batch-size"
              name="batchSize"
              type="number"
              min={1}
              max={maxBatchSize}
              step={1}
              value={batchInput}
              onChange={(event) => setTyped(event.target.value)}
              disabled={running}
              inputMode="numeric"
              aria-describedby="cic-batch-size-hint"
              className="h-10 w-24 rounded-inset border border-rule bg-white px-3 text-sm font-semibold tabular-nums text-ink outline-none focus:border-lead disabled:opacity-50"
            />
            <span id="cic-batch-size-hint" className="sr-only">
              A whole number from 1 to {maxBatchSize}.
            </span>
            <button
              type="submit"
              disabled={running || pending === 0}
              aria-busy={running || undefined}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-inset border border-lead bg-lead px-2.5 py-1 text-[13px] font-medium text-white transition-colors hover:bg-lead-mid focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
            >
              {running && <Loader2 className="size-3.5 animate-spin" strokeWidth={2.2} />}
              {running ? "Reading filings…" : `Read the next ${selected.toLocaleString()}`}
            </button>
            {/* Said plainly rather than hidden behind the spinner: a few
                seconds per company means a full batch takes minutes, and a
                reader who does not expect that reads it as a hang. */}
            <p className="w-full text-xs text-faint">
              Roughly five seconds per company — {selected.toLocaleString()} will take
              about {Math.max(1, Math.round((selected * 5) / 60))}{" "}
              {Math.max(1, Math.round((selected * 5) / 60)) === 1 ? "minute" : "minutes"}.
              {pending > maxBatchSize && (
                <>
                  {" "}
                  For the whole queue, run{" "}
                  <code className="font-mono text-[11px]">
                    npm run backfill:cic-statements
                  </code>
                  .
                </>
              )}
            </p>
            {state.kind !== "idle" && !running && (
              <p
                className={`flex w-full items-start gap-1.5 text-xs font-semibold ${
                  state.kind === "error" ? "text-stop" : "text-go"
                }`}
                role="status"
              >
                {state.kind === "done" && (
                  <Check aria-hidden="true" className="mt-px size-3.5 shrink-0" strokeWidth={2.4} />
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
