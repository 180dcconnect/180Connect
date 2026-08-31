"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import type { GrowthPoint } from "@/lib/dashboard-metrics";
import type {
  PerformanceSummary,
  SectorPerformanceRow,
  TeamUserRow,
  WeeklyCount,
} from "@/lib/performance-metrics";
import ProgressMetricCard from "@/components/ui/progress-metric-card";

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
  className?: string;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function Delta({ count }: { count: WeeklyCount }) {
  const delta = count.thisWeek - count.lastWeek;
  if (delta === 0) {
    return <span className="text-[12px] font-semibold text-muted-foreground">no change</span>;
  }
  const up = delta > 0;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[12px] font-semibold ${
        up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
      }`}
    >
      <Icon size={13} strokeWidth={2.5} />
      {Math.abs(delta)}
    </span>
  );
}

function PerformanceTile({
  label,
  count,
  caption,
  emphasis = false,
}: {
  label: string;
  count: WeeklyCount;
  caption: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">{label}</p>
      <div className="mt-3 flex items-baseline gap-2.5">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.p
            key={count.thisWeek}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
            className={`text-[2.25rem] font-black leading-none tracking-[-0.03em] tabular-nums ${
              emphasis ? "text-brand" : ""
            }`}
          >
            {count.thisWeek.toLocaleString()}
          </motion.p>
        </AnimatePresence>
        <Delta count={count} />
      </div>
      <p className="mt-3 text-[11px] text-foreground/40">
        {caption} · last week {count.lastWeek.toLocaleString()}
      </p>
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
  className = "",
}: PerformanceSectionProps) {
  const canPickCam = actorRole === "admin" || actorRole === "viewer";
  const [scope, setScope] = useState<Scope>({ kind: "team" });
  const [pickedCamId, setPickedCamId] = useState<string | null>(null);

  const applyScope = (next: Scope) => {
    setScope(next);
    if (next.kind !== "cam") setPickedCamId(null);
  };

  const person =
    scope.kind === "me"
      ? (summary.people.get(actorId) ?? null)
      : scope.kind === "cam"
        ? (summary.people.get(scope.userId) ?? null)
        : null;

  const scopeLabel =
    scope.kind === "team"
      ? "Whole team"
      : scope.kind === "me"
        ? "Your performance"
        : `${cams.find((cam) => cam.id === scope.userId)?.full_name || "This CAM"}'s performance`;

  const emailsSent = person ? person.emailsSent : summary.team.emailsSent;
  const replies = person ? person.replies : summary.team.replies;
  const conversions = person ? person.conversions : summary.team.conversions;

  // The trend card's headline is the *current* cumulative rate — the series'
  // last point — not a sum of daily rates.
  const currentRate = trend.length > 0 ? trend[trend.length - 1].value : 0;
  const formatRate = (value: number) => `${(value * 100).toFixed(1)}%`;

  const visibleSectors = sectors.slice(0, 8);
  const hiddenSectors = sectors.length - visibleSectors.length;

  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
        <h2 className="text-xl font-semibold font-body tracking-[-0.02em]">Performance</h2>
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
          {scopeLabel} · this week vs last
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ScopeToggle
          scope={scope}
          onScope={(next) => applyScope(next)}
        />
        {canPickCam && (
          <CamPicker
            cams={cams}
            selectedId={pickedCamId}
            onSelect={(userId) => applyScope(userId ? { kind: "cam", userId } : { kind: "team" })}
          />
        )}
        <span className="text-[11px] text-foreground/35">
          Trend and sector views are team-wide.
        </span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PerformanceTile label="Emails sent" count={emailsSent} caption="This week" />
        <PerformanceTile label="Replies received" count={replies} caption="This week" />
        <PerformanceTile label="Conversions" count={conversions} caption="This week" />
        <PerformanceTile
          label="Orgs scored"
          count={summary.orgsScored}
          caption="Team-wide · scoring runs system-wide"
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ProgressMetricCard
          title="Conversion rate trend"
          total={formatRate(currentRate)}
          deltaLabel=""
          data={trend}
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
            <span className="text-[11px] font-medium text-muted-foreground">Past 90 days</span>
          </div>

          {visibleSectors.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="max-w-xs text-center text-sm text-muted-foreground">
                No outreach in the trailing 90 days yet — sector rows appear with the first
                sent email.
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
    </div>
  );
}

export default PerformanceSection;
