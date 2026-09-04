"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check, Loader2, RotateCcw, Search, TriangleAlert } from "lucide-react";

import { OriginButton } from "@/components/ui/origin-button";
import {
  describeFilters,
  isUnfiltered,
  normalisePostcodeArea,
  type CharityRegisterFilters,
} from "@/lib/charity-register/filters";
import {
  HOW_CLASSIFICATIONS,
  INCOME_STEPS,
  REGIONS,
  SUGGESTED_LOCAL_AUTHORITIES,
  SUGGESTED_POSTCODE_AREAS,
  WHAT_CLASSIFICATIONS,
  WHO_CLASSIFICATIONS,
  type VocabularyEntry,
} from "@/lib/charity-register/vocabulary";
import {
  countRegisterSelection,
  previewRegisterSelection,
  runRegisterImport,
  saveFilterPreset,
  type ImportState,
  type PreviewState,
} from "../charity-commission/register-actions";

/**
 * The import screen's centre of gravity: choose what to import, see how many
 * that is, then import it.
 *
 * ── Why the count is live ──
 *
 * Every control updates a number at the top of the screen. That number is the
 * whole design. Criteria used to be constants in a config file whose effect
 * nobody could see: the £100k floor looked reasonable written down and in fact
 * removed three-quarters of the local register. With a live count you widen a
 * bound and watch 794 become 4,335 — the consequence is visible at the moment
 * of the decision, not months later in a client list nobody can explain.
 *
 * ── Nothing is pre-selected ──
 *
 * The screen opens on the whole register. Every filter is something you add, so
 * no criterion is ever applied that somebody did not choose. That is the
 * opposite of the previous default and it is deliberate.
 */

const MONEY = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

function formatIncome(value: number | null): string {
  if (value === null) return "No limit";
  if (value === 0) return "£0";
  if (value >= 1_000_000) return `£${value / 1_000_000}m`;
  if (value >= 1_000) return `£${value / 1_000}k`;
  return MONEY.format(value);
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-black/[0.06] py-5 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
      {hint && <p className="mt-1 text-xs leading-[1.6] text-foreground/55">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Chip({
  selected,
  onClick,
  children,
  count,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
        selected
          ? "border-brand/30 bg-brand/10 text-brand"
          : "border-black/[0.09] bg-white text-foreground/70 hover:border-black/20 hover:text-foreground"
      }`}
    >
      {selected && <Check className="h-3 w-3" strokeWidth={2.6} />}
      {children}
      {count !== undefined && (
        <span className="tabular-nums opacity-45">{count.toLocaleString()}</span>
      )}
    </button>
  );
}

function ChipGroup({
  entries,
  selected,
  onToggle,
}: {
  entries: readonly VocabularyEntry[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map((entry) => (
        <Chip
          key={entry.value}
          selected={selected.includes(entry.value)}
          onClick={() => onToggle(entry.value)}
          count={entry.approxCount}
        >
          {entry.label}
        </Chip>
      ))}
    </div>
  );
}

export type PresetSummary = {
  id: string;
  name: string;
  description: string | null;
  filters: CharityRegisterFilters;
};

export function FilterBuilder({
  presets,
  localAuthorities,
  snapshotDate,
  registerSize,
}: {
  presets: PresetSummary[];
  /** Every local authority in the snapshot, so the list can never go stale. */
  localAuthorities: string[];
  snapshotDate: string | null;
  registerSize: number;
}) {
  const [filters, setFilters] = useState<CharityRegisterFilters>({});
  const [count, setCount] = useState<number | null>(registerSize);
  const [counting, setCounting] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });
  const [importState, setImportState] = useState<ImportState>({ kind: "idle" });
  const [confirming, setConfirming] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [laSearch, setLaSearch] = useState("");
  const [postcodeDraft, setPostcodeDraft] = useState("");
  const [isPending, startTransition] = useTransition();

  // Every filter change re-counts, debounced so dragging a control does not fire
  // a request per frame. The ref guards against an older, slower response
  // overwriting a newer one — the count must always describe what is on screen.
  const requestId = useRef(0);
  useEffect(() => {
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      setCounting(true);
      const result = await countRegisterSelection(filters);
      if (id !== requestId.current) return;
      setCounting(false);
      if ("count" in result) setCount(result.count);
    }, 250);
    return () => clearTimeout(timer);
  }, [filters]);

  const description = useMemo(() => describeFilters(filters), [filters]);
  const unfiltered = useMemo(() => isUnfiltered(filters), [filters]);

  /**
   * Every filter mutation goes through here, because changing a filter
   * invalidates two things that would otherwise sit on screen describing a
   * selection that no longer exists: the preview sample, and the summary of a
   * finished import. Clearing them here rather than in an effect keeps the
   * invalidation on the event that caused it.
   */
  const changeFilters = (
    next: (current: CharityRegisterFilters) => CharityRegisterFilters,
  ) => {
    setFilters(next);
    setPreview({ kind: "idle" });
    setImportState({ kind: "idle" });
    setConfirming(false);
  };

  const update = (patch: Partial<CharityRegisterFilters>) =>
    changeFilters((current) => ({ ...current, ...patch }));

  const toggleIn = (list: string[] | undefined, value: string): string[] => {
    const current = list ?? [];
    return current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value];
  };

  const toggleClassification = (dimension: "what" | "who" | "how", value: string) =>
    changeFilters((current) => ({
      ...current,
      classifications: {
        ...current.classifications,
        [dimension]: toggleIn(current.classifications?.[dimension], value),
      },
    }));

  const toggleArea = (level: "localAuthority" | "region" | "country", value: string) =>
    changeFilters((current) => ({
      ...current,
      areas: { ...current.areas, [level]: toggleIn(current.areas?.[level], value) },
    }));

  const visibleAuthorities = useMemo(() => {
    const chosen = filters.areas?.localAuthority ?? [];
    if (!laSearch.trim()) {
      // Suggested first, then anything already chosen that is not among them, so
      // a selection never disappears when the search box is cleared.
      return [
        ...SUGGESTED_LOCAL_AUTHORITIES,
        ...chosen.filter((value) => !SUGGESTED_LOCAL_AUTHORITIES.includes(value)),
      ];
    }
    const needle = laSearch.trim().toLowerCase();
    return localAuthorities.filter((value) => value.toLowerCase().includes(needle)).slice(0, 40);
  }, [laSearch, localAuthorities, filters.areas?.localAuthority]);

  const loadPreset = (preset: PresetSummary) => {
    changeFilters(() => preset.filters);
    setPresetName(preset.name);
  };

  const reset = () => {
    changeFilters(() => ({}));
    setPresetName("");
    setLaSearch("");
    setPostcodeDraft("");
  };

  const doPreview = () =>
    startTransition(async () => {
      setPreview(await previewRegisterSelection(filters));
    });

  const doImport = () =>
    startTransition(async () => {
      setImportState(await runRegisterImport(filters));
      setConfirming(false);
      setCounting(false);
    });

  const doSave = () =>
    startTransition(async () => {
      const result = await saveFilterPreset(presetName, filters);
      if (!result.ok) setImportState({ kind: "error", message: result.message });
    });

  return (
    <div className="space-y-6">
      {/* The count, and the sentence it answers to. */}
      <section className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-xs sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
              This will import
            </p>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="text-[clamp(2rem,5vw,3rem)] font-semibold leading-none tabular-nums tracking-[-0.03em]">
                {count === null ? "—" : count.toLocaleString()}
              </span>
              <span className="text-sm text-foreground/55">
                {count === 1 ? "charity" : "charities"}
              </span>
              {counting && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground/30" />
              )}
            </p>
            <p className="mt-2 max-w-xl text-sm leading-[1.6] text-foreground/65">
              {description}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-foreground/55 transition-colors hover:bg-black/[0.04] hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.2} />
              Clear filters
            </button>
            <OriginButton onClick={doPreview} disabled={isPending} size="md" type="button">
              Preview
            </OriginButton>
          </div>
        </div>

        {snapshotDate && (
          <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/30">
            Register snapshot {snapshotDate} · {registerSize.toLocaleString()} charities staged
          </p>
        )}
      </section>

      {presets.length > 0 && (
        <section className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-xs sm:p-6">
          <h3 className="text-sm font-bold text-foreground">Saved filter sets</h3>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => loadPreset(preset)}
                title={preset.description ?? undefined}
                className="rounded-full border border-black/[0.09] bg-white px-3 py-1.5 text-xs font-semibold text-foreground/70 transition-colors hover:border-black/20 hover:text-foreground"
              >
                {preset.name}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-xs sm:p-6">
        <Section
          title="Size"
          hint="The register publishes no income figure for some charities. That is not the same as a small charity, so they are included unless you say otherwise."
        >
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-xs font-semibold text-foreground/60">
              From
              <select
                className="mt-1 block rounded-lg border border-black/15 bg-white px-2.5 py-1.5 text-sm font-semibold text-foreground"
                value={filters.incomeMin ?? ""}
                onChange={(event) =>
                  update({
                    incomeMin: event.target.value === "" ? null : Number(event.target.value),
                  })
                }
              >
                <option value="">No minimum</option>
                {INCOME_STEPS.filter((step): step is number => step !== null).map((step) => (
                  <option key={step} value={step}>
                    {formatIncome(step)}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-semibold text-foreground/60">
              To
              <select
                className="mt-1 block rounded-lg border border-black/15 bg-white px-2.5 py-1.5 text-sm font-semibold text-foreground"
                value={filters.incomeMax ?? ""}
                onChange={(event) =>
                  update({
                    incomeMax: event.target.value === "" ? null : Number(event.target.value),
                  })
                }
              >
                <option value="">No maximum</option>
                {INCOME_STEPS.filter((step): step is number => step !== null).map((step) => (
                  <option key={step} value={step}>
                    {formatIncome(step)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 pb-1.5 text-xs font-semibold text-foreground/70">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-black/25"
                checked={filters.includeUnpublishedIncome !== false}
                onChange={(event) =>
                  update({ includeUnpublishedIncome: event.target.checked })
                }
              />
              Include charities with no published income
            </label>
          </div>
        </Section>

        <Section
          title="Location"
          hint="A charity counts as local if its address is in one of these postcode areas, or if it tells the register it operates in one of these places. Either is enough."
        >
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-foreground/40">
            Postcode areas
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {[
              ...SUGGESTED_POSTCODE_AREAS,
              ...(filters.postcodeAreas ?? []).filter(
                (area) => !SUGGESTED_POSTCODE_AREAS.includes(area),
              ),
            ].map((area) => (
              <Chip
                key={area}
                selected={(filters.postcodeAreas ?? []).includes(area)}
                onClick={() => update({ postcodeAreas: toggleIn(filters.postcodeAreas, area) })}
              >
                {area}
              </Chip>
            ))}
            <input
              value={postcodeDraft}
              onChange={(event) => setPostcodeDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                const area = normalisePostcodeArea(postcodeDraft);
                if (!area) return;
                update({ postcodeAreas: toggleIn(filters.postcodeAreas, area) });
                setPostcodeDraft("");
              }}
              placeholder="Add area, e.g. LS"
              className="w-36 rounded-full border border-dashed border-black/20 px-3 py-1.5 text-xs font-semibold placeholder:text-foreground/35"
            />
          </div>

          <p className="mt-4 text-xs font-bold uppercase tracking-[0.1em] text-foreground/40">
            Areas of operation
          </p>
          <div className="mt-2">
            <div className="relative max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/35" />
              <input
                value={laSearch}
                onChange={(event) => setLaSearch(event.target.value)}
                placeholder={`Search all ${localAuthorities.length} local authorities`}
                className="w-full rounded-lg border border-black/15 py-1.5 pl-8 pr-2.5 text-sm placeholder:text-foreground/35"
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {visibleAuthorities.map((authority) => (
                <Chip
                  key={authority}
                  selected={(filters.areas?.localAuthority ?? []).includes(authority)}
                  onClick={() => toggleArea("localAuthority", authority)}
                >
                  {authority}
                </Chip>
              ))}
            </div>
          </div>

          <p className="mt-4 text-xs font-bold uppercase tracking-[0.1em] text-foreground/40">
            Regions
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {REGIONS.map((region) => (
              <Chip
                key={region}
                selected={(filters.areas?.region ?? []).includes(region)}
                onClick={() => toggleArea("region", region)}
              >
                {region}
              </Chip>
            ))}
          </div>

          <label className="mt-4 flex items-center gap-2 text-xs font-semibold text-foreground/70">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-black/25"
              checked={filters.locationMatch === "all"}
              onChange={(event) =>
                update({ locationMatch: event.target.checked ? "all" : "any" })
              }
            />
            Require both the postcode area and the area of operation to match
          </label>
        </Section>

        <Section
          title="What the charity does"
          hint="The register's own classifications, all 17 of them. Select none to include every cause."
        >
          <ChipGroup
            entries={WHAT_CLASSIFICATIONS}
            selected={filters.classifications?.what ?? []}
            onToggle={(value) => toggleClassification("what", value)}
          />
        </Section>

        <Section title="Who the charity helps">
          <ChipGroup
            entries={WHO_CLASSIFICATIONS}
            selected={filters.classifications?.who ?? []}
            onToggle={(value) => toggleClassification("who", value)}
          />
        </Section>

        <Section title="How the charity works">
          <ChipGroup
            entries={HOW_CLASSIFICATIONS}
            selected={filters.classifications?.how ?? []}
            onToggle={(value) => toggleClassification("how", value)}
          />
        </Section>

        <Section
          title="Registration and status"
          hint="Registration dates let you ask for charities registered in any period — the last month, or a decade ago."
        >
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-xs font-semibold text-foreground/60">
              Registered from
              <input
                type="date"
                value={filters.registeredFrom ?? ""}
                onChange={(event) => update({ registeredFrom: event.target.value || null })}
                className="mt-1 block rounded-lg border border-black/15 px-2.5 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs font-semibold text-foreground/60">
              Registered to
              <input
                type="date"
                value={filters.registeredTo ?? ""}
                onChange={(event) => update({ registeredTo: event.target.value || null })}
                className="mt-1 block rounded-lg border border-black/15 px-2.5 py-1.5 text-sm"
              />
            </label>
            <label className="flex items-center gap-2 pb-1.5 text-xs font-semibold text-foreground/70">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-black/25"
                checked={filters.hasFiledAccounts === true}
                onChange={(event) => update({ hasFiledAccounts: event.target.checked })}
              />
              Only charities that have filed accounts
            </label>
            <label className="flex items-center gap-2 pb-1.5 text-xs font-semibold text-foreground/70">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-black/25"
                checked={filters.excludeInsolvent === true}
                onChange={(event) => update({ excludeInsolvent: event.target.checked })}
              />
              Exclude insolvent or in administration
            </label>
          </div>
        </Section>

        <Section title="Name">
          <input
            value={filters.nameContains ?? ""}
            onChange={(event) => update({ nameContains: event.target.value })}
            placeholder="Name contains…"
            className="w-full max-w-sm rounded-lg border border-black/15 px-3 py-1.5 text-sm placeholder:text-foreground/35"
          />
        </Section>
      </section>

      {preview.kind === "ready" && (
        <section className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-xs sm:p-6">
          <h3 className="text-sm font-bold text-foreground">
            A sample of the {preview.count.toLocaleString()} selected
          </h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[42rem] text-left text-sm">
              <thead className="text-[11px] font-bold uppercase tracking-[0.1em] text-foreground/40">
                <tr>
                  <th className="py-2 pr-3 font-bold">Charity</th>
                  <th className="py-2 pr-3 font-bold">Income</th>
                  <th className="py-2 pr-3 font-bold">Postcode</th>
                  <th className="py-2 font-bold">What they do</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.organisation_number} className="border-t border-black/[0.05]">
                    <td className="py-2 pr-3 font-semibold">{row.charity_name}</td>
                    <td className="py-2 pr-3 tabular-nums text-foreground/70">
                      {row.latest_income === null
                        ? "Not published"
                        : MONEY.format(row.latest_income)}
                    </td>
                    <td className="py-2 pr-3 text-foreground/60">{row.postcode ?? "—"}</td>
                    <td className="py-2 text-xs leading-[1.5] text-foreground/55">
                      {/* The register's own words for what this charity does —
                          often a mission statement, sometimes two words. */}
                      {row.activities
                        ? row.activities.length > 140
                          ? `${row.activities.slice(0, 140)}…`
                          : row.activities
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {preview.kind === "error" && (
        <p className="rounded-xl bg-red-50 p-4 text-sm font-bold text-red-900" role="alert">
          {preview.message}
        </p>
      )}

      {/* Import, behind a confirmation that restates the count and criteria. */}
      <section className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-xs sm:p-6">
        <h3 className="text-sm font-bold text-foreground">Import</h3>
        <p className="mt-1.5 max-w-2xl text-sm leading-[1.6] text-foreground/65">
          Adds the selected charities to the client list, with their filed accounts
          where the register has them. Charities already on the list are matched,
          not duplicated, so re-running a filter set is safe.
        </p>

        {unfiltered && (
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-[1.6] text-amber-900">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
            <span>
              No filters are set, so this selects the entire register. That is
              almost certainly not what you want — narrow it first.
            </span>
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {confirming ? (
            <>
              <OriginButton onClick={doImport} disabled={isPending} size="md" type="button">
                {isPending
                  ? "Importing…"
                  : `Yes, import ${count?.toLocaleString() ?? ""} charities`}
              </OriginButton>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-xs font-bold text-foreground/55 hover:text-foreground"
              >
                Cancel
              </button>
            </>
          ) : (
            <OriginButton
              onClick={() => setConfirming(true)}
              disabled={isPending || count === 0}
              size="md"
              type="button"
            >
              Import these charities
            </OriginButton>
          )}

          <span className="flex items-center gap-2">
            <input
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
              placeholder="Save these filters as…"
              className="w-48 rounded-lg border border-black/15 px-3 py-1.5 text-sm placeholder:text-foreground/35"
            />
            <button
              type="button"
              onClick={doSave}
              disabled={isPending || !presetName.trim()}
              className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-brand transition-colors hover:bg-brand/5 disabled:opacity-40"
            >
              Save
            </button>
          </span>
        </div>

        {confirming && (
          <p className="mt-3 max-w-2xl rounded-xl bg-black/[0.03] p-3 text-xs leading-[1.6] text-foreground/70">
            <strong className="font-bold text-foreground">{description}</strong> This
            will be recorded against your name in the audit log.
          </p>
        )}

        {importState.kind === "done" && (
          <p
            className="mt-4 rounded-xl bg-green-50 p-4 text-sm font-bold text-green-900"
            role="status"
          >
            {importState.message}
          </p>
        )}
        {importState.kind === "error" && (
          <p className="mt-4 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-900" role="alert">
            {importState.message}
          </p>
        )}
      </section>
    </div>
  );
}
