"use client";

import { useActionState } from "react";
import {
  SCOUT_WEIGHT_PARAMETERS,
  toPercentages,
  weightFieldName,
  type ScoutWeightsInput,
} from "@/lib/scoring/scout-weight-inputs";
import { saveScoutWeightsAction, type ScoreSettingsState } from "./actions";

const initialState: ScoreSettingsState = { status: "idle" };

type Props = {
  activeVersion: string | null;
  activeWeights: ScoutWeightsInput;
  /** Set when the weights on screen came from the fallback, not the database. */
  degraded: boolean;
};

export function ScoreSettingsPanel({ activeVersion, activeWeights, degraded }: Props) {
  const [state, formAction, pending] = useActionState(saveScoutWeightsAction, initialState);

  const displayed = state.status === "success" && !state.fieldErrors ? null : activeWeights;
  const percentages = toPercentages(displayed ?? activeWeights);
  const total = Math.round(
    SCOUT_WEIGHT_PARAMETERS.reduce(
      (sum, parameter) => sum + (percentages[parameter.key] || 0),
      0,
    ),
  );

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">Active weights</h2>
        <p className="text-sm text-foreground/60">
          {degraded
            ? "Could not read the stored configuration — showing defaults."
            : activeVersion
              ? `SCOUT ${activeVersion}`
              : "No active scoring version found."}
        </p>
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-[1.7] text-foreground/65">
        Each parameter&apos;s share of a client&apos;s priority score. Weights are
        relative — they do not have to add up to 100%, but keeping them there makes
        each one readable as &quot;X% of the score&quot;. Saving applies the new
        weights to every existing client immediately and records who changed what,
        when, in the audit log.
      </p>

      <form action={formAction} className="mt-8 space-y-6">
        {SCOUT_WEIGHT_PARAMETERS.map((parameter) => (
          <div key={parameter.key}>
            <label
              className="flex flex-wrap items-baseline justify-between gap-2 font-bold"
              htmlFor={weightFieldName(parameter.key)}
            >
              {parameter.label}
              <span className="text-sm font-normal tabular-nums text-foreground/55">
                {percentages[parameter.key]}%
              </span>
            </label>
            <input
              id={weightFieldName(parameter.key)}
              name={weightFieldName(parameter.key)}
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="0.1"
              defaultValue={percentages[parameter.key]}
              aria-describedby={`${parameter.key}-hint`}
              disabled={pending}
              className="mt-2 w-full max-w-40 rounded-xl border border-black/15 bg-white px-4 py-2.5 text-right font-bold tabular-nums outline-none focus:border-brand"
            />
            <p
              id={`${parameter.key}-hint`}
              className="mt-1.5 max-w-2xl text-sm leading-relaxed text-foreground/50"
            >
              {parameter.description}
            </p>
            {state.fieldErrors?.[parameter.key] && (
              <p className="mt-1.5 text-sm font-bold text-destructive" role="alert">
                {state.fieldErrors[parameter.key]}
              </p>
            )}
          </div>
        ))}

        <p className="text-sm tabular-nums text-foreground/55">
          Total entered: {total}%
        </p>

        {state.status !== "idle" && state.message && (
          <p
            role="alert"
            className={
              state.status === "error"
                ? "rounded-2xl border border-destructive/20 bg-destructive/[0.06] px-5 py-4 text-sm font-bold text-destructive"
                : "rounded-2xl border border-brand/25 bg-brand/[0.07] px-5 py-4 text-sm font-bold text-foreground"
            }
          >
            {state.message}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-brand px-7 py-3 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving and rescoring…" : "Save weights"}
        </button>
      </form>
    </div>
  );
}
