"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, Loader2, Search, X } from "lucide-react";
import { Group, Rise } from "@/components/dashboard-stage";
import { HorizontalStickGauge } from "@/components/ui/horizontal-stick-gauge";
import { StickSlider } from "@/components/ui/stick-slider";
import { INCOME_BAND_LABELS, INCOME_BAND_OPTIONS, type IncomeBand } from "@/lib/income-band";
import { SECTOR_TAXONOMY } from "@/lib/scoring/score-by-sector";
import {
  ALL_LOCAL_AUTHORITIES,
  UK_REGIONAL_GROUPS,
  type RegionalGroup,
  type RegionalZone,
} from "@/lib/charity-register/vocabulary";
import { normalisePlaceName } from "@/lib/place-name";
import {
  MAX_PRIORITY_TOWNS,
  normaliseTownList,
  SECTOR_RANK_LADDER,
} from "@/lib/scoring/scout-config";
import { configInputsEqual, type ScoutConfigInput } from "@/lib/scoring/scout-config-inputs";
import {
  autoBalanceWeights,
  SCOUT_WEIGHT_PARAMETERS,
  weightFieldName,
  type ScoutWeightKey,
} from "@/lib/scoring/scout-weight-inputs";
import { VIEW_ONLY_CONTROL_NOTE } from "@/lib/auth/view-only";
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

const ZONES: readonly RegionalZone[] = [
  "All",
  "Yorkshire",
  "North",
  "Midlands & East",
  "London & South",
  "Wales",
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

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

function getChangedSections(values: ScoutConfigInput, saved: ScoutConfigInput): string[] {
  const changed: string[] = [];
  const weightsChanged = SCOUT_WEIGHT_PARAMETERS.some(
    (p) => Math.abs((values.weights[p.key] ?? 0) - (saved.weights[p.key] ?? 0)) > 0.01,
  );
  if (weightsChanged) changed.push("Priority weights");

  const sectorsChanged = values.sectorOrder.join("|") !== saved.sectorOrder.join("|");
  if (sectorsChanged) changed.push("Sector ranking");

  const townKey = (towns: string[]) =>
    normaliseTownList(towns)
      .map((town) => town.toLowerCase())
      .join("|");
  const geographyScoresChanged =
    Math.abs(values.geography.inside - saved.geography.inside) >= 0.05 ||
    Math.abs(values.geography.outside - saved.geography.outside) >= 0.05;
  const councilsChanged =
    townKey(values.priorityTowns) !== townKey(saved.priorityTowns) || geographyScoresChanged;
  if (councilsChanged) changed.push("Priority councils & areas");

  const sizeScoresChanged = INCOME_BAND_OPTIONS.some(
    (band) => Math.abs(values.sizeScores[band] - saved.sizeScores[band]) >= 0.05,
  );
  if (sizeScoresChanged) changed.push("Income bands");

  return changed;
}

function formatChangedSections(sections: string[]): string {
  if (sections.length === 0) return "Unsaved changes";
  if (sections.length === 1) return `Unsaved changes in ${sections[0]}`;
  if (sections.length === 2) return `Unsaved changes in ${sections[0]} & ${sections[1]}`;
  return `Unsaved changes in ${sections.slice(0, -1).join(", ")} & ${sections[sections.length - 1]}`;
}

/**
 * Priority tone for a sector row, by rank. Token washes only
 * (`docs/app-design-system.md` — never a Tailwind ramp or a copied hex):
 * the top of the ranking reads as go, the middle as hold, the bottom as
 * stop. Each badge also carries a dot and a word, so the order survives
 * greyscale and red-green colour deficiency — the same contract as `Pill`.
 */
function sectorRankTone(index: number, total: number): {
  badge: string;
  dot: string;
  label: string;
} {
  const third = total / 3;
  if (index < third)
    return { badge: "bg-go-wash text-go", dot: "bg-go", label: "Higher priority" };
  if (index < third * 2)
    return { badge: "bg-hold-wash text-hold", dot: "bg-hold", label: "Middle priority" };
  return { badge: "bg-stop-wash text-stop", dot: "bg-stop", label: "Lower priority" };
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
      estimatedFinishAt?: number;
    };

/** One labelled 0-100 score slider, for the geography and income band scores. */
function ScoreRow({
  id,
  label,
  hint,
  value,
  onChange,
  disabled,
  readOnly,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
  readOnly: boolean;
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
          readOnly={readOnly}
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
  readOnly = false,
  degraded = false,
  changedBy = null,
  createdAt = null,
}: {
  initial: ScoutConfigInput;
  totalClients: number;
  staleClients: number;
  readOnly?: boolean;
  degraded?: boolean;
  changedBy?: string | null;
  createdAt?: string | null;
}) {
  const [saved, setSaved] = useState<ScoutConfigInput>(initial);
  const [values, setValues] = useState<ScoutConfigInput>(initial);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [rescore, setRescore] = useState<Rescore>({ status: "idle" });
  const [stale, setStale] = useState(staleClients);
  const [now, setNow] = useState(0);
  const [zone, setZone] = useState<RegionalZone>("All");
  const [councilSearch, setCouncilSearch] = useState("");
  const councilSearchId = useId();
  // Which sector row just moved, and which way — drives the flash highlight
  // and the screen-reader announcement. Cleared on a short timer.
  const [movedSector, setMovedSector] = useState<{
    category: string;
    direction: -1 | 1;
    position: number;
  } | null>(null);
  // FLIP animation bookkeeping: row tops captured before a reorder, then each
  // row animates from its old position to its new one on the next paint.
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const prevTopsRef = useRef<Map<string, number> | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    },
    [],
  );
  // FLIP bookkeeping for the council chip grid: rects captured before the
  // visible list changes (a keystroke, a region tap), then each surviving
  // chip glides from where it was to where it lands and new chips fade in —
  // so filtering reads as rearranging, not snapping.
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  const prevChipRectsRef = useRef<Map<string, { left: number; top: number }> | null>(null);

  function snapshotChips() {
    const rects = new Map<string, { left: number; top: number }>();
    chipRefs.current.forEach((element, authority) => {
      // Cancel first so the rect is the chip's true layout spot, not a
      // mid-flight position from the previous keystroke's glide. No paint
      // happens between here and the re-render, so nothing visibly jumps.
      element.getAnimations().forEach((animation) => animation.cancel());
      const rect = element.getBoundingClientRect();
      rects.set(authority, { left: rect.left, top: rect.top });
    });
    prevChipRectsRef.current = rects;
  }

  function setCouncilSearchAnimated(value: string) {
    snapshotChips();
    setCouncilSearch(value);
  }

  function setZoneAnimated(next: RegionalZone) {
    snapshotChips();
    setZone(next);
  }

  const [openSections, setOpenSections] = useState({
    weights: true,
    sectors: true,
    councils: true,
    incomeBands: true,
  });
  const toggleSection = (key: keyof typeof openSections) =>
    setOpenSections((curr) => ({ ...curr, [key]: !curr[key] }));

  const running = rescore.status === "running";
  const busy = saving || running;
  const totalWeight = SCOUT_WEIGHT_PARAMETERS.reduce(
    (sum, p) => sum + (values.weights[p.key] ?? 0),
    0,
  );
  const isBalanced = totalWeight === 100;
  const changedSections = useMemo(() => getChangedSections(values, saved), [values, saved]);
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
    // Snapshot row positions before the reorder so the effect below can
    // animate each row from where it was to where it lands (FLIP).
    const tops = new Map<string, number>();
    rowRefs.current.forEach((element, category) => {
      tops.set(category, element.getBoundingClientRect().top);
    });
    prevTopsRef.current = tops;
    const movedCategory = order[index];
    [order[index], order[target]] = [order[target], order[index]];
    update({ sectorOrder: order });
    setMovedSector({ category: movedCategory, direction, position: target + 1 });
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = setTimeout(() => setMovedSector(null), 1200);
  }

  // After a reorder, slide each row from its captured position to its new one.
  // Skipped under reduced motion — the order change alone is the update.
  useEffect(() => {
    const previous = prevTopsRef.current;
    prevTopsRef.current = null;
    if (!previous) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    rowRefs.current.forEach((element, category) => {
      const oldTop = previous.get(category);
      if (oldTop === undefined) return;
      const delta = oldTop - element.getBoundingClientRect().top;
      if (delta === 0) return;
      element.animate(
        [
          { transform: `translateY(${delta}px)` },
          { transform: "translateY(0)" },
        ],
        { duration: 280, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
      );
    });
  }, [values.sectorOrder]);

  // Council matching helper: compares by normalized name and lowercase.
  const sameAuthority = (a: string, b: string) =>
    a.toLowerCase() === b.toLowerCase() || normalisePlaceName(a) === normalisePlaceName(b);

  const hasAuthority = (list: readonly string[], authority: string) =>
    list.some((item) => sameAuthority(item, authority));

  const groups = useMemo(() => {
    if (zone === "All") return UK_REGIONAL_GROUPS;
    return UK_REGIONAL_GROUPS.filter((group) => group.zone === zone);
  }, [zone]);

  const visibleAuthorities = useMemo(() => {
    const needle = councilSearch.trim().toLowerCase();
    if (needle) {
      return ALL_LOCAL_AUTHORITIES.filter(
        (name) => name.toLowerCase().includes(needle) || normalisePlaceName(name).includes(needle),
      );
    }
    if (zone !== "All") {
      const inZone = new Set(
        UK_REGIONAL_GROUPS.filter((g) => g.zone === zone).flatMap((g) => g.authorities),
      );
      return ALL_LOCAL_AUTHORITIES.filter((name) => inZone.has(name));
    }
    return ALL_LOCAL_AUTHORITIES;
  }, [councilSearch, zone]);

  // Progressive disclosure for the 174-council picker: showing every council
  // before the admin has narrowed the list is a wall of pills nobody reads.
  // The individual councils appear once the admin searches or picks a region;
  // the regional groups above are always visible as the way in.
  const councilBrowseActive = councilSearch.trim().length > 0 || zone !== "All";

  // After the visible council list changes, glide surviving chips to their
  // new spots and fade newcomers in with a short stagger. Skipped under
  // reduced motion — the new list alone is the update.
  useEffect(() => {
    const previous = prevChipRectsRef.current;
    prevChipRectsRef.current = null;
    if (!previous) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let entered = 0;
    chipRefs.current.forEach((element, authority) => {
      const old = previous.get(authority);
      if (!old) {
        const delay = Math.min(entered * 12, 120);
        entered += 1;
        element.animate(
          [
            { opacity: 0, transform: "translateY(6px) scale(0.92)" },
            { opacity: 1, transform: "translateY(0) scale(1)" },
          ],
          { duration: 200, delay, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
        );
        return;
      }
      const rect = element.getBoundingClientRect();
      const dx = old.left - rect.left;
      const dy = old.top - rect.top;
      if (dx === 0 && dy === 0) return;
      element.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
        { duration: 240, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
      );
    });
  }, [visibleAuthorities]);

  function toggleAuthority(authority: string) {
    const isSelected = hasAuthority(values.priorityTowns, authority);
    if (isSelected) {
      update({
        priorityTowns: values.priorityTowns.filter((item) => !sameAuthority(item, authority)),
      });
    } else {
      if (values.priorityTowns.length >= MAX_PRIORITY_TOWNS) return;
      update({
        priorityTowns: normaliseTownList([...values.priorityTowns, authority]),
      });
    }
  }

  function toggleGroup(group: RegionalGroup) {
    const allSelected = group.authorities.every((auth) => hasAuthority(values.priorityTowns, auth));
    if (allSelected) {
      update({
        priorityTowns: values.priorityTowns.filter(
          (item) => !group.authorities.some((auth) => sameAuthority(item, auth)),
        ),
      });
    } else {
      const toAdd = group.authorities.filter((auth) => !hasAuthority(values.priorityTowns, auth));
      update({
        priorityTowns: normaliseTownList([...values.priorityTowns, ...toAdd]),
      });
    }
  }

  async function runRescore(total: number) {
    const startedAt = Date.now();
    setNow(startedAt);
    let processed = 0;
    let failed = 0;
    let after: string | null = null;
    let estimatedFinishAt: number | undefined;
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

      const effectiveTotal = Math.max(total, processed);
      const remaining = effectiveTotal - processed;
      const elapsed = Date.now() - startedAt;

      // Estimate remaining time based on actual batch throughput with a 15% safety buffer.
      // We clamp candidateFinishAt so the ETA counts down smoothly and never flickers upwards.
      if (processed > 0 && remaining > 0) {
        const msPerItem = elapsed / processed;
        const msRemaining = remaining * msPerItem * 1.15;
        const candidateFinishAt = Date.now() + msRemaining;

        if (!estimatedFinishAt || candidateFinishAt < estimatedFinishAt) {
          estimatedFinishAt = candidateFinishAt;
        }
      }

      setRescore({
        status: "running",
        total: effectiveTotal,
        processed,
        failed,
        startedAt,
        estimatedFinishAt,
      });
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
  const secondsLeft =
    rescore.status === "running" && rescore.estimatedFinishAt
      ? Math.max(1, Math.round((rescore.estimatedFinishAt - (now || rescore.startedAt)) / 1000))
      : null;

  return (
    <>
      <Rise>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] leading-[1] font-semibold tracking-[-0.03em] text-ink">
              Score settings
            </h1>
            <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-dim">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-lead" />
              {degraded ? (
                <span>The saved settings could not be read</span>
              ) : changedBy ? (
                <span>
                  Last changed on{" "}
                  <span className="font-semibold text-ink">
                    {createdAt ? formatDate(createdAt) : ""}
                  </span>{" "}
                  by <span className="font-semibold text-ink">{changedBy}</span>
                </span>
              ) : (
                <span>
                  <span className="font-semibold text-ink">Starting settings</span>
                  {" · "}
                  Nobody has changed these yet
                </span>
              )}
            </p>
            {readOnly && (
              <p className="mt-2 text-sm text-dim">{VIEW_ONLY_CONTROL_NOTE}</p>
            )}
          </div>

          {!readOnly && (
            <button
              type="button"
              onClick={() => runRescore(totalClients || stale || 1)}
              disabled={busy}
              className={PRIMARY_BUTTON}
            >
              {running ? (
                <>
                  <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                  Updating scores…
                </>
              ) : (
                "Rescore clients"
              )}
            </button>
          )}
        </div>
      </Rise>

      <Group className="space-y-4">
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
            <p id="stale-description" className="mt-3 text-[13px] leading-[1.55] text-dim">
              Scores don&rsquo;t update automatically when you save new settings, so the client list
              stays stable until you choose to rescore. Updating runs in batches and shows progress.
            </p>
            {!readOnly && (
              <div className="mt-4 border-t border-rule-soft pt-4">
                <button
                  type="button"
                  onClick={() => runRescore(stale)}
                  disabled={busy}
                  className={PRIMARY_BUTTON}
                >
                  Update every client&rsquo;s score now
                </button>
              </div>
            )}
          </section>
        )}

        {/* ── 1. How much each check counts ── */}
        <section aria-labelledby="weights-heading" className={CARD}>
          <button
            type="button"
            onClick={() => toggleSection("weights")}
            aria-expanded={openSections.weights}
            className="-m-1 flex w-[calc(100%+0.5rem)] cursor-pointer items-center justify-between gap-4 rounded-inset p-1 text-left transition-colors focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id="weights-heading" className={CARD_TITLE}>
                What makes a client a priority
              </h2>
              {changedSections.includes("Priority weights") && (
                <span className="inline-flex items-center gap-1 rounded-full bg-hold-wash px-2 py-0.5 text-[11px] font-medium text-ink">
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-hold" />
                  Unsaved
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="flex items-center gap-1.5 text-[13px] font-medium">
                {isBalanced ? (
                  <span className="flex items-center gap-1.5 text-go">
                    <Check aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.5} />
                    Total: 100%
                  </span>
                ) : totalWeight > 100 ? (
                  <span className="text-stop">
                    Total: {totalWeight}% · {totalWeight - 100}% over
                  </span>
                ) : (
                  <span className="text-hold">
                    Total: {totalWeight}% · {100 - totalWeight}% remaining
                  </span>
                )}
              </div>
              <ChevronDown
                aria-hidden="true"
                className={`size-4 text-dim transition-transform duration-200 ${
                  openSections.weights ? "rotate-180" : ""
                }`}
              />
            </div>
          </button>

          {openSections.weights && (
            <div className="mt-2">
              <p className={CARD_HINT}>
                Every client gets a priority score from the five checks below, which decides the order
                of the client list.{" "}
                {readOnly
                  ? "Each bar shows how much a check contributes to the score."
                  : "Drag a handle to set each check's percentage. The five checks must add up to 100% in total."}
              </p>
              <ul className="mt-4">
                {SCOUT_WEIGHT_PARAMETERS.map((parameter) => {
                  const id = weightFieldName(parameter.key);
                  const weight = values.weights[parameter.key] ?? 0;
                  return (
                    <li key={parameter.key} className="border-t border-rule-soft py-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                        <label htmlFor={id} className="text-sm font-medium text-ink">
                          {parameter.label}
                        </label>
                        <span className="text-[13px] text-dim">
                          <span className="font-semibold text-ink tabular-nums">{Math.round(weight)}%</span>{" "}
                          of the score · {importance(weight)}
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
                          step={1}
                          value={weight}
                          onValueChange={(next) => setWeight(parameter.key, next)}
                          disabled={busy}
                          readOnly={readOnly}
                          aria-describedby={`${id}-hint`}
                          aria-valuetext={`${Math.round(weight)}% of the score`}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
              {!isBalanced && (
                <p
                  role="alert"
                  className={`mt-2 rounded-inset px-3 py-2.5 text-[13px] ${
                    totalWeight === 0 || totalWeight > 100
                      ? "bg-stop-wash text-stop"
                      : "bg-hold-wash text-ink"
                  }`}
                >
                  {totalWeight === 0
                    ? "Every check is set to 0%. The checks must add up to 100% before saving."
                    : totalWeight > 100
                      ? `The checks add up to ${totalWeight}%. Please reduce them by ${totalWeight - 100}% so they total exactly 100%.`
                      : `The checks add up to ${totalWeight}%. Please add ${100 - totalWeight}% so they total exactly 100% before saving.`}
                </p>
              )}
              {!readOnly && (
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-rule-soft pt-4">
                  <button
                    type="button"
                    onClick={() => update({ weights: EQUAL_WEIGHTS })}
                    disabled={busy}
                    className={QUIET_BUTTON}
                  >
                    Make every check count equally (20% each)
                  </button>
                  {!isBalanced && totalWeight > 0 && (
                    <button
                      type="button"
                      onClick={() => update({ weights: autoBalanceWeights(values.weights) })}
                      disabled={busy}
                      className={QUIET_BUTTON}
                    >
                      Auto-balance to 100%
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── 2. Sector ranking ── */}
        <section aria-labelledby="sector-heading" className={CARD}>
          <button
            type="button"
            onClick={() => toggleSection("sectors")}
            aria-expanded={openSections.sectors}
            className="-m-1 flex w-[calc(100%+0.5rem)] cursor-pointer items-center justify-between gap-4 rounded-inset p-1 text-left transition-colors focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id="sector-heading" className={CARD_TITLE}>
                Sector ranking
              </h2>
              {changedSections.includes("Sector ranking") && (
                <span className="inline-flex items-center gap-1 rounded-full bg-hold-wash px-2 py-0.5 text-[11px] font-medium text-ink">
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-hold" />
                  Unsaved
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-[13px] font-medium text-dim">
                {values.sectorOrder.length} sectors ranked
              </span>
              <ChevronDown
                aria-hidden="true"
                className={`size-4 text-dim transition-transform duration-200 ${
                  openSections.sectors ? "rotate-180" : ""
                }`}
              />
            </div>
          </button>

          {openSections.sectors && (
            <div className="mt-2">
              <p className={CARD_HINT}>
                Put the kinds of work the branch most wants to help at the top. Move a sector with the
                arrows — the row slides to its new place and flashes so you can follow it. A client
                with no sector recorded scores 50, in the middle.
              </p>
              <p className="mt-2 rounded-inset bg-paper px-3 py-2.5 text-[13px] leading-[1.55] text-dim">
                Some charities don&rsquo;t fit these six — for example places of worship, armed-forces
                charities, and general-purpose funds. They arrive without a sector and score 50, in the
                middle, rather than being guessed into the wrong place.
              </p>
              <p aria-live="polite" className="sr-only">
                {movedSector
                  ? `${movedSector.category} moved ${movedSector.direction === -1 ? "up" : "down"} to position ${movedSector.position} of ${values.sectorOrder.length}`
                  : ""}
              </p>
              <ol className="mt-4">
                {values.sectorOrder.map((category, index) => {
                  const tone = sectorRankTone(index, values.sectorOrder.length);
                  const isFlashing = movedSector?.category === category;
                  return (
                    <li
                      key={category}
                      ref={(element) => {
                        if (element) rowRefs.current.set(category, element);
                        else rowRefs.current.delete(category);
                      }}
                      className={`flex items-start gap-4 border-t border-rule-soft py-3.5 motion-reduce:transition-none ${
                        isFlashing ? "rounded-inset bg-lead-wash/60 transition-colors duration-500" : ""
                      }`}
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
                      <span
                        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium tabular-nums ${tone.badge}`}
                        title={`${tone.label} — position ${index + 1} of ${values.sectorOrder.length}`}
                      >
                        <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${tone.dot}`} />
                        Scores {Math.round((SECTOR_RANK_LADDER[index] ?? 0) * 100)} ·{" "}
                        {tone.label.replace(" priority", "")}
                      </span>
                      {!readOnly && (
                        <span className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            onClick={() => moveSector(index, -1)}
                            disabled={busy || index === 0}
                            aria-label={`Move ${category} up`}
                            title="Move towards higher priority"
                            className="rounded-inset p-1.5 text-dim transition-colors hover:bg-go-wash hover:text-go disabled:pointer-events-none disabled:opacity-30"
                          >
                            <ArrowUp className="size-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveSector(index, 1)}
                            disabled={busy || index === values.sectorOrder.length - 1}
                            aria-label={`Move ${category} down`}
                            title="Move towards lower priority"
                            className="rounded-inset p-1.5 text-dim transition-colors hover:bg-stop-wash hover:text-stop disabled:pointer-events-none disabled:opacity-30"
                          >
                            <ArrowDown className="size-4" aria-hidden="true" />
                          </button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </section>

        {/* ── 3. Priority towns & councils ── */}
        <section aria-labelledby="towns-heading" className={CARD}>
          <button
            type="button"
            onClick={() => toggleSection("councils")}
            aria-expanded={openSections.councils}
            className="-m-1 flex w-[calc(100%+0.5rem)] cursor-pointer items-center justify-between gap-4 rounded-inset p-1 text-left transition-colors focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id="towns-heading" className={CARD_TITLE}>
                Priority councils & areas
              </h2>
              {changedSections.includes("Priority councils & areas") && (
                <span className="inline-flex items-center gap-1 rounded-full bg-hold-wash px-2 py-0.5 text-[11px] font-medium text-ink">
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-hold" />
                  Unsaved
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-[13px] font-medium text-dim">
                {values.priorityTowns.length} of {MAX_PRIORITY_TOWNS} selected
              </span>
              <ChevronDown
                aria-hidden="true"
                className={`size-4 text-dim transition-transform duration-200 ${
                  openSections.councils ? "rotate-180" : ""
                }`}
              />
            </div>
          </button>

          {openSections.councils && (
            <div className="mt-2">
              <p className={CARD_HINT}>
                The local authorities and areas the branch focuses on. The same list decides which
                charities are flagged as local when you import them. Select from the official register list below.
              </p>

              <div className="mt-4 border-t border-rule-soft pt-4">
                {values.priorityTowns.length > 0 ? (
                  <div>
                    <div className="flex items-center justify-between gap-2 pb-2">
                      <span className="text-[13px] font-medium text-ink">Selected areas</span>
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => update({ priorityTowns: [] })}
                          disabled={busy}
                          className="cursor-pointer text-[12px] font-medium text-dim hover:text-stop disabled:opacity-50"
                        >
                          Clear all
                        </button>
                      )}
                    </div>
                    <ul className="flex flex-wrap gap-2" aria-label="Selected priority councils">
                      {values.priorityTowns.map((town) => (
                        <li
                          key={town.toLowerCase()}
                          className="flex items-center gap-1 rounded-full bg-paper py-1 pr-1 pl-3 text-[13px] text-ink"
                        >
                          {town}
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() =>
                                update({
                                  priorityTowns: values.priorityTowns.filter((item) => item !== town),
                                })
                              }
                              disabled={busy}
                              aria-label={`Remove ${town}`}
                              className="cursor-pointer rounded-full p-1 text-dim transition-colors hover:bg-paper-sunk hover:text-ink disabled:opacity-50"
                            >
                              <X className="size-3" aria-hidden="true" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="rounded-inset bg-hold-wash px-3 py-2.5 text-[13px] text-ink">
                    No priority councils are selected, so the Geography check scores every client the same and
                    imports only treat a charity as local by its postcode.
                  </p>
                )}

                {!readOnly && (
                  <div className="mt-5 border-t border-rule-soft pt-4">
                    <p className="text-[13px] font-medium text-dim">Regional groups</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Region filter">
                      {ZONES.map((option) => (
                        <button
                          key={option}
                          type="button"
                          aria-pressed={zone === option}
                          onClick={() => setZoneAnimated(option)}
                          disabled={busy}
                          className={`cursor-pointer rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none ${
                            zone === option
                              ? "bg-lead text-white"
                              : "bg-paper text-dim hover:bg-paper-sunk hover:text-ink"
                          }`}
                        >
                          {option}
                        </button>
                      ))}
                    </div>

                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {groups.map((group) => {
                        const total = group.authorities.length;
                        const chosen = group.authorities.filter((auth) =>
                          hasAuthority(values.priorityTowns, auth),
                        ).length;
                        const all = total > 0 && chosen === total;
                        const partial = chosen > 0 && !all;
                        return (
                          <button
                            key={group.id}
                            type="button"
                            onClick={() => toggleGroup(group)}
                            disabled={busy || (!all && values.priorityTowns.length >= MAX_PRIORITY_TOWNS)}
                            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-inset px-2.5 py-1 text-[12px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 ${
                              all
                                ? "border border-lead bg-lead text-white"
                                : partial
                                  ? "border border-lead-mid/40 bg-lead-wash text-lead"
                                  : "border border-rule bg-white text-dim hover:bg-paper hover:text-ink"
                            }`}
                          >
                            <span>{group.name}</span>
                            <span
                              className={`text-[11px] tabular-nums ${all ? "text-white/80" : "text-dim"}`}
                            >
                              {partial ? `${chosen}/${total}` : total}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-4">
                      <div className="relative">
                        <Search
                          aria-hidden="true"
                          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-dim"
                        />
                        <label htmlFor={councilSearchId} className="sr-only">
                          Search local councils
                        </label>
                        <input
                          id={councilSearchId}
                          type="search"
                          value={councilSearch}
                          onChange={(event) => setCouncilSearchAnimated(event.target.value)}
                          placeholder={`Search all ${ALL_LOCAL_AUTHORITIES.length} local councils…`}
                          disabled={busy}
                          // The field has its own clear button below; without
                          // this the browser draws a second, native X inside
                          // the same input.
                          className={`${INPUT} pr-8 pl-8 placeholder:text-faint [&::-webkit-search-cancel-button]:hidden`}
                        />
                        {councilSearch && (
                          <button
                            type="button"
                            onClick={() => setCouncilSearchAnimated("")}
                            disabled={busy}
                            aria-label="Clear search"
                            className="absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer rounded-full p-0.5 text-dim hover:text-ink"
                          >
                            <X aria-hidden="true" className="size-3.5" />
                          </button>
                        )}
                      </div>

                      {!councilBrowseActive ? (
                        <p className="mt-2.5 rounded-inset bg-paper px-3 py-2.5 text-[13px] leading-[1.55] text-dim">
                          Search above or choose a region to see its councils — showing all{" "}
                          {ALL_LOCAL_AUTHORITIES.length} at once is a wall nobody reads.
                        </p>
                      ) : (
                        <>
                          <p
                            aria-live="polite"
                            className="mt-2.5 text-[13px] text-dim"
                          >
                            Showing{" "}
                            <span className="font-semibold text-ink tabular-nums">
                              {visibleAuthorities.length}
                            </span>{" "}
                            of {ALL_LOCAL_AUTHORITIES.length} councils
                            {councilSearch.trim() && (
                              <> matching &ldquo;{councilSearch.trim()}&rdquo;</>
                            )}
                            {zone !== "All" && <> in {zone}</>}.
                          </p>
                          <div className="mt-2.5 flex max-h-64 flex-wrap gap-1.5 overflow-y-auto pt-1 pr-1 pb-1">
                            {visibleAuthorities.map((authority) => {
                              const selected = hasAuthority(values.priorityTowns, authority);
                              const atCapacity =
                                !selected && values.priorityTowns.length >= MAX_PRIORITY_TOWNS;
                              return (
                                <button
                                  key={authority}
                                  ref={(element) => {
                                    if (element) chipRefs.current.set(authority, element);
                                    else chipRefs.current.delete(authority);
                                  }}
                                  type="button"
                                  onClick={() => toggleAuthority(authority)}
                                  disabled={busy || atCapacity}
                                  aria-pressed={selected}
                                  className={`inline-flex cursor-pointer items-center gap-1 rounded-inset px-2.5 py-1 text-[12px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 ${
                                    selected
                                      ? "bg-lead text-white hover:bg-lead-mid"
                                      : "bg-paper text-dim hover:bg-paper-sunk hover:text-ink"
                                  }`}
                                >
                                  {selected && (
                                    <Check aria-hidden="true" className="size-3" strokeWidth={2.5} />
                                  )}
                                  {authority}
                                </button>
                              );
                            })}
                            {visibleAuthorities.length === 0 && (
                              <p className="py-2 text-[13px] text-dim">
                                No council matches &ldquo;{councilSearch.trim()}&rdquo;.{" "}
                                <button
                                  type="button"
                              onClick={() => setCouncilSearchAnimated("")}
                              className="cursor-pointer font-medium text-lead hover:underline"
                                >
                                  Clear search
                                </button>
                              </p>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <ul className="mt-4">
                <ScoreRow
                  id="geography-inside"
                  label="Based in a priority area"
                  value={values.geography.inside}
                  onChange={(inside) => update({ geography: { ...values.geography, inside } })}
                  disabled={busy}
                  readOnly={readOnly}
                />
                <ScoreRow
                  id="geography-outside"
                  label="Based anywhere else"
                  hint="A client with no location recorded scores 50, in the middle."
                  value={values.geography.outside}
                  onChange={(outside) => update({ geography: { ...values.geography, outside } })}
                  disabled={busy}
                  readOnly={readOnly}
                />
              </ul>
            </div>
          )}
        </section>

        {/* ── 4. Income bands ── */}
        <section aria-labelledby="size-heading" className={CARD}>
          <button
            type="button"
            onClick={() => toggleSection("incomeBands")}
            aria-expanded={openSections.incomeBands}
            className="-m-1 flex w-[calc(100%+0.5rem)] cursor-pointer items-center justify-between gap-4 rounded-inset p-1 text-left transition-colors focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id="size-heading" className={CARD_TITLE}>
                Income bands
              </h2>
              {changedSections.includes("Income bands") && (
                <span className="inline-flex items-center gap-1 rounded-full bg-hold-wash px-2 py-0.5 text-[11px] font-medium text-ink">
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-hold" />
                  Unsaved
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-[13px] font-medium text-dim">
                {INCOME_BAND_OPTIONS.length} bands configured
              </span>
              <ChevronDown
                aria-hidden="true"
                className={`size-4 text-dim transition-transform duration-200 ${
                  openSections.incomeBands ? "rotate-180" : ""
                }`}
              />
            </div>
          </button>

          {openSections.incomeBands && (
            <div className="mt-2">
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
                    readOnly={readOnly}
                  />
                ))}
              </ul>
              <p className={`mt-4 border-t border-rule-soft pt-4 ${FOOTNOTE}`}>
                Every change is recorded in the audit log with who made it and when.
              </p>
            </div>
          )}
        </section>

        {!readOnly && (dirty || notice) && !running && (
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
                  ) : !isBalanced ? (
                    <span className="flex items-center gap-2 font-medium text-stop">
                      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-stop" />
                      {totalWeight === 0
                        ? "Weights must add up to 100%"
                        : totalWeight > 100
                          ? `Weights add up to ${totalWeight}% (${totalWeight - 100}% over)`
                          : `Weights add up to ${totalWeight}% (${100 - totalWeight}% remaining)`}
                    </span>
                  ) : dirty ? (
                    <span className="flex items-center gap-2 text-ink">
                      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-hold" />
                      {formatChangedSections(changedSections)}
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
                  disabled={busy || !dirty || !isBalanced}
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
  </Group>
</>
  );
}
