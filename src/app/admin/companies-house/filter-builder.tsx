"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Bookmark,
  BookmarkPlus,
  Check,
  ChevronDown,
  Loader2,
  RotateCcw,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

import { EASE } from "@/components/brand/motion";
import { OriginButton } from "@/components/ui/origin-button";
import { Checkbox } from "@/components/animate-ui/components/radix/checkbox";
import { GooeyEmailInput } from "@/components/ui/gooey-email-input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/animate-ui/components/radix/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/animate-ui/components/radix/dropdown-menu";
import {
  Chip,
  FilterSection,
  summariseList,
} from "../charity-commission/filter-builder";
import {
  formatRegistrationDate,
  RegistrationDatePicker,
} from "../charity-commission/registration-date-picker";
import {
  describeFilters,
  isUnfiltered,
  type CompanyRegisterFilters,
} from "@/lib/companies-register/filters";
import {
  COMPANY_STATUS_OPTIONS,
  companyTypeLabel as typeLabel,
  DEFAULT_STATUSES,
  sicSectionOf,
  SIC_SECTIONS,
} from "@/lib/companies-register/vocabulary";
import {
  CITY_REGION_PRESETS,
  formatPostcodeAreaLabel,
  resolveLocationInput,
  type CityRegionPreset,
  type CityRegionZone,
} from "@/lib/companies-register/city-postcodes";
import type { SicValue } from "@/lib/companies-register/sqlite";
import {
  countCompaniesSelection,
  deleteCompaniesFilterPreset,
  previewCompaniesSelection,
  runCompaniesRegisterImport,
  saveCompaniesFilterPreset,
  type ImportState,
  type PreviewState,
} from "./register-actions";

/**
 * The companies import screen's centre of gravity: choose what to import, see
 * how many that is, then import it.
 *
 * The twin of the charity screen's FilterBuilder, built on the same
 * primitives (the sticky count bar, collapsible sections that summarise
 * themselves, the sample under the bar, saved sets, import-behind-confirm).
 * The sections differ where the data differs: SIC codes instead of
 * classifications, company types instead of charity types, incorporation
 * dates instead of registration dates, no income bounds (the product
 * publishes no figures), and no areas of operation (a company has one
 * registered office — geography is postcode areas plus town).
 */


function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(canonicalise);
    return items.length === 0 ? undefined : [...items].sort();
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [key, canonicalise(entry)] as const)
      .filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
      .sort(([a], [b]) => a.localeCompare(b));
    return entries.length === 0 ? undefined : Object.fromEntries(entries);
  }
  return value;
}

/**
 * The server's ceiling on a single run, mirrored here so the confirmation can
 * say what will actually happen before it happens.
 *
 * Deliberately a duplicated constant rather than an import: register-actions
 * is a "use server" module, and pulling a value out of it into this client
 * component would drag the server module into the browser bundle. The pair is
 * pinned by a test in register-actions' own suite.
 */
const MAX_IMPORT = 10_000;

const sameFilters = (a: CompanyRegisterFilters, b: CompanyRegisterFilters) =>
  JSON.stringify(canonicalise(a) ?? {}) === JSON.stringify(canonicalise(b) ?? {});

type PresetState =
  | { kind: "idle" }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

export type CompaniesPresetSummary = {
  id: string;
  name: string;
  description: string | null;
  filters: CompanyRegisterFilters;
};

type SicEntry = SicValue & { section: string | null };

export function CompaniesFilterBuilder({
  presets,
  sicValues,
  registerSize,
}: {
  presets: CompaniesPresetSummary[];
  /** Every SIC code in the snapshot with its title and staged count. */
  sicValues: SicValue[];
  registerSize: number;
}) {
  const [filters, setFilters] = useState<CompanyRegisterFilters>({
    statuses: [...DEFAULT_STATUSES],
  });
  const [count, setCount] = useState<number | null>(registerSize);
  const [counting, setCounting] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });
  const [showPreview, setShowPreview] = useState(false);
  const [importState, setImportState] = useState<ImportState>({ kind: "idle" });
  const [confirming, setConfirming] = useState(false);
  const [presetName, setPresetName] = useState("");
  /** The set the current selection was loaded from, so the bar can say so. */
  const [loadedPreset, setLoadedPreset] = useState<CompaniesPresetSummary | null>(null);
  const [saving, setSaving] = useState(false);
  /** Controlled so the delete dialog never opens behind a still-open menu. */
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState<CompaniesPresetSummary | null>(null);
  /** Loading a set over unsaved work asks first — this is the set it would load. */
  const [pendingPreset, setPendingPreset] = useState<CompaniesPresetSummary | null>(null);
  const [presetState, setPresetState] = useState<PresetState>({ kind: "idle" });
  const [sicSearch, setSicSearch] = useState("");
  const [postcodeDraft, setPostcodeDraft] = useState("");
  const [selectedLocationZone, setSelectedLocationZone] = useState<CityRegionZone>("All");
  const [isPending, startTransition] = useTransition();
  const reduceMotion = useReducedMotion();

  // Every filter change re-counts, debounced so typing does not fire a request
  // per keystroke. The ref guards against an older, slower response
  // overwriting a newer one — the count must always describe what is on screen.
  const requestId = useRef(0);
  useEffect(() => {
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      setCounting(true);
      const result = await countCompaniesSelection(filters);
      if (id !== requestId.current) return;
      setCounting(false);
      if ("count" in result) setCount(result.count);
    }, 250);
    return () => clearTimeout(timer);
  }, [filters]);

  /**
   * The same count, without the wait. A section's Save skips the 250ms debounce
   * and resolves only once the real number is on screen, which is what lets the
   * tick claim anything at all.
   */
  const commitCount = async () => {
    const id = ++requestId.current;
    setCounting(true);
    const result = await countCompaniesSelection(filters);
    if (id !== requestId.current) return;
    setCounting(false);
    if ("count" in result) setCount(result.count);
  };

  const description = useMemo(() => describeFilters(filters), [filters]);
  const unfiltered = useMemo(() => isUnfiltered(filters), [filters]);
  // The server caps every run at MAX_IMPORT and takes them in company-number
  // order. Saying so before the click matters: the count above can read
  // 716,282 while the run imports 10,000, and a confirmation that promises the
  // larger number is simply wrong.
  const overCap = count !== null && count > MAX_IMPORT;

  /**
   * Every filter mutation goes through here, because changing a filter
   * invalidates two things that would otherwise sit on screen describing a
   * selection that no longer exists: the preview sample, and the summary of a
   * finished import. Clearing them here rather than in an effect keeps the
   * invalidation on the event that caused it.
   */
  const changeFilters = (
    next: (current: CompanyRegisterFilters) => CompanyRegisterFilters,
  ) => {
    setFilters(next);
    setPreview({ kind: "idle" });
    setShowPreview(false);
    setImportState({ kind: "idle" });
    setConfirming(false);
  };

  const update = (patch: Partial<CompanyRegisterFilters>) =>
    changeFilters((current) => ({ ...current, ...patch }));

  const toggleIn = (list: string[] | undefined, value: string): string[] => {
    const current = list ?? [];
    return current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value];
  };

  const nameTokens = useMemo(() => {
    if (filters.names && filters.names.length > 0) return filters.names;
    if (filters.nameContains?.trim()) {
      return filters.nameContains.split(",").map((s) => s.trim()).filter(Boolean);
    }
    return [];
  }, [filters.names, filters.nameContains]);

  const addNameToken = (raw: string) => {
    const tokens = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (tokens.length === 0) return;
    const next = [...nameTokens];
    for (const token of tokens) {
      if (!next.some((x) => x.toLowerCase() === token.toLowerCase())) next.push(token);
    }
    update({ names: next, nameContains: next.join(", ") });
  };

  const removeNameToken = (token: string) => {
    const next = nameTokens.filter((x) => x.toLowerCase() !== token.toLowerCase());
    update({ names: next, nameContains: next.join(", ") });
  };

  /* ── SIC entries: searched, grouped, counted ─────────────────────────── */

  const sicEntries: SicEntry[] = useMemo(
    () =>
      sicValues.map((entry) => ({
        ...entry,
        section: sicSectionOf(entry.sic),
      })),
    [sicValues],
  );

  const chosenSics = useMemo(
    () => sicEntries.filter((entry) => (filters.sicCodes ?? []).includes(entry.sic)),
    [sicEntries, filters.sicCodes],
  );

  const visibleSics = useMemo(() => {
    if (sicSearch.trim()) {
      const needle = sicSearch.trim().toLowerCase();
      return sicEntries
        .filter(
          (entry) =>
            entry.sic.includes(needle) || entry.title.toLowerCase().includes(needle),
        )
        .slice(0, 60);
    }
    // At rest: the most common codes first (capped), then anything chosen that
    // is not among them. Chosen codes render as removable tokens above the
    // search, so the sections below exclude them rather than showing them twice.
    const common = [...sicEntries].sort((a, b) => b.companies - a.companies).slice(0, 30);
    const commonCodes = new Set(common.map((entry) => entry.sic));
    const chosen = new Set(filters.sicCodes ?? []);
    return [
      ...common,
      ...chosenSics.filter((entry) => !commonCodes.has(entry.sic)),
    ].filter((entry) => !chosen.has(entry.sic));
  }, [sicSearch, sicEntries, chosenSics, filters.sicCodes]);

  const sicSections = useMemo(() => {
    const bySection = new Map<string | null, SicEntry[]>();
    for (const entry of visibleSics) {
      const list = bySection.get(entry.section) ?? [];
      list.push(entry);
      bySection.set(entry.section, list);
    }
    return SIC_SECTIONS.map((section) => ({
      ...section,
      entries: bySection.get(section.letter) ?? [],
    })).filter((section) => section.entries.length > 0);
  }, [visibleSics]);

  /* ── Header summaries: the collapsed stack reads as the whole selection ── */

  const nameSummary = useMemo(() => {
    if (nameTokens.length === 0) return null;
    if (nameTokens.length === 1) return `contains “${nameTokens[0]}”`;
    if (nameTokens.length <= 3) return `contains ${nameTokens.map((n) => `“${n}”`).join(" or ")}`;
    return `${nameTokens.length} names`;
  }, [nameTokens]);

  const locationSummary = useMemo(() => {
    const postcodes = filters.postcodeAreas ?? [];
    if (postcodes.length === 0) return null;
    return summariseList(postcodes, "postcode areas");
  }, [filters.postcodeAreas]);

  const filteredCityPresets = useMemo(() => {
    if (selectedLocationZone === "All") return CITY_REGION_PRESETS;
    return CITY_REGION_PRESETS.filter((p) => p.zone === selectedLocationZone);
  }, [selectedLocationZone]);

  const toggleCityPreset = (preset: CityRegionPreset) => {
    const current = filters.postcodeAreas ?? [];
    const allSelected = preset.postcodeAreas.every((p) => current.includes(p));
    const next = allSelected
      ? current.filter((p) => !preset.postcodeAreas.includes(p))
      : [...new Set([...current, ...preset.postcodeAreas])];
    update({ postcodeAreas: next });
  };

  const handleLocationSubmit = (raw: string) => {
    const areas = resolveLocationInput(raw);
    if (areas.length === 0) return;
    const current = filters.postcodeAreas ?? [];
    const next = [...new Set([...current, ...areas])];
    update({ postcodeAreas: next });
  };

  const sicSummary = useMemo(() => {
    const codes = filters.sicCodes ?? [];
    if (codes.length === 0) return null;
    if (codes.length <= 2) {
      const titles = codes.map(
        (code) => sicEntries.find((entry) => entry.sic === code)?.title ?? code,
      );
      return titles.join(", ");
    }
    return `${codes.length} SIC codes`;
  }, [filters.sicCodes, sicEntries]);

  const statusSummary = useMemo(() => {
    const parts: string[] = [];
    const from = filters.incorporatedFrom ? formatRegistrationDate(filters.incorporatedFrom) : null;
    const to = filters.incorporatedTo ? formatRegistrationDate(filters.incorporatedTo) : null;
    if (from && to) parts.push(`incorporated ${from} to ${to}`);
    else if (from) parts.push(`incorporated from ${from}`);
    else if (to) parts.push(`incorporated up to ${to}`);
    const statuses = filters.statuses;
    if (statuses && !(statuses.length === 1 && statuses[0] === "active")) {
      parts.push(
        statuses.length === 0 ? "every status" : `status ${statuses.join(", ")}`,
      );
    }
    return parts.length > 0 ? parts.join(" · ") : null;
  }, [filters.incorporatedFrom, filters.incorporatedTo, filters.statuses]);

  /* ── Actions ───────────────────────────────────────────────────────────── */

  const isModified = useMemo(
    () => (loadedPreset ? !sameFilters(filters, loadedPreset.filters) : false),
    [filters, loadedPreset],
  );

  /** The set the open Save dialog would overwrite, matched the way the DB does. */
  const replacingPreset = useMemo(() => {
    const key = presetName.trim().toLowerCase();
    if (!key) return null;
    return presets.find((preset) => preset.name.trim().toLowerCase() === key) ?? null;
  }, [presetName, presets]);

  const loadPreset = (preset: CompaniesPresetSummary) => {
    changeFilters(() => preset.filters);
    setPresetName(preset.name);
    setLoadedPreset(preset);
    setPendingPreset(null);
    setPresetState({ kind: "idle" });
  };

  /**
   * Loading discards whatever is on screen, so it asks first — but only when
   * there is something to lose: a selection built from scratch, or a loaded set
   * with edits on top. Loading over an untouched set is silent.
   */
  const requestPreset = (preset: CompaniesPresetSummary) => {
    const hasUnsavedWork = loadedPreset ? isModified : !unfiltered;
    if (hasUnsavedWork) {
      setPendingPreset(preset);
      return;
    }
    loadPreset(preset);
  };

  const reset = () => {
    changeFilters(() => ({ statuses: [...DEFAULT_STATUSES], names: [], nameContains: "" }));
    setPresetName("");
    setSicSearch("");
    setPostcodeDraft("");
    setSelectedLocationZone("All");
    setLoadedPreset(null);
    setPresetState({ kind: "idle" });
  };

  const doPreview = () => {
    if (showPreview) {
      setShowPreview(false);
      return;
    }
    setShowPreview(true);
    startTransition(async () => {
      setPreview(await previewCompaniesSelection(filters));
    });
  };

  const doImport = () =>
    startTransition(async () => {
      setImportState(await runCompaniesRegisterImport(filters));
      setConfirming(false);
      setCounting(false);
    });

  const doSave = () =>
    startTransition(async () => {
      const result = await saveCompaniesFilterPreset(presetName, filters);
      setPresetState(
        result.ok
          ? { kind: "done", message: result.message }
          : { kind: "error", message: result.message },
      );
      if (!result.ok) return;

      setSaving(false);
      // The saved set becomes the loaded one, so the bar stops reporting edits
      // that have just been written down.
      setLoadedPreset({
        id: loadedPreset?.id ?? presetName.trim(),
        name: presetName.trim(),
        description: null,
        filters,
      });
    });

  const doDelete = (preset: CompaniesPresetSummary) =>
    startTransition(async () => {
      const result = await deleteCompaniesFilterPreset(preset.id);
      setPresetState(
        result.ok
          ? { kind: "done", message: `Deleted “${preset.name}”.` }
          : { kind: "error", message: result.message },
      );
      setDeleting(null);
      if (result.ok && loadedPreset?.id === preset.id) setLoadedPreset(null);
    });

  return (
    <div className="space-y-4">
      {/* ── The selection, pinned ──────────────────────────────────────────
          Sticky rather than a card in the flow: this is the readout for every
          control below it, and a readout you have to scroll back to is not one. */}
      <div className="sticky top-0 z-20 -mx-1 px-1 pb-1 pt-1">
        <div className="rounded-2xl border border-black/[0.09] bg-white/85 p-4 shadow-sm backdrop-blur-md sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline gap-2">
                <span className="text-[clamp(1.75rem,4vw,2.5rem)] font-semibold leading-none tabular-nums tracking-[-0.03em]">
                  {count === null ? "—" : count.toLocaleString()}
                </span>
                <span className="text-sm text-foreground/55">
                  {count === 1 ? "company selected" : "companies selected"}
                </span>
                {counting && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground/30" />
                )}
              </p>
              <p className="mt-1.5 line-clamp-2 text-xs leading-[1.6] text-foreground/60">
                {description}
              </p>
              {/* Which saved set this is, and whether it still is one. Without
                  it, Save is a coin toss between "new set" and "overwrite". */}
              {loadedPreset && (
                <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-foreground/45">
                  <Bookmark className="h-3 w-3" strokeWidth={2.4} />
                  <span className="truncate">{loadedPreset.name}</span>
                  {isModified && (
                    <span className="font-medium text-foreground/40">· modified</span>
                  )}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Saved sets live here, not in a card at the foot of the page:
                  they act on the whole selection, which is what this bar is. */}
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger
                  className="inline-flex items-center gap-1.5 rounded-lg border border-black/[0.12] px-3 py-1.5 text-xs font-bold text-foreground/70 transition-colors hover:border-black/25 hover:text-foreground cursor-pointer"
                  aria-label="Saved filter sets"
                >
                  <Bookmark className="h-3.5 w-3.5" strokeWidth={2.2} />
                  Saved sets
                  <ChevronDown className="h-3 w-3 opacity-50" strokeWidth={2.4} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel>Saved filter sets</DropdownMenuLabel>
                  {presets.length === 0 ? (
                    <p className="px-2 py-2 text-xs leading-[1.6] text-foreground/50">
                      None yet. Build a selection, then save it here to re-run it
                      next cycle.
                    </p>
                  ) : (
                    presets.map((preset) => (
                      <DropdownMenuItem
                        key={preset.id}
                        onSelect={() => requestPreset(preset)}
                        className="group/preset flex items-start gap-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold">
                            {preset.name}
                          </span>
                          {preset.description && (
                            <span className="mt-0.5 block line-clamp-2 text-[11px] leading-[1.5] text-foreground/50">
                              {preset.description}
                            </span>
                          )}
                        </span>
                        {loadedPreset?.id === preset.id && (
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" strokeWidth={2.6} />
                        )}
                        {/* Nested control inside the row: the row loads, the
                            trash deletes, and the delete must not also load. */}
                        <button
                          type="button"
                          aria-label={`Delete ${preset.name}`}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setMenuOpen(false);
                            setDeleting(preset);
                          }}
                          className="mt-0.5 shrink-0 rounded p-0.5 text-foreground/30 opacity-0 transition-opacity hover:text-red-600 focus-visible:opacity-100 group-hover/preset:opacity-100 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />
                        </button>
                      </DropdownMenuItem>
                    ))
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={unfiltered}
                    onSelect={() => {
                      setPresetName(loadedPreset?.name ?? "");
                      setPresetState({ kind: "idle" });
                      setSaving(true);
                    }}
                  >
                    <BookmarkPlus className="h-3.5 w-3.5" strokeWidth={2.2} />
                    <span className="text-xs font-semibold">
                      {loadedPreset && isModified ? "Save changes as…" : "Save this selection…"}
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                type="button"
                onClick={reset}
                disabled={unfiltered}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-foreground/55 transition-colors hover:bg-black/[0.04] hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.2} />
                Clear
              </button>
              <button
                type="button"
                onClick={doPreview}
                disabled={isPending || count === 0}
                className="rounded-lg border border-black/[0.12] px-3 py-1.5 text-xs font-bold text-foreground/70 transition-colors hover:border-black/25 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                {showPreview ? "Hide sample" : "See a sample"}
              </button>
            </div>
          </div>

          {unfiltered && (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-[1.6] text-amber-900">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
              <span>
                No filters set, so this is every live company in the staged register. Narrow it below.
              </span>
            </p>
          )}

          {/* Saving a set is not importing, so it gets its own line. */}
          {presetState.kind !== "idle" && (
            <p
              className={`mt-3 rounded-lg px-3 py-2 text-xs font-bold leading-[1.6] ${
                presetState.kind === "done"
                  ? "bg-green-50 text-green-900"
                  : "bg-red-50 text-red-900"
              }`}
              role={presetState.kind === "error" ? "alert" : "status"}
            >
              {presetState.message}
            </p>
          )}
        </div>
      </div>

      {/* The sample sits directly under the bar rather than at the bottom of
          the page: it is evidence for the count, and evidence three screens
          away from the claim is not evidence. */}
      <AnimatePresence initial={false}>
        {showPreview && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="overflow-hidden"
          >
            <section className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-xs sm:p-6">
              {preview.kind === "ready" ? (
                <>
                  <h3 className="text-sm font-bold text-foreground">
                    A sample of the {preview.count.toLocaleString()} selected
                  </h3>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[42rem] text-left text-sm">
                      <thead className="text-[11px] font-bold uppercase tracking-[0.1em] text-foreground/40">
                        <tr>
                          <th className="py-2 pr-3 font-bold">Company</th>
                          <th className="py-2 pr-3 font-bold">Type</th>
                          <th className="py-2 pr-3 font-bold">Postcode</th>
                          <th className="py-2 pr-3 font-bold">Town</th>
                          <th className="py-2 font-bold">Incorporated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((row) => (
                          <tr
                            key={row.number}
                            className="border-t border-black/[0.05]"
                          >
                            <td className="py-2 pr-3 font-semibold">
                              {row.name}
                              {row.is_cic === 1 && (
                                <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-bold text-brand">
                                  CIC
                                </span>
                              )}
                            </td>
                            <td className="py-2 pr-3 text-xs text-foreground/60">
                              {row.cat_slug ? typeLabel(row.cat_slug) : "—"}
                            </td>
                            <td className="py-2 pr-3 text-foreground/60">
                              {row.postcode ?? "—"}
                            </td>
                            <td className="py-2 pr-3 text-foreground/60">
                              {row.town ?? "—"}
                            </td>
                            <td className="py-2 tabular-nums text-foreground/60">
                              {row.incorp_date ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : preview.kind === "error" ? (
                <p className="text-sm font-bold text-red-900" role="alert">
                  {preview.message}
                </p>
              ) : (
                <p className="flex items-center gap-2 text-sm text-foreground/55">
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />
                  Fetching a sample…
                </p>
              )}
            </section>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── The controls ──────────────────────────────────────────────────── */}
      <section className="rounded-panel border border-rule bg-white px-5">
        <FilterSection
          onCommit={commitCount}
          title="Name"
          summary={nameSummary}
          snapshot={[filters.names, filters.nameContains]}
        >
          <div className="space-y-4 pt-1">
            <p className="text-xs text-foreground/55">
              Filter companies by words in their registered name. Type a keyword and tap the plus (or press Enter) to add it.
            </p>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
              <GooeyEmailInput
                variant="light"
                size="sm"
                fieldWidth={240}
                gap={48}
                duration={640}
                buttonIcon="plus"
                placeholder="Add name, e.g. Hospice…"
                inputType="text"
                align="start"
                className="shrink-0"
                fieldLabel="Company name"
                submitLabel="Add name"
                successPlaceholder="Added!"
                validate={(val) => {
                  if (!val.trim()) return "Please enter a name";
                  return null;
                }}
                onSubmit={async (name) => {
                  addNameToken(name);
                }}
              />

              {nameTokens.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {nameTokens.map((token) => (
                    <span
                      key={token}
                      className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-[#102a4e] px-3 py-1 text-xs font-semibold text-white shadow-xs"
                    >
                      <span>{token}</span>
                      <button
                        type="button"
                        onClick={() => removeNameToken(token)}
                        aria-label={`Remove ${token}`}
                        className="rounded-full p-0.5 hover:bg-white/20 transition-colors cursor-pointer"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}

                  {nameTokens.length > 1 && (
                    <button
                      type="button"
                      onClick={() => update({ names: [], nameContains: "" })}
                      className="text-xs font-semibold text-foreground/50 hover:text-foreground transition-colors cursor-pointer ml-1"
                    >
                      Clear all
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </FilterSection>

        <FilterSection
          onCommit={commitCount}
          title="Location"
          summary={locationSummary}
          hint="Where the company's registered office is. Select cities, regional groups, or type any city name or postcode."
          snapshot={[filters.postcodeAreas]}
        >
          <div className="space-y-3 pt-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-foreground/75">
                Cities &amp; regional groups
              </p>
              {(filters.postcodeAreas?.length ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => update({ postcodeAreas: [] })}
                  className="text-xs font-semibold text-foreground/50 hover:text-foreground transition-colors cursor-pointer"
                >
                  Clear all ({filters.postcodeAreas?.length})
                </button>
              )}
            </div>
            <p className="text-xs text-foreground/55">
              Click a city or region to toggle all its postcode areas, or type any city name or postcode below.
            </p>

            {/* Zone filter tabs */}
            <div className="flex flex-wrap items-center gap-1.5">
              {(["All", "Yorkshire", "North", "Midlands", "London & South", "Wales & Scotland"] as const).map(
                (zone) => (
                  <button
                    key={zone}
                    type="button"
                    onClick={() => setSelectedLocationZone(zone)}
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                      selectedLocationZone === zone
                        ? "bg-[#102a4e] text-white"
                        : "bg-black/[0.04] text-foreground/65 hover:bg-black/[0.08] hover:text-foreground"
                    }`}
                  >
                    {zone}
                  </button>
                ),
              )}
            </div>

            {/* City & region chips */}
            <div className="relative flex flex-wrap gap-1.5 min-h-[32px]">
              <AnimatePresence initial={false} mode="popLayout">
                {filteredCityPresets.map((preset, index) => {
                  const current = filters.postcodeAreas ?? [];
                  const total = preset.postcodeAreas.length;
                  const selectedCount = preset.postcodeAreas.filter((p) => current.includes(p)).length;
                  const isAllSelected = total > 0 && selectedCount === total;
                  const isPartial = selectedCount > 0 && !isAllSelected;

                  return (
                    <Chip
                      key={preset.id}
                      selected={isAllSelected}
                      isPartial={isPartial}
                      countLabel={total > 1 ? (isPartial ? `${selectedCount}/${total}` : `${total}`) : undefined}
                      onClick={() => toggleCityPreset(preset)}
                      variant="navy"
                      index={index}
                    >
                      {preset.name}
                    </Chip>
                  );
                })}
              </AnimatePresence>
            </div>

            {/* Search / manual input */}
            <div className="pt-2">
              <p className="text-xs font-semibold text-foreground/75 mb-1.5">
                Add city or postcode
              </p>
              <div className="flex max-w-md items-center gap-2">
                <input
                  value={postcodeDraft}
                  onChange={(event) => setPostcodeDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    if (!postcodeDraft.trim()) return;
                    handleLocationSubmit(postcodeDraft);
                    setPostcodeDraft("");
                  }}
                  placeholder="e.g. Manchester, Leeds, Sheffield, or M, LS, S1 2HE…"
                  className="w-full rounded-lg border border-black/15 px-3 py-1.5 text-sm placeholder:text-foreground/35"
                />
              </div>
            </div>

            {/* Active postcode areas */}
            {(filters.postcodeAreas?.length ?? 0) > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-black/[0.06]">
                <p className="text-xs font-semibold text-foreground/75">
                  Selected postcode areas ({filters.postcodeAreas?.length})
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(filters.postcodeAreas ?? []).map((area) => (
                    <span
                      key={area}
                      className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-[#102a4e] px-2.5 py-1 text-xs font-semibold text-white shadow-xs"
                    >
                      <span>{formatPostcodeAreaLabel(area)}</span>
                      <button
                        type="button"
                        onClick={() =>
                          update({
                            postcodeAreas: (filters.postcodeAreas ?? []).filter((a) => a !== area),
                          })
                        }
                        aria-label={`Remove ${area}`}
                        className="rounded-full p-0.5 hover:bg-white/20 transition-colors cursor-pointer"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                  {(filters.postcodeAreas?.length ?? 0) > 1 && (
                    <button
                      type="button"
                      onClick={() => update({ postcodeAreas: [] })}
                      className="text-xs font-semibold text-foreground/50 hover:text-foreground transition-colors cursor-pointer ml-1"
                    >
                      Clear all
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </FilterSection>

        <FilterSection
          onCommit={commitCount}
          title="What the company does"
          summary={sicSummary}
          hint="Standard Industrial Classification codes — the closest the register comes to saying what a company actually does. Search by code or keyword; the count beside each code is how many staged companies carry it."
          snapshot={filters.sicCodes}
        >
          <div className="space-y-4 pt-1">
            <div className="relative max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/35" />
              <input
                value={sicSearch}
                onChange={(event) => setSicSearch(event.target.value)}
                placeholder={`Search all ${sicValues.length} SIC codes`}
                className="w-full rounded-lg border border-black/15 py-1.5 pl-8 pr-7 text-sm placeholder:text-foreground/35"
              />
              {sicSearch && (
                <button
                  type="button"
                  onClick={() => setSicSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-foreground/40 hover:text-foreground cursor-pointer transition-colors"
                  title="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {(filters.sicCodes?.length ?? 0) > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {chosenSics.map((entry) => (
                  <span
                    key={entry.sic}
                    className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-[#102a4e] px-3 py-1 text-xs font-semibold text-white shadow-xs"
                  >
                    <span>
                      {entry.sic} — {entry.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => update({ sicCodes: toggleIn(filters.sicCodes, entry.sic) })}
                      aria-label={`Remove ${entry.sic}`}
                      className="rounded-full p-0.5 hover:bg-white/20 transition-colors cursor-pointer"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => update({ sicCodes: [] })}
                  className="text-xs font-semibold text-foreground/50 hover:text-foreground transition-colors cursor-pointer ml-1"
                >
                  Clear all
                </button>
              </div>
            )}
            <div className="space-y-5">
              {sicSections.map((section) => (
                <div key={section.letter}>
                  <p className="text-xs font-bold uppercase tracking-[0.1em] text-foreground/40">
                    {section.letter} — {section.title}
                  </p>
                  <div className="relative mt-2 flex flex-wrap gap-1.5">
                    <AnimatePresence initial={false} mode="popLayout">
                      {section.entries
                        .filter((entry) => !(filters.sicCodes ?? []).includes(entry.sic))
                        .map((entry, entryIndex) => (
                          <Chip
                            key={entry.sic}
                            selected={false}
                            onClick={() =>
                              update({ sicCodes: toggleIn(filters.sicCodes, entry.sic) })
                            }
                            count={entry.companies}
                            variant="navy"
                            index={entryIndex}
                          >
                            {entry.sic} — {entry.title}
                          </Chip>
                        ))}
                    </AnimatePresence>
                  </div>
                </div>
              ))}
              {sicSections.length === 0 && sicSearch.trim() && (
                <motion.p
                  key="empty"
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6, filter: "blur(5px)" }}
                  animate={
                    reduceMotion
                      ? { opacity: 1, transition: { duration: 0.15 } }
                      : {
                          opacity: 1,
                          y: 0,
                          filter: "blur(0px)",
                          transition: { duration: 0.32, ease: EASE, delay: 0.1 },
                        }
                  }
                  exit={{ opacity: 0, transition: { duration: 0.12 } }}
                  className="py-1 text-xs text-foreground/50"
                >
                  No SIC codes match “{sicSearch.trim()}”.{" "}
                  <button
                    type="button"
                    onClick={() => setSicSearch("")}
                    className="font-semibold text-brand underline underline-offset-2 hover:text-foreground cursor-pointer"
                  >
                    Clear search
                  </button>
                </motion.p>
              )}
            </div>
          </div>
        </FilterSection>

        <FilterSection
          onCommit={commitCount}
          title="Incorporation and status"
          summary={statusSummary}
          snapshot={[filters.incorporatedFrom, filters.incorporatedTo, filters.statuses]}
        >
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground/60">
                Incorporation date
              </span>
              <RegistrationDatePicker
                from={filters.incorporatedFrom ?? null}
                to={filters.incorporatedTo ?? null}
                onChange={({ from, to }) => update({ incorporatedFrom: from, incorporatedTo: to })}
              />
            </div>

            <div className="flex flex-col gap-2 pb-0.5">
              <span className="text-xs font-semibold text-foreground/60">
                Company status
              </span>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {COMPANY_STATUS_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    htmlFor={`status-${option.value}`}
                    className="flex items-center gap-2 text-xs font-semibold text-foreground/70 cursor-pointer select-none"
                  >
                    <Checkbox
                      id={`status-${option.value}`}
                      size="sm"
                      checked={(filters.statuses ?? [...DEFAULT_STATUSES]).includes(option.value)}
                      onCheckedChange={(checked) => {
                        const current = filters.statuses ?? [...DEFAULT_STATUSES];
                        const next = checked
                          ? [...current, option.value]
                          : current.filter((s) => s !== option.value);
                        update({ statuses: next });
                      }}
                      className="border-black/20 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-white"
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
              <p className="text-[11px] leading-[1.55] text-foreground/45">
                Live companies only, unless you say otherwise. Clearing every box
                shows non-live companies too — for review, not for outreach.
              </p>
            </div>
          </div>
        </FilterSection>
      </section>

      {/* ── Import, behind a confirmation that restates the count and criteria ── */}
      <section className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-xs sm:p-6">
        <h3 className="text-sm font-bold text-foreground">Import</h3>
        <p className="mt-1.5 text-sm leading-[1.6] text-foreground/65">
          Adds the selected companies to the client list. Companies already on
          the list are matched, not duplicated, so re-running a filter set is
          safe. A single import is capped at 10,000 companies.
        </p>

        {unfiltered && (
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-[1.6] text-amber-900">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
            <span>
              No filters are set, so this selects every live company in the
              staged register. That is almost certainly not what you want —
              narrow it first.
            </span>
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {confirming ? (
            <>
              <OriginButton onClick={doImport} disabled={isPending} size="md" type="button">
                {isPending
                  ? "Importing…"
                  : overCap
                    ? `Yes, import the first ${MAX_IMPORT.toLocaleString()}`
                    : `Yes, import ${count?.toLocaleString() ?? ""} companies`}
              </OriginButton>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-xs font-bold text-foreground/55 hover:text-foreground cursor-pointer"
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
              Import these companies
            </OriginButton>
          )}
        </div>

        {confirming && (
          <p className="mt-3 max-w-2xl rounded-xl bg-black/[0.03] p-3 text-xs leading-[1.6] text-foreground/70">
            <strong className="font-bold text-foreground">{description}</strong>{" "}
            {overCap && (
              <>
                Only the first {MAX_IMPORT.toLocaleString()} of{" "}
                {count?.toLocaleString()} will be imported, ordered by company
                number — narrow the filters if you want a particular{" "}
                {MAX_IMPORT.toLocaleString()}.{" "}
              </>
            )}
            This will be recorded against your name in the audit log.
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
          <p
            className="mt-4 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-900"
            role="alert"
          >
            {importState.message}
          </p>
        )}
      </section>

      {/* ── Save a filter set ─────────────────────────────────────────────
          A dialog rather than a name box parked in the bar: naming is the last
          step of building a selection, not a control you need in view while you
          build it, and the bar is already carrying the count, the description
          and three actions. */}
      <Dialog open={saving} onOpenChange={setSaving}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save this selection</DialogTitle>
            <DialogDescription className="leading-[1.65]">
              {description}
            </DialogDescription>
          </DialogHeader>

          <input
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
            placeholder="Sheffield CICs, health and care"
            autoFocus
            className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm placeholder:text-foreground/35"
          />

          {presetState.kind === "error" && (
            <p
              className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold leading-[1.6] text-red-900"
              role="alert"
            >
              {presetState.message}
            </p>
          )}

          {replacingPreset && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs leading-[1.6] text-amber-900">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
              <span>
                A set called “{replacingPreset.name}” already exists. Saving
                replaces it — its old criteria are not kept.
              </span>
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm font-bold text-foreground/60 transition-colors hover:bg-black/[0.04] hover:text-foreground"
              >
                Cancel
              </button>
            </DialogClose>
            <OriginButton
              onClick={doSave}
              disabled={isPending || !presetName.trim()}
              size="md"
              type="button"
            >
              <span className="inline-flex items-center gap-1.5">
                {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />}
                {replacingPreset ? "Replace" : "Save"}
              </span>
            </OriginButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Discard the current selection ─────────────────────────────────── */}
      <Dialog open={pendingPreset !== null} onOpenChange={(open) => !open && setPendingPreset(null)}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Load “{pendingPreset?.name}”?</DialogTitle>
            <DialogDescription className="leading-[1.65]">
              {loadedPreset
                ? `This replaces your edits to “${loadedPreset.name}”, which have not been saved.`
                : "This replaces the selection you have built, which has not been saved."}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <DialogClose asChild>
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm font-bold text-foreground/60 transition-colors hover:bg-black/[0.04] hover:text-foreground"
              >
                Keep what I have
              </button>
            </DialogClose>
            <OriginButton
              onClick={() => pendingPreset && loadPreset(pendingPreset)}
              size="md"
              type="button"
            >
              Load it
            </OriginButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete a filter set ───────────────────────────────────────────── */}
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
            <DialogDescription className="leading-[1.65]">
              The saved criteria go for everyone, not just you. Nothing already
              imported is affected — this removes the shortcut, not the clients.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <DialogClose asChild>
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm font-bold text-foreground/60 transition-colors hover:bg-black/[0.04] hover:text-foreground"
              >
                Cancel
              </button>
            </DialogClose>
            <button
              type="button"
              onClick={() => deleting && doDelete(deleting)}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-40 cursor-pointer"
            >
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />}
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
