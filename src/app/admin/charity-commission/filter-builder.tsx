"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowDownToLine,
  ArrowUpToLine,
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
import { PriceRangeSlider } from "@/components/ui/range-slider";
import { Checkbox } from "@/components/animate-ui/components/radix/checkbox";
import { GooeyEmailInput } from "@/components/ui/gooey-email-input";
import { InfoTooltip } from "@/components/ui/info-tooltip";
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
  describeFilters,
  isUnfiltered,
  normalisePostcodeArea,
  type CharityRegisterFilters,
} from "@/lib/charity-register/filters";
import {
  HOW_CLASSIFICATIONS,
  INCOME_STEPS,
  SUGGESTED_LOCAL_AUTHORITIES,
  SUGGESTED_POSTCODE_AREAS,
  UK_REGIONAL_GROUPS,
  WHAT_CLASSIFICATIONS,
  WHO_CLASSIFICATIONS,
  type RegionalGroup,
  type RegionalZone,
  type VocabularyEntry,
} from "@/lib/charity-register/vocabulary";
import {
  countRegisterSelection,
  deleteFilterPreset,
  previewRegisterSelection,
  saveFilterPreset,
  type PreviewState,
} from "./register-actions";
import {
  RegistrationDatePicker,
  formatRegistrationDate,
} from "./registration-date-picker";

/**
 * The import screen's centre of gravity: choose what to import, see how many
 * that is, then import it.
 *
 * ── Why the count is live, and now pinned ──
 *
 * Every control updates a number. That number is the whole design. Criteria
 * used to be constants in a config file whose effect nobody could see: the
 * £100k floor looked reasonable written down and in fact removed three-quarters
 * of the local register. With a live count you widen a bound and watch 794
 * become 4,335 — the consequence is visible at the moment of the decision, not
 * months later in a client list nobody can explain.
 *
 * It only works if you can see it. In the first version the count was a card at
 * the top of a very long stack, so it scrolled away exactly when you reached
 * the controls that change it — you would tick four causes and then scroll back
 * up to find out what you had done. It is now a sticky bar carrying the count,
 * what it means in words, and the two things you can do with it. The controls
 * move under it; it never leaves.
 *
 * ── Why the sections are collapsed ──
 *
 * Fully expanded this screen is about forty chips, six checkboxes, four selects
 * and three text inputs — most of which any given import never touches. Each
 * section states its own selection in its header ("Location — 3 areas", "Size —
 * £100k+"), so the collapsed stack is a readable summary of the whole
 * selection, and opening one is how you change it rather than how you check it.
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

const INCOME_SLIDER_MIN = 0;
const INCOME_SLIDER_MAX_PLUS = 5_250_000;
const INCOME_SLIDER_STEP = 25_000;

function formatIncomeSliderLabel(value: number): string {
  if (value >= INCOME_SLIDER_MAX_PLUS) return "£5m+";
  if (value === 0) return "£0";
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return Number.isInteger(m) ? `£${m}m` : `£${m.toFixed(2).replace(/\.?0+$/, "")}m`;
  }
  if (value >= 1_000) return `£${Math.round(value / 1_000)}k`;
  return `£${value}`;
}

/** Approximate income density distribution for UK registered charities from £0 to £5m+. */
const CHARITY_INCOME_HISTOGRAM: readonly number[] = [
  1.0, 0.98, 0.95, 0.92, 0.89, 0.86, 0.83, 0.80, 0.77, 0.74,
  0.71, 0.68, 0.65, 0.63, 0.61, 0.59, 0.57, 0.55, 0.53, 0.51,
  0.49, 0.48, 0.47, 0.46, 0.45, 0.44, 0.43, 0.43, 0.42, 0.42,
  0.42, 0.41, 0.41, 0.41, 0.42, 0.42, 0.43, 0.44, 0.45, 0.46,
  0.47, 0.49, 0.51, 0.53, 0.56, 0.59, 0.63, 0.68, 0.74, 0.82,
];

/** A list of labels, shortened once it stops being readable at a glance. */
export function summariseList(labels: string[], noun: string): string | null {
  if (labels.length === 0) return null;
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.length} ${noun}`;
}

function labelsFor(entries: readonly VocabularyEntry[], values: string[]): string[] {
  return values.map(
    (value) => entries.find((entry) => entry.value === value)?.label ?? value,
  );
}

/* ── Section ─────────────────────────────────────────────────────────────── */

/**
 * One collapsible group of controls, with its current selection in the header.
 *
 * The header summary is the reason this can be collapsed at all: a closed
 * section that says "3 areas" answers the question you would have opened it to
 * ask. A closed section that says nothing just hides state.
 *
 * ── Why Edit / Save rather than a chevron ──
 *
 * A chevron says "there is more of this". It does not say whether you are
 * reading or changing, which on a screen made entirely of settings is the only
 * distinction that matters — and at 16px in the corner it was the least
 * legible thing on the row. `Edit` and `Save` name the two modes, so the row
 * reads as a record you amend rather than a drawer you rummage in.
 *
 * `Save` is not a lie, and it is worth being careful about that. Nothing here
 * is persisted — the filters are already live, and the count is debounced 250ms
 * behind them — so Save flushes that debounce and waits for the real count
 * before confirming. "Saved" therefore means something true: the number in the
 * bar above now describes what you just changed. The 450ms floor is there
 * because a round trip that returns in 40ms reads as a glitch rather than as
 * work, and the tick holds for a beat afterwards so the confirmation survives
 * the section collapsing under it.
 */

type SaveState = "idle" | "saving" | "saved";

const SAVING_FLOOR_MS = 450;
const SAVED_HOLD_MS = 1600;

function stableSerialize(val: unknown): string {
  if (val === undefined || val === null) return "";
  if (Array.isArray(val)) {
    const items = val.map(stableSerialize);
    if (val.every((x) => typeof x === "string")) {
      items.sort();
    }
    return "[" + items.join(",") + "]";
  }
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return "{" + keys.map((k) => `${JSON.stringify(k)}:${stableSerialize(obj[k])}`).join(",") + "}";
  }
  return JSON.stringify(val);
}

export function FilterSection({
  title,
  summary,
  hint,
  defaultOpen = false,
  onCommit,
  snapshot,
  children,
}: {
  title: string;
  /** What is currently selected here, or null for "nothing — everything passes". */
  summary: string | null;
  hint?: string;
  defaultOpen?: boolean;
  /** Flushes the pending count so "Saved" is a claim about the real number. */
  onCommit?: () => Promise<void>;
  /** Relevant filter state for this section to detect if anything changed while open. */
  snapshot?: unknown;
  children: React.ReactNode;
}) {
  // All sections start collapsed by default on first open.
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [openedSnapshot, setOpenedSnapshot] = useState<string>(() =>
    stableSerialize(snapshot ?? summary),
  );

  const currentSnapshot = stableSerialize(snapshot ?? summary);
  const isDirty = isOpen && openedSnapshot !== currentSnapshot;

  // Both timers outlive the click that started them, so a section closed mid
  // cycle — or a reset that unmounts the tree — must not land a state update.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const save = async () => {
    setSaveState("saving");
    await Promise.all([
      onCommit?.(),
      new Promise<void>((resolve) => {
        timers.current.push(setTimeout(resolve, SAVING_FLOOR_MS));
      }),
    ]);
    setSaveState("saved");
    setIsOpen(false);
    setOpenedSnapshot(currentSnapshot);
    timers.current.push(setTimeout(() => setSaveState("idle"), SAVED_HOLD_MS));
  };

  const toggle = () => {
    if (saveState === "saving") return;
    if (isOpen) {
      if (!isDirty) {
        // Nothing changed since opening: close immediately with no delay and no count query
        setIsOpen(false);
        return;
      }
      void save();
      return;
    }
    // Opening: capture snapshot of current state to compare against while open
    setOpenedSnapshot(currentSnapshot);
    setSaveState("idle");
    setIsOpen(true);
  };

  return (
    <section className="border-t border-rule-soft first:border-t-0">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        disabled={saveState === "saving"}
        className="group flex w-full items-center gap-4 py-4 text-left"
      >
        <h3 className="shrink-0 font-body text-[19px] font-normal leading-[1.3] tracking-[-0.01em] text-ink">
          {title}
        </h3>
        <span
          className={`min-w-0 flex-1 truncate text-[13.5px] ${
            summary ? "text-ink" : "text-faint"
          }`}
        >
          {summary ?? "Any"}
        </span>

        {/* Visual affordance: when unchanged, says "Done" and closes instantly;
            when edited, becomes "Save" to flush the count and confirm. */}
        <span
          aria-hidden="true"
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-inset border px-2.5 py-1 text-[13px] font-medium transition-colors ${
            saveState === "saved"
              ? "border-go/30 bg-go-wash text-go"
              : saveState === "saving"
                ? "border-lead bg-white text-lead"
                : isOpen && isDirty
                  ? "border-lead bg-lead text-white hover:bg-lead-mid"
                  : "border-rule bg-white text-lead group-hover:border-lead hover:border-lead"
          }`}
        >
          {saveState === "saving" && (
            <Loader2 className="size-3.5 animate-spin text-lead" strokeWidth={2.2} />
          )}
          {saveState === "saved" && <Check className="size-3.5" strokeWidth={2.6} />}
          {saveState === "saving"
            ? "Saving…"
            : saveState === "saved"
              ? "Saved"
              : isOpen
                ? isDirty
                  ? "Save"
                  : "Done"
                : "Edit"}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="pb-5">
              {hint && (
                <p className="mb-3.5 max-w-[54ch] text-[13px] leading-[1.55] text-dim">
                  {hint}
                </p>
              )}
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

export function Chip({
  selected,
  onClick,
  children,
  count,
  countLabel,
  isPartial = false,
  variant = "navy",
  index = 0,
  ref,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
  countLabel?: string;
  isPartial?: boolean;
  variant?: "default" | "navy";
  /** Position in the list, so a filtered set arrives in reading order. */
  index?: number;
  /** AnimatePresence `popLayout` hands the exiting child its own ref. */
  ref?: React.Ref<HTMLButtonElement>;
}) {
  let selectedClasses =
    variant === "navy"
      ? "border-[#102a4e] bg-[#102a4e] text-white hover:bg-[#0d223f] hover:border-[#0d223f]"
      : "border-brand/30 bg-brand/10 text-brand";

  if (isPartial) {
    selectedClasses =
      variant === "navy"
        ? "border-[#102a4e]/40 bg-[#102a4e]/10 text-[#102a4e] hover:bg-[#102a4e]/15 hover:border-[#102a4e]/60"
        : "border-brand/40 bg-brand/10 text-brand";
  }

  const isHighlighted = selected || isPartial;

  const reduceMotion = useReducedMotion();

  return (
    <motion.button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      layout="position"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, filter: "blur(6px)" }}
      animate={
        reduceMotion
          ? { opacity: 1, transition: { duration: 0.15 } }
          : {
              opacity: 1,
              y: 0,
              filter: "blur(0px)",
              // Capped indexed stagger, not `staggerChildren`: 40 results at a
              // flat step would run for most of a second.
              transition: {
                duration: 0.4,
                ease: EASE,
                delay: Math.min(index * 0.016, 0.24),
              },
            }
      }
      exit={
        reduceMotion
          ? { opacity: 0, transition: { duration: 0.1 } }
          : {
              opacity: 0,
              y: -4,
              filter: "blur(5px)",
              transition: { duration: 0.16, ease: EASE },
            }
      }
      whileTap={{ scale: 0.97 }}
      transition={{
        // Survivors slide to their new position on one soft spring while the
        // dropped chips are already out of flow (`popLayout`). Stiffer than
        // this and every keystroke reads as a jolt.
        layout: reduceMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 300, damping: 34, mass: 0.9 },
      }}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
        isHighlighted
          ? selectedClasses
          : "border-black/[0.09] bg-white text-foreground/70 hover:border-black/20 hover:text-foreground"
      }`}
    >
      {selected && <Check className="h-3 w-3" strokeWidth={2.6} />}
      {isPartial && <span className="h-1.5 w-1.5 rounded-full bg-[#102a4e]" />}
      {children}
      {(count !== undefined || countLabel !== undefined) && (
        <span
          className={`tabular-nums ${
            selected && variant === "navy"
              ? "text-white/70"
              : isPartial && variant === "navy"
                ? "text-[#102a4e]/70"
                : "opacity-45"
          }`}
        >
          {countLabel ?? count?.toLocaleString()}
        </span>
      )}
    </motion.button>
  );
}

function ChipGroup({
  entries,
  selected,
  onToggle,
  variant = "navy",
}: {
  entries: readonly VocabularyEntry[];
  selected: string[];
  onToggle: (value: string) => void;
  variant?: "default" | "navy";
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map((entry, index) => (
        <Chip
          key={entry.value}
          selected={selected.includes(entry.value)}
          onClick={() => onToggle(entry.value)}
          count={entry.approxCount}
          variant={variant}
          index={index}
        >
          {entry.label}
        </Chip>
      ))}
    </div>
  );
}

/**
 * Key-order-independent equality for two filter sets.
 *
 * The builder rebuilds `filters` by spreading, so two selections that are the
 * same to the user routinely differ in key order and in whether a cleared list
 * is `[]` or absent. A plain `JSON.stringify` comparison would call a loaded set
 * "modified" the moment anything was touched and undone.
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

const sameFilters = (a: CharityRegisterFilters, b: CharityRegisterFilters) =>
  JSON.stringify(canonicalise(a) ?? {}) === JSON.stringify(canonicalise(b) ?? {});

type PresetState =
  | { kind: "idle" }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

export type PresetSummary = {
  id: string;
  name: string;
  description: string | null;
  filters: CharityRegisterFilters;
};

export function FilterBuilder({
  presets,
  localAuthorities,
  registerSize,
}: {
  presets: PresetSummary[];
  /** Every local authority in the snapshot, so the list can never go stale. */
  localAuthorities: string[];
  registerSize: number;
}) {
  const [filters, setFilters] = useState<CharityRegisterFilters>({
    excludeInsolvent: true,
  });
  const [count, setCount] = useState<number | null>(registerSize);
  const [counting, setCounting] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });
  const [showPreview, setShowPreview] = useState(false);
  const [presetName, setPresetName] = useState("");
  /** The set the current selection was loaded from, so the bar can say so. */
  const [loadedPreset, setLoadedPreset] = useState<PresetSummary | null>(null);
  const [saving, setSaving] = useState(false);
  /** Controlled so the delete dialog never opens behind a still-open menu. */
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState<PresetSummary | null>(null);
  /** Loading a set over unsaved work asks first — this is the set it would load. */
  const [pendingPreset, setPendingPreset] = useState<PresetSummary | null>(null);
  const [presetState, setPresetState] = useState<PresetState>({ kind: "idle" });
  const [laSearch, setLaSearch] = useState("");
  const [postcodeDraft, setPostcodeDraft] = useState("");
  const [selectedZone, setSelectedZone] = useState<RegionalZone>("All");
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

  /**
   * The same count, without the wait. A section's Save skips the 250ms debounce
   * and resolves only once the real number is on screen, which is what lets the
   * tick claim anything at all — see `FilterSection`.
   */
  const commitCount = async () => {
    const id = ++requestId.current;
    setCounting(true);
    const result = await countRegisterSelection(filters);
    if (id !== requestId.current) return;
    setCounting(false);
    if ("count" in result) setCount(result.count);
  };

  const description = useMemo(() => describeFilters(filters), [filters]);
  const unfiltered = useMemo(() => isUnfiltered(filters), [filters]);

  /**
   * Every filter mutation goes through here, because changing a filter
   * invalidates the preview sample, which would otherwise sit on screen
   * describing a selection that no longer exists. Clearing it here rather
   * than in an effect keeps the invalidation on the event that caused it.
   */
  const changeFilters = (
    next: (current: CharityRegisterFilters) => CharityRegisterFilters,
  ) => {
    setFilters(next);
    setPreview({ kind: "idle" });
    setShowPreview(false);
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

  const toggleRegionalGroup = (group: RegionalGroup) => {
    const current = filters.areas?.localAuthority ?? [];
    const allSelected = group.authorities.every((a) => current.includes(a));
    const next = allSelected
      ? current.filter((a) => !group.authorities.includes(a))
      : Array.from(new Set([...current, ...group.authorities]));

    update({
      areas: {
        ...filters.areas,
        localAuthority: next,
      },
    });
  };

  const filteredRegionalGroups = useMemo(() => {
    if (selectedZone === "All") return UK_REGIONAL_GROUPS;
    return UK_REGIONAL_GROUPS.filter((g) => g.zone === selectedZone);
  }, [selectedZone]);

  const visibleAuthorities = useMemo(() => {
    const chosen = filters.areas?.localAuthority ?? [];
    if (laSearch.trim()) {
      const needle = laSearch.trim().toLowerCase();
      return localAuthorities.filter((value) => value.toLowerCase().includes(needle)).slice(0, 40);
    }
    if (selectedZone !== "All") {
      const zoneGroups = UK_REGIONAL_GROUPS.filter((g) => g.zone === selectedZone);
      const zoneAuths = Array.from(new Set(zoneGroups.flatMap((g) => g.authorities)));
      return [
        ...zoneAuths,
        ...chosen.filter((value) => !zoneAuths.includes(value)),
      ];
    }
    return [
      ...SUGGESTED_LOCAL_AUTHORITIES,
      ...chosen.filter((value) => !SUGGESTED_LOCAL_AUTHORITIES.includes(value)),
    ];
  }, [laSearch, localAuthorities, selectedZone, filters.areas?.localAuthority]);

  /* ── Header summaries ──────────────────────────────────────────────────
     One per section, so the collapsed stack reads as the whole selection. */

  const sizeSummary = useMemo(() => {
    const { incomeMin, incomeMax, includeUnpublishedIncome } = filters;
    const parts: string[] = [];
    if (incomeMin != null && incomeMax != null) {
      parts.push(`${formatIncome(incomeMin)} – ${formatIncome(incomeMax)}`);
    } else if (incomeMin != null) {
      parts.push(`${formatIncome(incomeMin)}+`);
    } else if (incomeMax != null) {
      parts.push(`up to ${formatIncome(incomeMax)}`);
    }
    if (includeUnpublishedIncome === false) parts.push("published income only");
    return parts.length > 0 ? parts.join(" · ") : null;
  }, [filters]);

  const locationSummary = useMemo(() => {
    const postcodes = filters.postcodeAreas ?? [];
    const authorities = filters.areas?.localAuthority ?? [];
    const regions = filters.areas?.region ?? [];
    const parts: string[] = [];
    if (postcodes.length > 0) parts.push(summariseList(postcodes, "postcode areas")!);
    if (authorities.length > 0) parts.push(summariseList(authorities, "local authorities")!);
    if (regions.length > 0) parts.push(summariseList(regions, "regions")!);
    if (parts.length === 0) return null;
    return `${parts.join(" · ")}${filters.locationMatch === "all" ? " (both must match)" : ""}`;
  }, [filters]);

  const whatSummary = useMemo(
    () =>
      summariseList(
        labelsFor(WHAT_CLASSIFICATIONS, filters.classifications?.what ?? []),
        "causes",
      ),
    [filters.classifications?.what],
  );
  const whoSummary = useMemo(
    () =>
      summariseList(
        labelsFor(WHO_CLASSIFICATIONS, filters.classifications?.who ?? []),
        "groups",
      ),
    [filters.classifications?.who],
  );
  const howSummary = useMemo(
    () =>
      summariseList(
        labelsFor(HOW_CLASSIFICATIONS, filters.classifications?.how ?? []),
        "ways of working",
      ),
    [filters.classifications?.how],
  );

  const statusSummary = useMemo(() => {
    const parts: string[] = [];
    const from = filters.registeredFrom ? formatRegistrationDate(filters.registeredFrom) : null;
    const to = filters.registeredTo ? formatRegistrationDate(filters.registeredTo) : null;

    if (from && to) {
      parts.push(`registered ${from} to ${to}`);
    } else if (from) {
      parts.push(`registered from ${from}`);
    } else if (to) {
      parts.push(`registered up to ${to}`);
    }
    if (filters.hasFiledAccounts) parts.push("has filed accounts");
    if (filters.excludeInsolvent === false) parts.push("includes insolvent");
    return parts.length > 0 ? parts.join(" · ") : null;
  }, [filters]);

  const nameSummary = useMemo(() => {
    const names =
      filters.names && filters.names.length > 0
        ? filters.names
        : filters.nameContains?.trim()
          ? filters.nameContains.split(",").map((s) => s.trim()).filter(Boolean)
          : [];
    if (names.length === 0) return null;
    if (names.length === 1) return `contains “${names[0]}”`;
    if (names.length <= 3) return `contains ${names.map((n) => `“${n}”`).join(" or ")}`;
    return `${names.length} names`;
  }, [filters.names, filters.nameContains]);

  /* ── Actions ───────────────────────────────────────────────────────────── */

  /**
   * True when the selection on screen is the loaded set with edits on top. The
   * bar says so, and Save then offers to replace that set rather than making a
   * second one under a name already in use.
   */
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

  const loadPreset = (preset: PresetSummary) => {
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
  const requestPreset = (preset: PresetSummary) => {
    const hasUnsavedWork = loadedPreset ? isModified : !unfiltered;
    if (hasUnsavedWork) {
      setPendingPreset(preset);
      return;
    }
    loadPreset(preset);
  };

  const reset = () => {
    changeFilters(() => ({ excludeInsolvent: true, names: [], nameContains: "" }));
    setPresetName("");
    setLaSearch("");
    setPostcodeDraft("");
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
      setPreview(await previewRegisterSelection(filters));
    });
  };


  const doSave = () =>
    startTransition(async () => {
      const result = await saveFilterPreset(presetName, filters);
      setPresetState(
        result.ok
          ? { kind: "done", message: result.message }
          : { kind: "error", message: result.message },
      );
      if (!result.ok) return;

      setSaving(false);
      // The saved set becomes the loaded one, so the bar stops reporting edits
      // that have just been written down. `revalidatePath` brings the real row
      // back on the next render; until it lands the name is enough to label the
      // bar, and nothing keys off this id in the meantime.
      setLoadedPreset({
        id: loadedPreset?.id ?? presetName.trim(),
        name: presetName.trim(),
        description: null,
        filters,
      });
    });

  const doDelete = (preset: PresetSummary) =>
    startTransition(async () => {
      const result = await deleteFilterPreset(preset.id);
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
                  {count === 1 ? "charity selected" : "charities selected"}
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
                  they act on the whole selection, which is what this bar is,
                  and the returning user's first move is to load one — putting
                  that eight filter sections below the Import button meant
                  scrolling past everything to reach the one control they came
                  for, then scrolling back. */}
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
                No filters set, so this is the entire register. Narrow it below.
              </span>
            </p>
          )}

          {/* Saving a set is not importing, so it gets its own line. It used to
              report failure through importState, which painted "could not be
              saved" in the import slot as though the import had failed. */}
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
                          <th className="py-2 pr-3 font-bold">Charity</th>
                          <th className="py-2 pr-3 font-bold">Income</th>
                          <th className="py-2 pr-3 font-bold">Postcode</th>
                          <th className="py-2 font-bold">What they do</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((row) => (
                          <tr
                            key={row.organisation_number}
                            className="border-t border-black/[0.05]"
                          >
                            <td className="py-2 pr-3 font-semibold">{row.charity_name}</td>
                            <td className="py-2 pr-3 tabular-nums text-foreground/70">
                              {row.latest_income === null
                                ? "Not published"
                                : MONEY.format(row.latest_income)}
                            </td>
                            <td className="py-2 pr-3 text-foreground/60">
                              {row.postcode ?? "—"}
                            </td>
                            <td className="py-2 text-xs leading-[1.5] text-foreground/55">
                              {/* The register's own words for what this charity
                                  does — often a mission statement, sometimes two
                                  words. */}
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
          title="Size"
          summary={sizeSummary}
          snapshot={[filters.incomeMin, filters.incomeMax, filters.includeUnpublishedIncome]}
        >
          <div className="space-y-5 pt-2 pb-1">
            <div className="rounded-2xl p-4 sm:p-5">

              <PriceRangeSlider
                className="px-0"
                histogramHeight="h-36 sm:h-40"
                data={CHARITY_INCOME_HISTOGRAM as number[]}
                min={INCOME_SLIDER_MIN}
                max={INCOME_SLIDER_MAX_PLUS}
                step={INCOME_SLIDER_STEP}
                value={[
                  filters.incomeMin ?? INCOME_SLIDER_MIN,
                  filters.incomeMax ?? INCOME_SLIDER_MAX_PLUS,
                ]}
                onValueChange={([minVal, maxVal]) => {
                  update({
                    incomeMin: minVal <= 0 ? null : minVal,
                    incomeMax: maxVal >= INCOME_SLIDER_MAX_PLUS ? null : maxVal,
                  });
                }}
                formatValue={formatIncomeSliderLabel}
                title={null}
                minLabel="Minimum Income"
                maxLabel="Maximum Income"
                minSubtitle={
                  filters.incomeMin == null || filters.incomeMin === 0
                    ? "£0 (No minimum)"
                    : `From ${formatIncome(filters.incomeMin)}`
                }
                maxSubtitle={
                  filters.incomeMax == null || filters.incomeMax >= INCOME_SLIDER_MAX_PLUS
                    ? "£5m+ (No maximum)"
                    : `Up to ${formatIncome(filters.incomeMax)}`
                }
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-4">
              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="include-unpublished-income"
                  className="flex items-center gap-2.5 text-xs font-semibold text-foreground/80 cursor-pointer select-none"
                >
                  <Checkbox
                    id="include-unpublished-income"
                    size="sm"
                    checked={filters.includeUnpublishedIncome !== false}
                    onCheckedChange={(checked) =>
                      update({ includeUnpublishedIncome: Boolean(checked) })
                    }
                    className="border-black/20 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-white"
                  />
                  <span className="text-[14px]">Include charities with no published income</span>
                </label>
                <InfoTooltip
                  content="The register publishes no income figure for some charities. That is not the same as a small charity, so they are included unless you say otherwise."
                  side="top"
                />
              </div>

              {/* Quick Jump Dropdowns */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-foreground/50">Quick jump:</span>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <select
                      className="block appearance-none rounded-lg border border-black/15 bg-white py-1 pl-6 pr-7 text-xs font-semibold text-foreground focus:border-brand focus:outline-none"
                      value={filters.incomeMin ?? ""}
                      onChange={(event) =>
                        update({
                          incomeMin: event.target.value === "" ? null : Number(event.target.value),
                        })
                      }
                      title="Quick select minimum"
                    >
                      <option value="">Min: £0</option>
                      {INCOME_STEPS.filter((step): step is number => step !== null && step > 0).map((step) => (
                        <option key={step} value={step}>
                          Min: {formatIncome(step)}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-1.5 text-foreground/40">
                      <ArrowDownToLine className="size-3" aria-hidden="true" />
                    </span>
                    <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-1.5 text-foreground/40">
                      <ChevronDown className="size-3" aria-hidden="true" />
                    </span>
                  </div>

                  <div className="relative">
                    <select
                      className="block appearance-none rounded-lg border border-black/15 bg-white py-1 pl-6 pr-7 text-xs font-semibold text-foreground focus:border-brand focus:outline-none"
                      value={filters.incomeMax ?? ""}
                      onChange={(event) =>
                        update({
                          incomeMax: event.target.value === "" ? null : Number(event.target.value),
                        })
                      }
                      title="Quick select maximum"
                    >
                      <option value="">Max: £5m+</option>
                      {INCOME_STEPS.filter((step): step is number => step !== null && step > 0).map((step) => (
                        <option key={step} value={step}>
                          Max: {formatIncome(step)}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-1.5 text-foreground/40">
                      <ArrowUpToLine className="size-3" aria-hidden="true" />
                    </span>
                    <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-1.5 text-foreground/40">
                      <ChevronDown className="size-3" aria-hidden="true" />
                    </span>
                  </div>

                  {(filters.incomeMin != null || filters.incomeMax != null) && (
                    <button
                      type="button"
                      onClick={() => update({ incomeMin: null, incomeMax: null })}
                      className="rounded-lg px-2 py-1 text-xs font-semibold text-lead hover:bg-black/5 transition-colors cursor-pointer"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </FilterSection>

        <FilterSection
          onCommit={commitCount}
          title="Location"
          summary={locationSummary}
          snapshot={[filters.postcodeAreas, filters.areas, filters.locationMatch]}
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
                variant="navy"
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

          <div className="mt-5">
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-foreground/40">
              Areas of operation
            </p>
          </div>

          {/* Regional Groups */}
          <div className="mt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-foreground/75">
                Regional groups
              </p>
              {(filters.areas?.localAuthority?.length ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => update({ areas: { ...filters.areas, localAuthority: [] } })}
                  className="text-xs font-semibold text-foreground/50 hover:text-foreground transition-colors cursor-pointer"
                >
                  Clear all authorities ({filters.areas?.localAuthority?.length})
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-foreground/55">
              Click a regional group to batch-select all local authorities in that area.
            </p>

            {/* Zone filter tabs */}
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {(["All", "Yorkshire", "North", "Midlands & East", "London & South", "Wales"] as const).map(
                (zone) => (
                  <button
                    key={zone}
                    type="button"
                    onClick={() => setSelectedZone(zone)}
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                      selectedZone === zone
                        ? "bg-[#102a4e] text-white"
                        : "bg-black/[0.04] text-foreground/65 hover:bg-black/[0.08] hover:text-foreground"
                    }`}
                  >
                    {zone}
                  </button>
                ),
              )}
            </div>

            {/* Regional group chips */}
            <div className="relative mt-2.5 flex flex-wrap gap-1.5 min-h-[32px]">
              <AnimatePresence initial={false} mode="popLayout">
                {filteredRegionalGroups.map((group, groupIndex) => {
                  const chosen = filters.areas?.localAuthority ?? [];
                  const total = group.authorities.length;
                  const selectedCount = group.authorities.filter((a) => chosen.includes(a)).length;
                  const isAllSelected = total > 0 && selectedCount === total;
                  const isPartial = selectedCount > 0 && !isAllSelected;

                  return (
                    <Chip
                      key={group.id}
                      selected={isAllSelected}
                      isPartial={isPartial}
                      countLabel={isPartial ? `${selectedCount}/${total}` : `${total}`}
                      onClick={() => toggleRegionalGroup(group)}
                      variant="navy"
                      index={groupIndex}
                    >
                      {group.name}
                    </Chip>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>

          {/* Local Authorities */}
          <div className="mt-5 border-t border-black/[0.06] pt-4">
            <p className="text-xs font-semibold text-foreground/75">
              Local authorities {selectedZone !== "All" && `(${selectedZone})`}
            </p>
            <div className="mt-2">
              <div className="relative max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/35" />
                <input
                  value={laSearch}
                  onChange={(event) => setLaSearch(event.target.value)}
                  placeholder={`Search all ${localAuthorities.length} local authorities`}
                  className="w-full rounded-lg border border-black/15 py-1.5 pl-8 pr-7 text-sm placeholder:text-foreground/35"
                />
                {laSearch && (
                  <button
                    type="button"
                    onClick={() => setLaSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-foreground/40 hover:text-foreground cursor-pointer transition-colors"
                    title="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="relative mt-2 flex flex-wrap gap-1.5 min-h-[34px]">
                <AnimatePresence initial={false} mode="popLayout">
                  {visibleAuthorities.map((authority, authorityIndex) => (
                    <Chip
                      key={authority}
                      selected={(filters.areas?.localAuthority ?? []).includes(authority)}
                      onClick={() => toggleArea("localAuthority", authority)}
                      variant="navy"
                      index={authorityIndex}
                    >
                      {authority}
                    </Chip>
                  ))}
                  {visibleAuthorities.length === 0 && laSearch.trim() && (
                    <motion.p
                      key="empty"
                      initial={{ opacity: 0, y: 6, filter: "blur(5px)" }}
                      animate={{
                        opacity: 1,
                        y: 0,
                        filter: "blur(0px)",
                        // Lands after the outgoing chips have cleared, so the two
                        // states never overlap in the same 34px strip.
                        transition: { duration: 0.32, ease: EASE, delay: 0.1 },
                      }}
                      exit={{ opacity: 0, transition: { duration: 0.12 } }}
                      className="py-1 text-xs text-foreground/50"
                    >
                      No local authorities match “{laSearch.trim()}”.{" "}
                      <button
                        type="button"
                        onClick={() => setLaSearch("")}
                        className="font-semibold text-brand underline underline-offset-2 hover:text-foreground cursor-pointer"
                      >
                        Clear search
                      </button>
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </div>
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
        </FilterSection>

        <FilterSection
          onCommit={commitCount}
          title="What the charity does"
          summary={whatSummary}
          hint="The register's own classifications, all 17 of them. Select none to include every cause."
          snapshot={filters.classifications?.what}
        >
          <ChipGroup
            entries={WHAT_CLASSIFICATIONS}
            selected={filters.classifications?.what ?? []}
            onToggle={(value) => toggleClassification("what", value)}
          />
        </FilterSection>

        <FilterSection
          onCommit={commitCount}
          title="Who the charity helps"
          summary={whoSummary}
          snapshot={filters.classifications?.who}
        >
          <ChipGroup
            entries={WHO_CLASSIFICATIONS}
            selected={filters.classifications?.who ?? []}
            onToggle={(value) => toggleClassification("who", value)}
          />
        </FilterSection>

        <FilterSection
          onCommit={commitCount}
          title="How the charity works"
          summary={howSummary}
          snapshot={filters.classifications?.how}
        >
          <ChipGroup
            entries={HOW_CLASSIFICATIONS}
            selected={filters.classifications?.how ?? []}
            onToggle={(value) => toggleClassification("how", value)}
          />
        </FilterSection>

        <FilterSection
          onCommit={commitCount}
          title="Registration and status"
          summary={statusSummary}
          snapshot={[
            filters.registeredFrom,
            filters.registeredTo,
            filters.hasFiledAccounts,
            filters.excludeInsolvent,
          ]}
        >
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground/60">
                Registration date
              </span>
              <RegistrationDatePicker
                from={filters.registeredFrom ?? null}
                to={filters.registeredTo ?? null}
                onChange={({ from, to }) => update({ registeredFrom: from, registeredTo: to })}
              />
            </div>

            <div className="flex flex-wrap items-center gap-4 pb-0.5">
              <label
                htmlFor="has-filed-accounts"
                className="flex items-center gap-2 text-xs font-semibold text-foreground/70 cursor-pointer select-none"
              >
                <Checkbox
                  id="has-filed-accounts"
                  size="sm"
                  checked={filters.hasFiledAccounts === true}
                  onCheckedChange={(checked) =>
                    update({ hasFiledAccounts: Boolean(checked) })
                  }
                  className="border-black/20 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-white"
                />
                <span>Only charities that have filed accounts</span>
              </label>

              <label
                htmlFor="exclude-insolvent"
                className="flex items-center gap-2 text-xs font-semibold text-foreground/70 cursor-pointer select-none"
              >
                <Checkbox
                  id="exclude-insolvent"
                  size="sm"
                  checked={filters.excludeInsolvent !== false}
                  onCheckedChange={(checked) =>
                    update({ excludeInsolvent: Boolean(checked) })
                  }
                  className="border-black/20 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-white"
                />
                <span>Exclude insolvent or in administration</span>
              </label>
            </div>
          </div>
        </FilterSection>

        <FilterSection
          onCommit={commitCount}
          title="Name"
          summary={nameSummary}
          snapshot={[filters.names, filters.nameContains]}
        >
          <div className="space-y-4 pt-1">
            <p className="text-xs text-foreground/55">
              Filter charities by words in their registered name. Type a keyword and tap the plus (or press Enter) to add it.
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
                fieldLabel="Charity name"
                submitLabel="Add name"
                successPlaceholder="Added!"
                validate={(val) => {
                  if (!val.trim()) return "Please enter a name";
                  return null;
                }}
                onSubmit={async (name) => {
                  const tokens = name
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
                  if (tokens.length === 0) return;
                  const current =
                    filters.names && filters.names.length > 0
                      ? filters.names
                      : filters.nameContains
                        ? filters.nameContains.split(",").map((s) => s.trim()).filter(Boolean)
                        : [];
                  const next = [...current];
                  for (const token of tokens) {
                    if (!next.some((x) => x.toLowerCase() === token.toLowerCase())) {
                      next.push(token);
                    }
                  }
                  update({
                    names: next,
                    nameContains: next.join(", "),
                  });
                }}
              />

              {((filters.names && filters.names.length > 0) || Boolean(filters.nameContains?.trim())) && (
                <div className="flex flex-wrap items-center gap-2">
                  {(filters.names && filters.names.length > 0
                    ? filters.names
                    : filters.nameContains
                      ? filters.nameContains.split(",").map((s) => s.trim()).filter(Boolean)
                      : []
                  ).map((n) => (
                    <span
                      key={n}
                      className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-[#102a4e] px-3 py-1 text-xs font-semibold text-white shadow-xs"
                    >
                      <span>{n}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const current =
                            filters.names && filters.names.length > 0
                              ? filters.names
                              : filters.nameContains
                                ? filters.nameContains.split(",").map((s) => s.trim()).filter(Boolean)
                                : [];
                          const next = current.filter((x) => x.toLowerCase() !== n.toLowerCase());
                          update({
                            names: next,
                            nameContains: next.join(", "),
                          });
                        }}
                        aria-label={`Remove ${n}`}
                        className="rounded-full p-0.5 hover:bg-white/20 transition-colors cursor-pointer"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}

                  {((filters.names?.length ?? 0) > 1 || (filters.nameContains?.includes(",") ?? false)) && (
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
            placeholder="Sheffield arts, any size"
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
