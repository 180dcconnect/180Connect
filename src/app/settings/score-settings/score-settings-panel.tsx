"use client";

import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, Check, Loader2, X } from "lucide-react";
import { Rise } from "@/components/dashboard-stage";
import { HorizontalStickGauge } from "@/components/ui/horizontal-stick-gauge";
import { StickSlider } from "@/components/ui/stick-slider";
import { INCOME_BAND_LABELS, INCOME_BAND_OPTIONS, type IncomeBand } from "@/lib/income-band";
import { SECTOR_TAXONOMY } from "@/lib/scoring/score-by-sector";
import {
  MAX_PRIORITY_TOWNS,
  MAX_TOWN_LENGTH,
  normaliseTownList,
  SECTOR_RANK_LADDER,
} from "@/lib/scoring/scout-config";
import { configInputsEqual, type ScoutConfigInput } from "@/lib/scoring/scout-config-inputs";
import {
  anyWeightCounts,
  SCOUT_WEIGHT_PARAMETERS,
  weightFieldName,
  weightShares,
  type ScoutWeightKey,
} from "@/lib/scoring/scout-weight-inputs";
import { rescoreScoresBatchAction, saveScoutConfigAction } from "./actions";
import {
  CARD,
  CARD_HINT,
  CARD_TITLE,
  FOOTNOTE,
  INPUT,
  PRIMARY_BUTTON,
  QUIET_BUTTON,
} from "../styles";

const EQUAL_WEIGHTS: ScoutConfigInput["weights"] = {
  sector: 20,
  geography: 20,
  size: 20,
  partnershipHistory: 20,
  previousContact: 20,
};

/** A word for how much a check counts, so the slider position reads as meaning. */
function importance(share: number): string {
  if (share === 0) return "Not counted";
  if (share < 10) return "Counts a little";
  if (share < 25) return "Counts some";
  if (share < 40) return "Counts a lot";
  return "Counts most";
}

function formatDuration(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(clamped / 60)}:${String(clamped % 60).padStart(2, "0")}`;
}

type Rescore =
  | { status: "idle" }
  | {
      status: "running" | "done" | "error";
      total: number;
      processed: number;
      failed: number;
      startedAt: number;
      finishedAt?: number;
      message?: string;
    };

/** One labelled 0-100 score slider, for the geography and income band scores. */
function ScoreRow({
  id,
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
}) {
  return (
    <li className="border-t border-rule-soft py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        <span className="text-[13px] text-dim">
          Scores <span className="font-semibold text-ink tabular-nums">{Math.round(value)}</span> out
          of 100
        </span>
      </div>
      {hint && <p className="mt-1 text-[13px] leading-[1.55] text-dim">{hint}</p>}
      <div className="mt-3 px-2">
        <StickSlider
          id={id}
          min={0}
          max={100}
          step={1}
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          aria-valuetext={`${Math.round(value)} out of 100`}
        />
      </div>
    </li>
  );
}

/**
 * F096 — the whole scoring setup on one screen.
 *
 * Four cards: how much each check counts, the sector ranking, the priority towns
 * with the score for being in or out of one, and the score per income band. One
 * sticky save bar for all of it, shown only once something changed.
 *
 * Saving does not wait on one long request. The action saves and returns how
 * many clients there are; this component then rescores them a batch at a time,
 * so the admin watches a live gauge, an elapsed timer and an estimate of the time
 * left — and a book of any size finishes, which the old single-request sweep
 * could not promise.
 */
export function ScoreSettingsPanel({
  initial,
  totalClients,
  staleClients,
}: {
  initial: ScoutConfigInput;
  totalClients: number;
  staleClients: number;
}) {
  const [saved, setSaved] = useState<ScoutConfigInput>(initial);
  const [values, setValues] = useState<ScoutConfigInput>(initial);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [rescore, setRescore] = useState<Rescore>({ status: "idle" });
  const [stale, setStale] = useState(staleClients);
  const [now, setNow] = useState(0);
  const [townDraft, setTownDraft] = useState("");
  const townInputId = useId();

  const running = rescore.status === "running";
  const busy = saving || running;
  const shares = weightShares(values.weights);
  const counts = anyWeightCounts(values.weights);
  const dirty = !configInputsEqual(values, saved);

  // Elapsed timer while scores update.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [running]);

  // Leaving mid-update stops it, so ask first.
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  function update(patch: Partial<ScoutConfigInput>) {
    setValues((current) => ({ ...current, ...patch }));
    setConfirming(false);
    setNotice(null);
  }

  function setWeight(key: ScoutWeightKey, value: number) {
    update({ weights: { ...values.weights, [key]: value } });
  }

  function moveSector(index: number, direction: -1 | 1) {
    const order = [...values.sectorOrder];
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    update({ sectorOrder: order });
  }

  function addTown() {
    const next = normaliseTownList([...values.priorityTowns, townDraft]);
    if (next.length === values.priorityTowns.length) {
      setTownDraft("");
      return;
    }
    update({ priorityTowns: next });
    setTownDraft("");
  }

  function onTownKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      addTown();
    }
  }

  async function runRescore(total: number) {
    const startedAt = Date.now();
    setNow(startedAt);
    let processed = 0;
    let failed = 0;
    let after: string | null = null;
    setRescore({ status: "running", total, processed, failed, startedAt });

    for (;;) {
      const result = await rescoreScoresBatchAction(after);
      if (!result.ok) {
        setRescore({
          status: "error",
          total,
          processed,
          failed,
          startedAt,
          finishedAt: Date.now(),
          message: result.message,
        });
        return;
      }
      processed += result.processed;
      failed += result.failed;
      after = result.nextAfterId;
      setRescore({ status: "running", total: Math.max(total, processed), processed, failed, startedAt });
      if (result.done) break;
    }

    setRescore({
      status: "done",
      total: Math.max(total, processed),
      processed,
      failed,
      startedAt,
      finishedAt: Date.now(),
    });
    setStale(0);
  }

  async function save() {
    setSaving(true);
    setNotice(null);
    const submitted = values;
    const result = await saveScoutConfigAction(submitted);
    setSaving(false);
    setConfirming(false);
    if (result.status === "error") {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    setSaved(submitted);
    if (result.status === "unchanged") {
      setNotice({ tone: "success", text: result.message });
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    await runRescore(result.total);
  }

  function discard() {
    setValues(saved);
    setConfirming(false);
    setNotice(null);
  }

  // ── progress figures ──
  const elapsedSeconds =
    rescore.status === "idle"
      ? 0
      : ((rescore.finishedAt ?? (now || rescore.startedAt)) - rescore.startedAt) / 1000;
  const processed = rescore.status === "idle" ? 0 : rescore.processed;
  const total = rescore.status === "idle" ? 0 : rescore.total;
  const rate = elapsedSeconds > 1 && processed > 0 ? processed / elapsedSeconds : 0;
  const secondsLeft = rate > 0 ? (total - processed) / rate : null;

  return (
    <Rise>
      <div className="space-y-4">
        {rescore.status !== "idle" && (
          <section aria-labelledby="rescore-heading" className={CARD} aria-live="polite">
            <h2 id="rescore-heading" className={CARD_TITLE}>
              {rescore.status === "running"
                ? "Updating client scores"
                : rescore.status === "done"
                  ? "Client scores updated"
                  : "Updating client scores stopped"}
            </h2>
            <p className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-[clamp(1.75rem,4vw,2.5rem)] leading-none font-semibold tracking-[-0.03em] text-ink tabular-nums">
                {processed.toLocaleString("en-GB")}
              </span>
              <span className="text-sm text-dim">
                of {total.toLocaleString("en-GB")} clients updated
              </span>
            </p>
            <div className="mt-3">
              <HorizontalStickGauge
                checked={processed}
                total={Math.max(total, 1)}
                ariaLabel="Client scores updated"
                showTooltip={false}
              />
            </div>

            {rescore.status === "running" && (
              <p className="mt-3 flex items-center gap-2 text-[13px] text-ink">
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin text-dim" />
                {formatDuration(elapsedSeconds)} so far
                {secondsLeft !== null && (
                  <span className="text-dim">· about {formatDuration(secondsLeft)} to go</span>
                )}
              </p>
            )}
            {rescore.status === "running" && (
              <p className={`mt-1.5 ${FOOTNOTE}`}>
                Keep this page open until it finishes — leaving stops the update. The client list
                shows the new order as each score updates.
              </p>
            )}
            {rescore.status === "done" && (
              <p className="mt-3 flex items-start gap-1.5 text-[13px] font-semibold text-go">
                <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.5} />
                Every client now uses the new settings. Took {formatDuration(elapsedSeconds)}.
                {rescore.failed > 0 &&
                  ` ${rescore.failed.toLocaleString("en-GB")} could not be updated and have been logged; they will update the next time their records change.`}
              </p>
            )}
            {rescore.status === "error" && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <p className="text-[13px] font-semibold text-stop">
                  {rescore.message} Your settings are saved; the remaining scores still need updating.
                </p>
                <button
                  type="button"
                  onClick={() => runRescore(totalClients || total)}
                  className={PRIMARY_BUTTON}
                >
                  Try again
                </button>
              </div>
            )}
          </section>
        )}

        {rescore.status === "idle" && stale > 0 && (
          <section aria-labelledby="stale-heading" className={CARD}>
            <h2 id="stale-heading" className={CARD_TITLE}>
              Some scores are out of date
            </h2>
            <p className={CARD_HINT}>
              {stale.toLocaleString("en-GB")} {stale === 1 ? "client still has a score" : "clients still have scores"}{" "}
              from before the latest settings — usually because an update was stopped part-way.
            </p>
            <div className="mt-4 border-t border-rule-soft pt-4">
              <button
                type="button"
                onClick={() => runRescore(totalClients)}
                disabled={busy}
                className={PRIMARY_BUTTON}
              >
                Update every client&rsquo;s score now
              </button>
            </div>
          </section>
        )}

        {/* ── 1. How much each check counts ── */}
        <section aria-labelledby="weights-heading" className={CARD}>
          <h2 id="weights-heading" className={CARD_TITLE}>
            What makes a client a priority
          </h2>
          <p className={CARD_HINT}>
            Every client gets a priority score from the five checks below, which decides the order
            of the client list. Drag a handle to make a check count more or less. The numbers
            don&rsquo;t need to add up to anything — each check shows its real share of the score.
          </p>
          <ul className="mt-4">
            {SCOUT_WEIGHT_PARAMETERS.map((parameter) => {
              const id = weightFieldName(parameter.key);
              const share = shares[parameter.key];
              return (
                <li key={parameter.key} className="border-t border-rule-soft py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                    <label htmlFor={id} className="text-sm font-medium text-ink">
                      {parameter.label}
                    </label>
                    <span className="text-[13px] text-dim">
                      <span className="font-semibold text-ink tabular-nums">{Math.round(share)}%</span>{" "}
                      of the score · {importance(share)}
                    </span>
                  </div>
                  <p id={`${id}-hint`} className="mt-1 text-[13px] leading-[1.55] text-dim">
                    {parameter.description}
                  </p>
                  <div className="mt-3 px-2">
                    <StickSlider
                      id={id}
                      min={0}
                      max={100}
                      step={0.1}
                      value={values.weights[parameter.key]}
                      onValueChange={(next) => setWeight(parameter.key, next)}
                      disabled={busy}
                      aria-describedby={`${id}-hint`}
                      aria-valuetext={`${Math.round(share)}% of the score`}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          {!counts && (
            <p role="alert" className="mt-2 rounded-inset bg-stop-wash px-3 py-2.5 text-[13px] text-stop">
              Every check is set to zero, so every client would score zero. Turn at least one up
              before saving.
            </p>
          )}
          <div className="mt-4 border-t border-rule-soft pt-4">
            <button
              type="button"
              onClick={() => update({ weights: EQUAL_WEIGHTS })}
              disabled={busy}
              className={QUIET_BUTTON}
            >
              Make every check count equally
            </button>
          </div>
        </section>

        {/* ── 2. Sector ranking ── */}
        <section aria-labelledby="sector-heading" className={CARD}>
          <h2 id="sector-heading" className={CARD_TITLE}>
            Sector ranking
          </h2>
          <p className={CARD_HINT}>
            Put the kinds of work the branch most wants to help at the top. Move a sector with the
            arrows. A client with no sector recorded scores 50, in the middle.
          </p>
          <ol className="mt-4">
            {values.sectorOrder.map((category, index) => (
              <li
                key={category}
                className="flex items-start gap-4 border-t border-rule-soft py-3.5"
              >
                <span className="w-7 shrink-0 font-body text-[22px] leading-none font-light text-faint tabular-nums">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{category}</p>
                  <p className="mt-0.5 text-[13px] leading-[1.55] text-dim">
                    {SECTOR_TAXONOMY[category].join(", ")}
                  </p>
                </div>
                <span className="shrink-0 pt-0.5 text-[13px] text-dim tabular-nums">
                  Scores {Math.round((SECTOR_RANK_LADDER[index] ?? 0) * 100)}
                </span>
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => moveSector(index, -1)}
                    disabled={busy || index === 0}
                    aria-label={`Move ${category} up`}
                    className="rounded-inset p-1.5 text-dim transition-colors hover:bg-paper hover:text-ink disabled:pointer-events-none disabled:opacity-30"
                  >
                    <ArrowUp className="size-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSector(index, 1)}
                    disabled={busy || index === values.sectorOrder.length - 1}
                    aria-label={`Move ${category} down`}
                    className="rounded-inset p-1.5 text-dim transition-colors hover:bg-paper hover:text-ink disabled:pointer-events-none disabled:opacity-30"
                  >
                    <ArrowDown className="size-4" aria-hidden="true" />
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* ── 3. Priority towns ── */}
        <section aria-labelledby="towns-heading" className={CARD}>
          <h2 id="towns-heading" className={CARD_TITLE}>
            Priority towns
          </h2>
          <p className={CARD_HINT}>
            The towns and local authorities the branch focuses on. The same list decides which
            charities are flagged as local when you import them.
          </p>

          <div className="mt-4 border-t border-rule-soft pt-4">
            {values.priorityTowns.length > 0 ? (
              <ul className="flex flex-wrap gap-2" aria-label="Priority towns">
                {values.priorityTowns.map((town) => (
                  <li
                    key={town.toLowerCase()}
                    className="flex items-center gap-1 rounded-full bg-paper py-1 pr-1 pl-3 text-[13px] text-ink"
                  >
                    {town}
                    <button
                      type="button"
                      onClick={() =>
                        update({ priorityTowns: values.priorityTowns.filter((item) => item !== town) })
                      }
                      disabled={busy}
                      aria-label={`Remove ${town}`}
                      className="rounded-full p-1 text-dim transition-colors hover:bg-paper-sunk hover:text-ink disabled:opacity-50"
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-inset bg-hold-wash px-3 py-2.5 text-[13px] text-ink">
                No priority towns are set, so the Geography check scores every client the same and
                imports only treat a charity as local by its postcode.
              </p>
            )}

            <label htmlFor={townInputId} className="mt-4 block text-[13px] font-medium text-dim">
              Add a town
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                id={townInputId}
                type="text"
                value={townDraft}
                onChange={(event) => setTownDraft(event.target.value)}
                onKeyDown={onTownKey}
                maxLength={MAX_TOWN_LENGTH}
                placeholder="e.g. Chesterfield"
                disabled={busy || values.priorityTowns.length >= MAX_PRIORITY_TOWNS}
                className={`${INPUT} max-w-full flex-1 sm:w-auto`}
              />
              <button
                type="button"
                onClick={addTown}
                disabled={busy || !townDraft.trim() || values.priorityTowns.length >= MAX_PRIORITY_TOWNS}
                className={PRIMARY_BUTTON}
              >
                Add
              </button>
            </div>
          </div>

          <ul className="mt-4">
            <ScoreRow
              id="geography-inside"
              label="Based in a priority town"
              value={values.geography.inside}
              onChange={(inside) => update({ geography: { ...values.geography, inside } })}
              disabled={busy}
            />
            <ScoreRow
              id="geography-outside"
              label="Based anywhere else"
              hint="A client with no town recorded scores 50, in the middle."
              value={values.geography.outside}
              onChange={(outside) => update({ geography: { ...values.geography, outside } })}
              disabled={busy}
            />
          </ul>
        </section>

        {/* ── 4. Income bands ── */}
        <section aria-labelledby="size-heading" className={CARD}>
          <h2 id="size-heading" className={CARD_TITLE}>
            Income bands
          </h2>
          <p className={CARD_HINT}>
            How the Size check scores each income band, from the client&rsquo;s latest published
            accounts. A client with no accounts on record scores 50, in the middle. The bands
            themselves are fixed.
          </p>
          <ul className="mt-4">
            {INCOME_BAND_OPTIONS.map((band: IncomeBand) => (
              <ScoreRow
                key={band}
                id={`size-${band}`}
                label={INCOME_BAND_LABELS[band]}
                value={values.sizeScores[band]}
                onChange={(score) => update({ sizeScores: { ...values.sizeScores, [band]: score } })}
                disabled={busy}
              />
            ))}
          </ul>
          <p className={`mt-4 border-t border-rule-soft pt-4 ${FOOTNOTE}`}>
            Every change is recorded in the audit log with who made it and when.
          </p>
        </section>

        {(dirty || notice) && !running && (
          <div className="sticky bottom-4 z-10 mx-auto flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-panel border border-rule bg-white px-4 py-3 sm:w-1/2">
            {confirming ? (
              <>
                <p className="mr-auto text-[13px] leading-[1.55] text-ink">
                  This recalculates every client&rsquo;s score and reorders the client list for the
                  whole team. You&rsquo;ll see the progress as it happens.
                </p>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={saving}
                  className={QUIET_BUTTON}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  aria-busy={saving || undefined}
                  className={PRIMARY_BUTTON}
                >
                  {saving && <Loader2 className="size-3.5 animate-spin" strokeWidth={2.2} />}
                  {saving ? "Saving…" : "Yes, save"}
                </button>
              </>
            ) : (
              <>
                <p aria-live="polite" className="mr-auto flex items-center gap-2 text-[13px]">
                  {notice?.tone === "error" ? (
                    <span className="font-semibold text-stop">{notice.text}</span>
                  ) : dirty ? (
                    <span className="flex items-center gap-2 text-ink">
                      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-hold" />
                      Unsaved changes
                    </span>
                  ) : notice ? (
                    <span className="flex items-center gap-1.5 font-semibold text-go">
                      <Check aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.5} />
                      {notice.text}
                    </span>
                  ) : null}
                </p>
                {dirty && (
                  <button type="button" onClick={discard} disabled={busy} className={QUIET_BUTTON}>
                    Discard
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={busy || !dirty || !counts}
                  className={PRIMARY_BUTTON}
                >
                  Save
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </Rise>
  );
}
