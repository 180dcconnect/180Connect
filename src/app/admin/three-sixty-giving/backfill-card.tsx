"use client";

import { useActionState } from "react";
import { HandCoins } from "lucide-react";

import { OriginButton } from "@/components/ui/origin-button";
import { runBackfillBatchNow, type BackfillState } from "./actions";

const INITIAL: BackfillState = { kind: "idle", message: "" };

/**
 * How much of the client list has been checked against 360Giving, and a button
 * to move it along by one slice.
 *
 * The progress bar is the honest replacement for the old bulk-import button.
 * That button claimed to walk the whole client list and could not — it ran out
 * of time partway through, every time, and reported the partial result as a
 * finished one. A count that goes up on its own says the same thing truthfully:
 * this is a job in progress, here is where it has got to.
 */
export function BackfillCard({
  checked,
  total,
  batchSize,
  oldestPending,
}: {
  checked: number;
  total: number;
  batchSize: number;
  /** When the least recently checked organisation was last looked at. */
  oldestPending: string | null;
}) {
  const [state, action, pending] = useActionState(runBackfillBatchNow, INITIAL);

  const remaining = Math.max(total - checked, 0);
  const percent = total === 0 ? 0 : Math.round((checked / total) * 100);

  return (
    <section className="mt-8 rounded-2xl border border-black/[0.07] bg-white p-5 shadow-xs sm:p-6">
      <div className="flex items-start gap-3.5">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
          <HandCoins className="h-4 w-4" strokeWidth={2.2} />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-foreground">Grant history coverage</h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-[1.6] text-foreground/65">
            360Giving is asked about one organisation at a time, so the client
            list is worked through gradually — {batchSize.toLocaleString()} every
            fifteen minutes, automatically. This button takes the next slice now
            rather than waiting.
          </p>
        </div>
      </div>

      <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
        <span className="text-foreground/70">{checked.toLocaleString()}</span> of{" "}
        <span className="text-foreground/70">{total.toLocaleString()}</span> checked
        {remaining > 0 && <> · {remaining.toLocaleString()} queued</>}
      </p>

      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-black/[0.06]"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Organisations checked against 360Giving"
      >
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>

      {oldestPending && remaining > 0 && (
        <p className="mt-2 text-xs text-foreground/55">
          Oldest unchecked record last looked at{" "}
          {new Date(oldestPending).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
          .
        </p>
      )}

      <form action={action} className="mt-4 flex flex-wrap items-center gap-3">
        <OriginButton type="submit" disabled={pending} size="md">
          {pending ? "Checking…" : "Run the next batch now"}
        </OriginButton>
        {state.kind !== "idle" && (
          <p
            className={`text-xs font-semibold ${
              state.kind === "error" ? "text-red-800" : "text-foreground/60"
            }`}
            role="status"
          >
            {state.message}
          </p>
        )}
      </form>
    </section>
  );
}
