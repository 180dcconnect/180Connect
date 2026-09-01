"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import type { GrowthPoint } from "@/lib/dashboard-metrics";
import {
  isoDayUTC,
  performanceForPeriod,
  periodWindows,
  sectorPerformance,
  type PerformanceInput,
  type PerformanceSummary,
  type SectorPerformanceRow,
  type TeamUserRow,
  type WeeklyCount,
} from "@/lib/performance-metrics";
import { camLeaderboard } from "@/lib/dashboard/cam-leaderboard";
import ProgressMetricCard from "@/components/ui/progress-metric-card";
import { StackedStickColumns } from "@/components/ui/stacked-stick-columns";
import { PeriodSelect, type PeriodOption } from "@/components/ui/metric-controls";
import { CamLeaderboardTable } from "@/components/dashboard/cam-leaderboard-table";

/**
 * The Performance section (F-added): the whole team's week, filterable down to
 * one person. Scope is client-side state over data the server already computed
 * for every person, so switching between "Whole team", "Just me" and a picked
 * CAM never round-trips — the numbers re-derive instantly.
 *
 * Who can pick a specific CAM: admins and viewers (matrix §3.1 read the whole
 * directory; the product rule is that CAMs see the team and themselves, while
 * oversight roles can drill into anyone). CAMs get only the two-way toggle.
 */

type Scope = { kind: "team" } | { kind: "me" } | { kind: "cam"; userId: string };

export interface PerformanceSectionProps {
  summary: PerformanceSummary;
  /** CAMs for the picker, name-sorted (same list the clients owner filter uses). */
  cams: TeamUserRow[];
  actorId: string;
  actorRole: string;
  /** Daily cumulative conversion-rate points over the trailing 90 days. */
  trend: GrowthPoint[];
  sectors: SectorPerformanceRow[];
  /** Per-user sector performance breakdowns, keyed by user ID. */
  sectorsByUser?: Record<string, SectorPerformanceRow[]>;
  /** Per-user conversion rate trends, keyed by user ID. */
  trendByUser?: Record<string, GrowthPoint[]>;
  /** Raw 90-day window rows — when present the tiles/trend/sectors are re-derived
   *  client-side for the picked period (vs prior period), so custom calendars
   *  stay instant and never round-trip. */
  raw?: PerformanceInput;
  sectorByOrg?: Map<string, string | null>;
  className?: string;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function getPercentageChange(thisWeek: number, lastWeek: number) {
  if (lastWeek === 0) {
    if (thisWeek === 0) return { value: 0, text: "0.0%" };
    return { value: 100, text: "+100%" };
  }
  const delta = thisWeek - lastWeek;
  const pct = (delta / lastWeek) * 100;
  const sign = pct > 0 ? "+" : "";
  return {
    value: pct,
    text: `${sign}${pct.toFixed(1)}%`,
  };
}

function PerformanceTile({
  label,
  count,
  unit = "",
  placeholderTotal,
  activeColorClass,
}: {
  label: string;
  count: WeeklyCount;
  unit?: string;
  placeholderTotal?: number;
  activeColorClass?: string;
}) {
  const displayTotal = count.thisWeek > 0 ? count.thisWeek : (placeholderTotal ?? 0);
  const { value: pctValue, text: pctText } = getPercentageChange(count.thisWeek, count.lastWeek);

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm dark:border-white/[0.08] dark:bg-card">
      {/* Top Title */}
      <h4 className="text-[16px] font-semibold tracking-tight text-foreground">
        {label}
      </h4>

      {/* Main content row with increased vertical gap, aligning figure and chart on the exact same baseline level */}
      <div className="mt-8 flex items-end justify-between gap-3">
        {/* Left metric numbers */}
        <div className="flex flex-col">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.p
              key={count.thisWeek}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22 }}
              className="text-[2.25rem] font-black leading-none tracking-[-0.03em] tabular-nums text-foreground"
            >
              {count.thisWeek.toLocaleString()}
            </motion.p>
          </AnimatePresence>

          <div className="mt-3 flex items-center gap-1.5 text-xs">
            <span
              className={`inline-flex items-center font-bold ${
                pctValue > 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : pctValue < 0
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-muted-foreground"
              }`}
            >
              {pctText}
            </span>
            <span className="text-[12px] font-normal text-muted-foreground">
              vs last week
            </span>
          </div>
        </div>

        {/* Right 7-column stacked squarish sticks, aligned on the same bottom level */}
        <div className="shrink-0">
          <StackedStickColumns
            total={displayTotal}
            unit={unit}
            activeColorClass={
              activeColorClass ??
              (label.toLowerCase().includes("conversion")
                ? "bg-emerald-600 dark:bg-emerald-400"
                : label.toLowerCase().includes("repl")
                  ? "bg-sky-500 dark:bg-sky-400"
                  : label.toLowerCase().includes("scored")
                    ? "bg-violet-600 dark:bg-violet-400"
                    : "bg-indigo-600 dark:bg-indigo-400")
            }
          />
        </div>
      </div>
    </div>
  );
}

/** Searchable CAM picker — the oversight roles' way to drill into one person. */
function CamPicker({
  cams,
  selectedId,
  onSelect,
}: {
  cams: TeamUserRow[];
  selectedId: string | null;
  onSelect: (userId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = cams.find((cam) => cam.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cams;
    return cams.filter((cam) => (cam.full_name ?? "").toLowerCase().includes(q));
  }, [cams, query]);

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
          selected
            ? "border-brand/30 bg-brand/[0.07] text-foreground"
            : "border-black/[0.08] bg-white text-muted-foreground hover:text-foreground"
        }`}
      >
        <Search size={13} strokeWidth={2.5} className="opacity-60" />
        <span className="max-w-[11rem] truncate">
          {selected ? (selected.full_name || "Unnamed CAM") : "Select a CAM"}
        </span>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={14} strokeWidth={2.5} />
        </motion.div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute right-0 top-full z-40 mt-1.5 w-64 overflow-hidden rounded-2xl border border-black/[0.08] bg-popover/95 shadow-[0_10px_30px_rgba(0,0,0,0.15)] backdrop-blur-md"
          >
            <div className="border-b border-black/[0.06] p-2">
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search CAMs…"
                aria-label="Search CAMs"
                className="w-full rounded-lg border border-black/[0.06] bg-black/[0.03] px-2.5 py-1.5 text-[12px] font-medium outline-none transition-colors focus-visible:border-brand"
              />
            </div>
            <ul role="listbox" aria-label="Select a CAM" className="max-h-56 overflow-y-auto p-1.5">
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedId === null}
                  onClick={() => {
                    onSelect(null);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-colors hover:bg-black/[0.03] ${
                    selectedId === null ? "bg-black/[0.05]" : ""
                  }`}
                >
                  Whole team
                  {selectedId === null && <Check size={14} strokeWidth={3} className="text-brand" />}
                </button>
              </li>
              {filtered.map((cam) => {
                const isSelected = cam.id === selectedId;
                return (
                  <li key={cam.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        onSelect(cam.id);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-colors hover:bg-black/[0.03] ${
                        isSelected ? "bg-black/[0.05]" : ""
                      }`}
                    >
                      <span className="truncate">{cam.full_name || "Unnamed CAM"}</span>
                      {isSelected && <Check size={14} strokeWidth={3} className="shrink-0 text-brand" />}
                    </button>
                  </li>
                );
              })}
              {filtered.length === 0 && (
                <li className="px-3 py-3 text-[12px] text-muted-foreground">No CAMs match “{query}”.</li>
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ScopeToggle({
  scope,
  onScope,
}: {
  scope: Scope;
  onScope: (scope: Scope) => void;
}) {
  const item = (kind: Scope["kind"], label: string) => {
    const isSelected =
      (kind === "team" && scope.kind === "team") || (kind === "me" && scope.kind === "me");
    return (
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={() => onScope(kind === "team" ? { kind: "team" } : { kind: "me" })}
        className={`relative z-10 rounded-full px-3 py-1 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
          isSelected ? "text-foreground" : "text-foreground/45 hover:text-foreground/75"
        }`}
      >
        {isSelected && (
          <motion.div
            layoutId="performance-scope-pill"
            className="absolute inset-0 rounded-full bg-white shadow-sm"
            transition={{ type: "spring", stiffness: 450, damping: 30 }}
          />
        )}
        <span className="relative z-10">{label}</span>
      </button>
    );
  };

  return (
    <div className="flex items-center gap-0.5 rounded-full bg-black/[0.05] p-0.5 backdrop-blur-sm">
      {item("team", "Whole team")}
      {item("me", "Just me")}
    </div>
  );
}

export function PerformanceSection({
  summary,
  cams,
  actorId,
  actorRole,
  trend,
  sectors,
  sectorsByUser,
  trendByUser,
  raw,
  sectorByOrg,
  className = "",
}: PerformanceSectionProps) {
  const canPickCam = actorRole === "admin" || actorRole === "viewer";
  const [scope, setScope] = useState<Scope>({ kind: "team" });
  const [pickedCamId, setPickedCamId] = useState<string | null>(null);

  const applyScope = (next: Scope) => {
    setScope(next);
    if (next.kind !== "cam") setPickedCamId(null);
  };

  // Period: Last 7/30/90 vs prior period of same length, plus full custom calendar.
  const periodOptions = useMemo<PeriodOption[]>(() => {
    const today = isoDayUTC(new Date());
    const ago = (n: number) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - n);
      return isoDayUTC(d);
    };
    return [
      { label: "Last 7 days", from: ago(6), to: today },
      { label: "Last 30 days", from: ago(29), to: today },
      { label: "Last 90 days", from: ago(89), to: today },
    ];
  }, []);
  const [selected, setSelected] = useState<PeriodOption>(() => periodOptions[0]);

  // Re-derive summary/trend/sectors for the picked period when raw is available.
  const periodSummary = useMemo(() => {
    if (!raw || !selected.from || !selected.to) return null;
    try {
      return performanceForPeriod(raw, selected.from, selected.to);
    } catch {
      return null;
    }
  }, [raw, selected]);

  const effectiveSummary = periodSummary ?? summary;

  const person =
    scope.kind === "me"
      ? (effectiveSummary.people.get(actorId) ?? null)
      : scope.kind === "cam"
        ? (effectiveSummary.people.get(scope.userId) ?? null)
        : null;

  const scopeLabel =
    scope.kind === "team"
      ? "Whole team"
      : scope.kind === "me"
        ? "Your performance"
        : `${cams.find((cam) => cam.id === scope.userId)?.full_name || "This CAM"}'s performance`;

  const emailsSent = person ? person.emailsSent : effectiveSummary.team.emailsSent;
  const replies = person ? person.replies : effectiveSummary.team.replies;
  const conversions = person ? person.conversions : effectiveSummary.team.conversions;

  const currentSectors = useMemo(() => {
    if (raw && sectorByOrg && selected.from && selected.to) {
      const fromMs = Date.parse(`${selected.from}T00:00:00Z`);
      const toMs = Date.parse(`${selected.to}T00:00:00Z`) + 24 * 60 * 60 * 1000;
      const days = Math.max(1, Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000)));
      const filterId =
        scope.kind === "me" ? actorId : scope.kind === "cam" ? scope.userId : undefined;
      return sectorPerformance(raw, sectorByOrg, days, new Date(`${selected.to}T00:00:00Z`), filterId);
    }
    if (scope.kind === "me" && sectorsByUser) return sectorsByUser[actorId] ?? [];
    if (scope.kind === "cam" && sectorsByUser) return sectorsByUser[scope.userId] ?? [];
    return sectors;
  }, [raw, sectorByOrg, selected, scope, actorId, sectors, sectorsByUser]);

  const baseTrend = useMemo(() => {
    if (scope.kind === "me" && trendByUser) return trendByUser[actorId] ?? [];
    if (scope.kind === "cam" && trendByUser) return trendByUser[scope.userId] ?? [];
    return trend;
  }, [scope, actorId, trend, trendByUser]);

  const currentTrend = useMemo(() => {
    if (!selected.from || !selected.to) return baseTrend;
    return baseTrend.filter((p) => p.date >= selected.from! && p.date <= selected.to!);
  }, [baseTrend, selected]);

  // The trend card's headline is the *current* cumulative rate — the series'
  // last point — not a sum of daily rates.
  const currentRate = currentTrend.length > 0 ? currentTrend[currentTrend.length - 1].value : 0;
  const formatRate = (value: number) => `${(value * 100).toFixed(1)}%`;

  const visibleSectors = currentSectors.slice(0, 8);
  const hiddenSectors = currentSectors.length - visibleSectors.length;

  // F212 — the whole team at once, for the roles that may already drill into any
  // one CAM. Built off `effectiveSummary` so it moves with the period picker
  // above it rather than becoming a second, quietly disagreeing window. The
  // table is never scope-filtered: comparing the team to itself is the point,
  // and filtering it to one person would leave a one-row leaderboard.
  const leaderboard = useMemo(
    () => (canPickCam ? camLeaderboard(effectiveSummary, cams) : null),
    [canPickCam, effectiveSummary, cams],
  );

  const periodCaption = useMemo(() => {
    if (!selected.from || !selected.to) return "this period vs prior period";
    const fmt = (iso: string) =>
      new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      });
    if (selected.from === selected.to) return `${fmt(selected.from)} vs prior day`;
    return `${fmt(selected.from)} – ${fmt(selected.to)} vs prior period`;
  }, [selected]);

  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
        <h2 className="text-xl font-semibold font-body tracking-[-0.02em]">Performance</h2>
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
          {scopeLabel} · {periodCaption}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ScopeToggle scope={scope} onScope={(next) => applyScope(next)} />
        <PeriodSelect
          value={selected.label}
          options={periodOptions}
          onChange={setSelected}
          accentText="hsl(var(--foreground))"
          allowCustomRange
          defaultOption={periodOptions[0]}
        />
        {canPickCam && (
          <CamPicker
            cams={cams}
            selectedId={pickedCamId}
            onSelect={(userId) => applyScope(userId ? { kind: "cam", userId } : { kind: "team" })}
          />
        )}
        <span className="text-[11px] text-foreground/35">
          {scope.kind === "team" ? "Viewing whole team." : `Filtered to ${scopeLabel.toLowerCase()}.`}
        </span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PerformanceTile label="Emails Sent" count={emailsSent} unit="emails" placeholderTotal={70} />
        <PerformanceTile label="Replies Received" count={replies} unit="replies" placeholderTotal={24} />
        <PerformanceTile
          label="Conversions"
          count={conversions}
          unit="conversions"
          placeholderTotal={8}
          activeColorClass="bg-brand"
        />
        <PerformanceTile
          label="Organisations Scored"
          count={effectiveSummary.orgsScored}
          unit="orgs"
          placeholderTotal={48}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ProgressMetricCard
          title="Conversion rate trend"
          total={formatRate(currentRate)}
          deltaLabel=""
          data={currentTrend}
          valueFormatter={formatRate}
          periodOptions={[
            { label: "Past 30 days", points: 30 },
            { label: "Past 90 days" },
          ]}
          showDelta={false}
          showStats
          size="md"
          className="min-h-[300px]"
        />

        <div className="flex min-h-[300px] flex-col rounded-[28px] border border-border bg-card p-6 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[16px] font-semibold tracking-tight text-foreground">
              Sector performance
            </h3>
            <span className="text-[11px] font-medium text-muted-foreground">{selected.label}</span>
          </div>

          {visibleSectors.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="max-w-xs text-center text-sm text-muted-foreground">
                No outreach in the trailing 90 days yet for this selection — sector rows appear with the first sent email.
              </p>
            </div>
          ) : (
            <div className="mt-4 flex-1">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 border-b border-black/[0.06] pb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-foreground/35 max-sm:grid-cols-[1fr_auto_auto]">
                <span>Sector</span>
                <span className="text-right">Sent</span>
                <span className="text-right">Reply</span>
                <span className="hidden text-right sm:block">Conv.</span>
              </div>
              <ul className="divide-y divide-black/[0.04]">
                {visibleSectors.map((row) => (
                  <li
                    key={row.sector}
                    className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 py-2.5 text-[13px] tabular-nums max-sm:grid-cols-[1fr_auto_auto]"
                  >
                    <span className="truncate pr-2 font-medium text-foreground">{row.sector}</span>
                    <span className="text-right text-foreground/70">{row.emailsSent.toLocaleString()}</span>
                    <span className="text-right text-foreground/70">{pct(row.replyRate)}</span>
                    <span className="hidden font-semibold text-foreground sm:block">
                      {pct(row.conversionRate)}
                    </span>
                  </li>
                ))}
              </ul>
              {hiddenSectors > 0 && (
                <p className="pt-2 text-[11px] text-foreground/35">
                  +{hiddenSectors} more sector{hiddenSectors === 1 ? "" : "s"} in the trailing window
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {leaderboard && <CamLeaderboardTable board={leaderboard} />}
    </div>
  );
}

export default PerformanceSection;

