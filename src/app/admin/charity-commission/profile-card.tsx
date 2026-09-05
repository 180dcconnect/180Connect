"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";

import { runProfileBackfillNow, type ProfileBackfillState } from "./register-actions";

const INITIAL: ProfileBackfillState = { kind: "idle", message: "" };

/**
 * The register's own description of a charity, and the control that fills it in.
 *
 * Same shape of gap as the headcount card above it, one step earlier in the
 * record: the activities text, the sector, the registration date and the
 * reporting status are written by the import only when a charity is created, so
 * anything already on the client list when the bulk path arrived never received
 * them. A booklet generated for one of those clients says the register lists no
 * mission or activities, which reads as a fact about the charity rather than
 * about our copy of it.
 *
 * A local file read and one update per charity, so — like the Part B card —
 * there is nothing to pace against and one press normally finishes the job.
 */
export function RegisterProfileCard({
  charities,
  covered,
  pending,
  pendingFields,
  maxBatchSize,
}: {
  /** Charities on the client list with a registration number. */
  charities: number;
  /** Of those, how many the register can add nothing to. */
  covered: number;
  /** Charities with profile details on the register we have not copied across. */
  pending: number;
  /** Field values those charities are missing between them. */
  pendingFields: number;
  /** Largest slice one press may take. */
  maxBatchSize: number;
}) {
  const [state, action, running] = useActionState(runProfileBackfillNow, INITIAL);

  // Null means untouched, and an untouched input tracks whatever is still
  // outstanding — the same rule as the card above, for the same reason: after a
  // run the revalidated count flows straight through rather than an effect
  // resetting state behind the reader.
  const [typed, setTyped] = useState<string | null>(null);
  const fallback = String(Math.min(pending, maxBatchSize) || 1);
  const batchInput = typed ?? fallback;

  const parsed = Number(batchInput);
  const selected =
    Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maxBatchSize) : pending;

  const percent = charities === 0 ? 0 : Math.round((covered / charities) * 100);

  return (
    <section className="rounded-panel border border-rule bg-white px-5 py-5 sm:px-6">
      <h2 className="font-body text-[19px] leading-[1.3] font-normal tracking-[-0.01em] text-ink">
        Mission and sector from the register
      </h2>
      <p className="mt-1.5 max-w-[54ch] text-[13px] leading-[1.55] text-dim">
        Every charity files its own description of what it does, along with the
        classifications the sector is read from. Clients added before the
        register import existed never received either, and re-importing skips
        them as duplicates. This copies both across, plus the registration date
        and reporting status, without touching anything already filled in.
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
              · {pending.toLocaleString()} with {pendingFields.toLocaleString()}{" "}
              {pendingFields === 1 ? "field" : "fields"} to fill in
            </>
          )}
        </span>
      </p>
      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-paper"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Charities holding the register's profile details"
      >
        <div
          className="h-full rounded-full bg-lead transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="mt-4 border-t border-rule-soft pt-4">
        {pending === 0 && state.kind === "idle" ? (
          <p className="text-[13px] text-dim">
            Nothing outstanding. Every charity on the list already holds what the
            register publishes about its mission and sector.
          </p>
        ) : (
          <form action={action} className="flex flex-wrap items-center gap-x-3 gap-y-3">
            <label htmlFor="profile-batch-size" className="text-[13px] font-medium text-dim">
              Charities per run
            </label>
            <input
              id="profile-batch-size"
              name="batchSize"
              type="number"
              min={1}
              max={maxBatchSize}
              step={1}
              value={batchInput}
              onChange={(event) => setTyped(event.target.value)}
              disabled={running}
              inputMode="numeric"
              aria-describedby="profile-batch-size-hint"
              className="h-10 w-24 rounded-inset border border-rule bg-white px-3 text-sm font-semibold tabular-nums text-ink outline-none focus:border-lead disabled:opacity-50"
            />
            <span id="profile-batch-size-hint" className="sr-only">
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
                className={`text-xs font-semibold ${
                  state.kind === "error" ? "text-stop" : "text-dim"
                }`}
                role="status"
              >
                {state.message}
              </p>
            )}
          </form>
        )}
      </div>
    </section>
  );
}
