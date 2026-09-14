"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Loader2, Plus, RotateCcw, Search, X } from "lucide-react";
import { EASE } from "@/components/brand/motion";
import { FiledCheckbox } from "@/components/ui/filed-checkbox";
import { PriceRangeSlider } from "@/components/ui/range-slider";
import {
  INCOME_STOP_HISTOGRAM,
  INCOME_STOP_POSITIONS,
  describeIncomeRange,
  formatIncome,
  incomeMaxAtPosition,
  incomeMinAtPosition,
  incomeStopLabel,
  positionForIncomeMax,
  positionForIncomeMin,
} from "@/lib/income-range";
import {
  ALL_LOCAL_AUTHORITIES,
  SUGGESTED_LOCAL_AUTHORITIES,
  UK_REGIONAL_GROUPS,
  type RegionalGroup,
  type RegionalZone,
} from "@/lib/charity-register/vocabulary";
import { saveOutreachPreferencesAction, type OutreachPreferencesState } from "./actions";
import {
  DEFAULT_FIRST_FOLLOW_UP_DAYS,
  DEFAULT_SECOND_FOLLOW_UP_DAYS,
  GEOGRAPHIC_REACH_OPTIONS,
  GEOGRAPHIC_REACH_LABELS,
  MAX_CITIES,
  MAX_FIRST_FOLLOW_UP_DAYS,
  MAX_SECOND_FOLLOW_UP_DAYS,
  MIN_FOLLOW_UP_DAYS,
  SECTOR_CATEGORY_GROUPS,
  SECTOR_PRESETS,
  validateFollowUpOrdering,
  type GeographicReach,
} from "./constants";
import {
  CARD,
  CARD_HINT,
  CARD_TITLE,
  FIELD_LABEL,
  FOOTNOTE,
  INPUT,
  PRIMARY_BUTTON,
  QUIET_BUTTON,
  ROW_ACTION,
} from "../styles";

export type OutreachPreferences = {
  geographicReach: GeographicReach[];
  cities: string[];
  sectors: string[];
  /** Annual income range in pounds; null is unbounded on that side. */
  incomeMin: number | null;
  incomeMax: number | null;
  prioritiseGrantRecipients: boolean;
  firstFollowUpDays: number;
  secondFollowUpDays: number;
};

type SectionId = "where" | "sectors" | "size" | "grants" | "followUp";

const REACH_DESCRIPTIONS: Record<GeographicReach, string> = {
  local: "Works in one town or city.",
  regional: "Works across a county or region.",
  national: "Works across the UK.",
  international: "Works outside the UK.",
};

const ZONES: readonly RegionalZone[] = [
  "All",
  "Yorkshire",
  "North",
  "Midlands & East",
  "London & South",
  "Wales",
];

const NUMBER_INPUT = INPUT.replace("w-full", "w-20");
const SEARCH_INPUT = INPUT.replace("px-3", "pr-8 pl-8");

// ─── Values ──────────────────────────────────────────────────────────────────

const sameText = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const hasText = (list: readonly string[], value: string) =>
  list.some((item) => sameText(item, value));

/** A header summary: the list itself while it is short, then a count. */
function summarise(labels: string[]): string | null {
  if (labels.length === 0) return null;
  if (labels.length <= 3) return labels.join(", ");
  return `${labels.slice(0, 2).join(", ")} +${labels.length - 2} more`;
}

const rangeOf = (preferences: OutreachPreferences) => ({
  min: preferences.incomeMin,
  max: preferences.incomeMax,
});

function toFormData(preferences: OutreachPreferences): FormData {
  const formData = new FormData();
  for (const value of preferences.geographicReach) formData.append("geographic_reach", value);
  for (const value of preferences.cities) formData.append("city", value);
  for (const value of preferences.sectors) formData.append("sector", value);
  if (preferences.incomeMin !== null) formData.set("income_min", String(preferences.incomeMin));
  if (preferences.incomeMax !== null) formData.set("income_max", String(preferences.incomeMax));
  if (preferences.prioritiseGrantRecipients) formData.set("prioritise_grant_recipients", "true");
  formData.set("first_follow_up_days", String(preferences.firstFollowUpDays));
  formData.set("second_follow_up_days", String(preferences.secondFollowUpDays));
  return formData;
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

/** A toggleable option. Solid lead when chosen, like the import screen's chips. */
function Chip({
  selected,
  partial = false,
  onClick,
  disabled = false,
  count,
  children,
}: {
  selected: boolean;
  /** Some, not all, of a group is chosen. */
  partial?: boolean;
  onClick: () => void;
  disabled?: boolean;
  count?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] leading-none font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
        selected
          ? "border-lead bg-lead text-white hover:bg-lead-mid"
          : partial
            ? "border-lead/50 bg-lead-wash text-lead"
            : "border-rule bg-white text-dim hover:border-lead/40 hover:text-ink"
      }`}
    >
      {selected ? (
        <Check aria-hidden="true" className="size-3" strokeWidth={2.8} />
      ) : partial ? (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-lead" />
      ) : (
        <Plus aria-hidden="true" className="size-3" strokeWidth={2.5} />
      )}
      {children}
      {count && (
        <span className={`tabular-nums ${selected ? "text-white/75" : "opacity-60"}`}>{count}</span>
      )}
    </button>
  );
}

/** A chosen value with a remove button, in the "Selected" tray. */
function RemovableChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white py-1 pr-1 pl-2.5 text-[12.5px] leading-none font-medium text-ink ring-1 ring-rule">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="cursor-pointer rounded-full p-0.5 text-faint transition-colors hover:bg-paper hover:text-ink focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none"
      >
        <X aria-hidden="true" className="size-3" strokeWidth={2.5} />
      </button>
    </span>
  );
}

function SubLabel({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-[12.5px] font-medium text-dim">{children}</p>;
}

function CheckTile({
  id,
  checked,
  onChange,
  label,
  description,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-inset border px-3.5 py-3 transition-colors ${
        checked ? "border-lead bg-lead-wash/50" : "border-rule bg-white hover:bg-paper/60"
      }`}
    >
      <FiledCheckbox
        id={id}
        checked={checked}
        onCheckedChange={(next) => onChange(next === true)}
        aria-describedby={description ? `${id}-description` : undefined}
        className="mt-0.5"
      />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer select-none">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        {description && (
          <span id={`${id}-description`} className="mt-0.5 block text-[13px] leading-[1.55] text-dim">
            {description}
          </span>
        )}
      </label>
    </div>
  );
}

/**
 * One rule in the editor: its name, what is chosen, and Edit / Done. Same row
 * as the import screen's `FilterSection`, but without its "Save" — nothing is
 * stored until the page's Save, so a row only opens and closes.
 */
function PreferenceSection({
  id,
  title,
  summary,
  hint,
  open,
  onToggle,
  children,
}: {
  id: SectionId;
  title: string;
  summary: string | null;
  hint: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section id={`section-${id}`} className="scroll-mt-6 border-t border-rule-soft first:border-t-0">
      <h3>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`section-${id}-panel`}
          className="group flex w-full cursor-pointer items-center gap-4 py-4 text-left focus-visible:outline-none"
        >
          <span className="shrink-0 font-body text-[19px] leading-[1.3] font-normal tracking-[-0.01em] text-ink">
            {title}
          </span>
          <span
            className={`min-w-0 flex-1 truncate text-[13.5px] ${summary ? "text-ink" : "text-faint"}`}
          >
            {summary ?? "Any"}
          </span>
          <span
            aria-hidden="true"
            className={`inline-flex shrink-0 items-center rounded-inset border px-2.5 py-1 text-[13px] font-medium transition-colors group-focus-visible:ring-2 group-focus-visible:ring-lead/30 ${
              open
                ? "border-lead bg-lead text-white group-hover:bg-lead-mid"
                : "border-rule bg-white text-lead group-hover:border-lead"
            }`}
          >
            {open ? "Done" : "Edit"}
          </span>
        </button>
      </h3>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`section-${id}-panel`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="pb-5">
              <p className="mb-4 text-[13px] leading-[1.55] text-dim">{hint}</p>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/**
 * Places, picked from the Charity Commission's local authorities the way the
 * import screen does it: a zone, whole regional groups, or a search over all
 * 174. Typing a free-text city is gone — a place that is a real authority name
 * is one the matcher can line up with (src/lib/place-name.ts).
 */
function PlacesPicker({
  values,
  onChange,
}: {
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [zone, setZone] = useState<RegionalZone>("All");
  const [search, setSearch] = useState("");
  const full = values.length >= MAX_CITIES;

  const toggle = (place: string) => {
    if (hasText(values, place)) onChange(values.filter((value) => !sameText(value, place)));
    else if (!full) onChange([...values, place]);
  };

  const toggleGroup = (group: RegionalGroup) => {
    const allChosen = group.authorities.every((authority) => hasText(values, authority));
    if (allChosen) {
      onChange(values.filter((value) => !group.authorities.some((a) => sameText(a, value))));
    } else {
      const missing = group.authorities.filter((authority) => !hasText(values, authority));
      onChange([...values, ...missing].slice(0, MAX_CITIES));
    }
  };

  const groups =
    zone === "All" ? UK_REGIONAL_GROUPS : UK_REGIONAL_GROUPS.filter((group) => group.zone === zone);

  const results = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle) {
      return ALL_LOCAL_AUTHORITIES.filter((authority) =>
        authority.toLowerCase().includes(needle),
      ).slice(0, 40);
    }
    if (zone !== "All") {
      return Array.from(
        new Set(
          UK_REGIONAL_GROUPS.filter((group) => group.zone === zone).flatMap(
            (group) => group.authorities,
          ),
        ),
      );
    }
    return [...SUGGESTED_LOCAL_AUTHORITIES];
  }, [search, zone]);

  // Places saved before this picker existed were typed by hand. They still
  // count and stay until removed; they just are not in the authority list.
  const typedByHand = values.filter((value) => !hasText(ALL_LOCAL_AUTHORITIES, value));

  return (
    <div>
      <SubLabel>Regional groups</SubLabel>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Region">
        {ZONES.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={zone === option}
            onClick={() => setZone(option)}
            className={`cursor-pointer rounded-full px-2.5 py-1 text-[12.5px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none ${
              zone === option ? "bg-ink text-white" : "bg-paper text-dim hover:bg-paper-sunk hover:text-ink"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {groups.map((group) => {
          const total = group.authorities.length;
          const chosen = group.authorities.filter((authority) => hasText(values, authority)).length;
          const all = total > 0 && chosen === total;
          return (
            <Chip
              key={group.id}
              selected={all}
              partial={chosen > 0 && !all}
              count={chosen > 0 && !all ? `${chosen}/${total}` : String(total)}
              onClick={() => toggleGroup(group)}
            >
              {group.name}
            </Chip>
          );
        })}
      </div>

      <div className="mt-5 border-t border-rule-soft pt-4">
        <SubLabel>Local councils{zone !== "All" && !search.trim() ? ` · ${zone}` : ""}</SubLabel>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint"
          />
          <label htmlFor="council-search" className="sr-only">
            Search local councils
          </label>
          <input
            id="council-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Search all ${ALL_LOCAL_AUTHORITIES.length} local councils`}
            className={`${SEARCH_INPUT} placeholder:text-faint`}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded-full p-0.5 text-faint hover:text-ink"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          )}
        </div>
        <div className="mt-2.5 flex min-h-8 flex-wrap gap-1.5" aria-live="polite">
          {results.map((authority) => {
            const selected = hasText(values, authority);
            return (
              <Chip
                key={authority}
                selected={selected}
                disabled={full && !selected}
                onClick={() => toggle(authority)}
              >
                {authority}
              </Chip>
            );
          })}
          {results.length === 0 && (
            <p className="text-[13px] text-faint">No council matches &ldquo;{search.trim()}&rdquo;.</p>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-inset bg-paper px-3.5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12.5px] font-medium text-dim">
            Selected · {values.length}
            {values.length > 0 ? (values.length === 1 ? " place" : " places") : ""}
          </p>
          {values.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="cursor-pointer text-[12.5px] font-medium text-dim hover:text-ink"
            >
              Clear all
            </button>
          )}
        </div>
        {values.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {values.map((value) => (
              <RemovableChip key={value} label={value} onRemove={() => toggle(value)} />
            ))}
          </div>
        ) : (
          <p className="mt-1 text-[13px] text-faint">None yet.</p>
        )}
        {typedByHand.length > 0 && (
          <p className="mt-2.5 text-[12.5px] leading-[1.55] text-dim">
            {typedByHand.join(", ")} {typedByHand.length === 1 ? "was" : "were"} typed in before
            councils could be picked. {typedByHand.length === 1 ? "It still counts" : "They still count"}{" "}
            until removed.
          </p>
        )}
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  onEdit,
  editLabel,
  children,
}: {
  label: string;
  onEdit: () => void;
  editLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 border-t border-rule-soft py-3.5">
      <dt className={`${FIELD_LABEL} w-full sm:w-44 sm:shrink-0`}>{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
      <button type="button" onClick={onEdit} className={`${ROW_ACTION} shrink-0`}>
        Edit<span className="sr-only"> {editLabel}</span>
      </button>
    </div>
  );
}

function ValueChips({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-sm text-faint">No preference</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="inline-flex items-center rounded-full bg-lead-wash px-2.5 py-1 text-[12.5px] leading-none font-medium text-lead"
        >
          {item}
        </span>
      ))}
    </span>
  );
}

// ─── The screen ──────────────────────────────────────────────────────────────

/**
 * Read-first: a summary where every rule has its own Edit. Edit opens the
 * editor — the import screen's stack of collapsible rules — with that rule
 * open and the rest closed; a generic entry opens "Where they work".
 *
 * Collapsed rules unmount their controls, so nothing is read from the DOM on
 * save: the form data is built from the draft (`toFormData`).
 *
 * What the screen says that it once did not: preferences reorder, never
 * filter; the second follow-up moves a silent client to No response
 * (sweep_no_response_status, 20260923090000); admins can see these (F187).
 */
export function OutreachPreferencesForm({ initial }: { initial: OutreachPreferences }) {
  const [state, setState] = useState<OutreachPreferencesState>({ status: "idle" });
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<OutreachPreferences>(initial);
  const [draft, setDraft] = useState<OutreachPreferences>(initial);
  const [open, setOpen] = useState<ReadonlySet<SectionId>>(() => new Set(["where"]));
  const [focusSection, setFocusSection] = useState<SectionId | null>(null);
  const editorRef = useRef<HTMLFormElement>(null);

  const update = (patch: Partial<OutreachPreferences>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const orderingError = validateFollowUpOrdering(draft.firstFollowUpDays, draft.secondFollowUpDays);
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const sizeSummary = describeIncomeRange(rangeOf(draft));

  // Bring the rule that was asked for into view, with focus on its header.
  useEffect(() => {
    if (!editing || !focusSection) return;
    const section = document.getElementById(`section-${focusSection}`);
    section?.scrollIntoView({ block: "start", behavior: "smooth" });
    section?.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus({ preventScroll: true });
  }, [editing, focusSection]);

  useEffect(() => {
    if (!editing || !changed) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [editing, changed]);

  function startEditing(section: SectionId = "where") {
    setDraft(saved);
    setState({ status: "idle" });
    setOpen(new Set([section]));
    setFocusSection(section);
    setEditing(true);
  }

  function cancel() {
    setDraft(saved);
    setState({ status: "idle" });
    setFocusSection(null);
    setEditing(false);
  }

  const toggleSection = (section: SectionId) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (orderingError) {
      setOpen((current) => new Set([...current, "followUp"]));
      setFocusSection("followUp");
      return;
    }
    const formData = toFormData(draft);
    startTransition(async () => {
      const result = await saveOutreachPreferencesAction(state, formData);
      setState(result);
      if (result.status !== "success") return;
      const stored = result.saved ?? draft;
      setSaved(stored);
      setDraft(stored);
      setFocusSection(null);
      setEditing(false);
    });
  }

  const whereLabels = (preferences: OutreachPreferences) => [
    ...preferences.geographicReach.map((value) => GEOGRAPHIC_REACH_LABELS[value]),
    ...preferences.cities,
  ];

  // ── Summary ──
  if (!editing) {
    const savedRange = describeIncomeRange(rangeOf(saved));
    return (
      <div className="space-y-4">
        <section aria-labelledby="queue-heading" className={CARD}>
          <h2 id="queue-heading" className={CARD_TITLE}>
            What your queue favours
          </h2>
          <p className={CARD_HINT}>
            Clients matching more of these rise to the top of your queue on Clients. Nothing is
            hidden — the rest follow in their usual order.
          </p>

          <dl className="mt-4">
            <SummaryRow label="Where they work" onEdit={() => startEditing("where")} editLabel="where they work">
              <ValueChips items={whereLabels(saved)} />
            </SummaryRow>
            <SummaryRow label="Sectors" onEdit={() => startEditing("sectors")} editLabel="sectors">
              <ValueChips items={saved.sectors} />
            </SummaryRow>
            <SummaryRow label="Size" onEdit={() => startEditing("size")} editLabel="size">
              <ValueChips items={savedRange ? [savedRange] : []} />
            </SummaryRow>
            <SummaryRow label="Grant history" onEdit={() => startEditing("grants")} editLabel="grant history">
              <ValueChips items={saved.prioritiseGrantRecipients ? ["Favour past grant recipients"] : []} />
            </SummaryRow>
          </dl>
        </section>

        <section aria-labelledby="follow-up-heading" className={CARD}>
          <h2 id="follow-up-heading" className={CARD_TITLE}>
            Follow-up timing
          </h2>
          <p className={CARD_HINT}>
            Counted from the last email, reply or status change on a client you own.
          </p>

          <dl className="mt-4">
            <SummaryRow label="First follow-up" onEdit={() => startEditing("followUp")} editLabel="first follow-up">
              <span className="text-sm text-ink">
                After <span className="font-semibold tabular-nums">{saved.firstFollowUpDays}</span> days
                of silence — a reminder, and it appears under Needs attention.
              </span>
            </SummaryRow>
            <SummaryRow label="Second follow-up" onEdit={() => startEditing("followUp")} editLabel="second follow-up">
              <span className="text-sm text-ink">
                After <span className="font-semibold tabular-nums">{saved.secondFollowUpDays}</span> days
                — a second reminder, and the client moves to{" "}
                <span className="font-semibold">No response</span>.
              </span>
            </SummaryRow>
          </dl>

          <div className="mt-4 border-t border-rule-soft pt-4">
            {state.status === "success" && state.message ? (
              <p aria-live="polite" className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-go">
                <Check aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.5} />
                {state.message}
              </p>
            ) : null}
            <p className={FOOTNOTE}>
              These only shape your own queue and reminders. Admins can see them when reviewing
              the team.
            </p>
          </div>
        </section>
      </div>
    );
  }

  // ── Editor ──
  const customSectors = draft.sectors.filter((sector) => !hasText(SECTOR_PRESETS, sector));

  return (
    <form
      ref={editorRef}
      onSubmit={handleSubmit}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !pending) {
          event.preventDefault();
          cancel();
        }
      }}
      noValidate
      className="space-y-4"
    >
      <section aria-labelledby="editor-heading" className="rounded-panel border border-rule bg-white px-5 sm:px-6">
        <h2 id="editor-heading" className="sr-only">
          Edit outreach preferences
        </h2>

        <PreferenceSection
          id="where"
          title="Where they work"
          summary={summarise(whereLabels(draft))}
          hint="Councils are matched against each client's town or city — Sheffield City covers clients recorded in Sheffield."
          open={open.has("where")}
          onToggle={() => toggleSection("where")}
        >
          <SubLabel>Scope</SubLabel>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {GEOGRAPHIC_REACH_OPTIONS.map((option) => (
              <CheckTile
                key={option}
                id={`geo-${option}`}
                checked={draft.geographicReach.includes(option)}
                onChange={(checked) =>
                  update({
                    geographicReach: checked
                      ? [...draft.geographicReach, option]
                      : draft.geographicReach.filter((value) => value !== option),
                  })
                }
                label={GEOGRAPHIC_REACH_LABELS[option]}
                description={REACH_DESCRIPTIONS[option]}
              />
            ))}
          </div>

          <div className="mt-5 border-t border-rule-soft pt-4">
            <PlacesPicker values={draft.cities} onChange={(cities) => update({ cities })} />
          </div>
        </PreferenceSection>

        <PreferenceSection
          id="sectors"
          title="Sectors"
          summary={summarise(draft.sectors)}
          hint="Each sector matches however a client's sector is worded, using the same sector groups as the filter on Clients."
          open={open.has("sectors")}
          onToggle={() => toggleSection("sectors")}
        >
          <div className="space-y-4">
            {SECTOR_CATEGORY_GROUPS.map((group) => (
              <div key={group.category}>
                <SubLabel>{group.category}</SubLabel>
                <div className="flex flex-wrap gap-1.5">
                  {group.presets.map((preset) => {
                    const selected = hasText(draft.sectors, preset);
                    return (
                      <Chip
                        key={preset}
                        selected={selected}
                        onClick={() =>
                          update({
                            sectors: selected
                              ? draft.sectors.filter((value) => !sameText(value, preset))
                              : [...draft.sectors, preset],
                          })
                        }
                      >
                        {preset}
                      </Chip>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {customSectors.length > 0 && (
            <div className="mt-4 rounded-inset bg-paper px-3.5 py-3">
              <p className="text-[12.5px] leading-[1.55] text-dim">
                Typed in before sectors became a fixed list. They still count until removed, but
                only match clients whose sector contains those exact words.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {customSectors.map((sector) => (
                  <RemovableChip
                    key={sector}
                    label={sector}
                    onRemove={() =>
                      update({ sectors: draft.sectors.filter((value) => !sameText(value, sector)) })
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </PreferenceSection>

        <PreferenceSection
          id="size"
          title="Size"
          summary={sizeSummary}
          hint="By annual income, from each client's latest accounts filed with the Charity Commission or Companies House. A client with no filed income counts as not matching."
          open={open.has("size")}
          onToggle={() => toggleSection("size")}
        >
          {/* The slider moves between relative stops (src/lib/income-range.ts):
              £5k steps at the bottom, £1m+ jumps at the top, each an equal step
              along the track. Values stay in pounds. */}
          <PriceRangeSlider
            className="px-0"
            histogramHeight="h-36 sm:h-40"
            data={INCOME_STOP_HISTOGRAM as number[]}
            min={0}
            max={INCOME_STOP_POSITIONS - 1}
            step={1}
            value={[positionForIncomeMin(draft.incomeMin), positionForIncomeMax(draft.incomeMax)]}
            onValueChange={([low, high]) =>
              update({
                incomeMin: incomeMinAtPosition(low),
                incomeMax: incomeMaxAtPosition(high),
              })
            }
            formatValue={incomeStopLabel}
            title={null}
            minLabel="From"
            maxLabel="Up to"
            minSubtitle={
              draft.incomeMin === null ? "£0 (no minimum)" : `From ${formatIncome(draft.incomeMin)}`
            }
            maxSubtitle={
              draft.incomeMax === null ? "Above £5m, no maximum" : `Up to ${formatIncome(draft.incomeMax)}`
            }
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-dim">
              {sizeSummary ? `Favouring clients with an income of ${sizeSummary}.` : "Every size — no preference."}
            </p>
            <button
              type="button"
              onClick={() => update({ incomeMin: null, incomeMax: null })}
              disabled={!sizeSummary}
              className={QUIET_BUTTON}
            >
              <RotateCcw aria-hidden="true" className="size-3.5" />
              Any size
            </button>
          </div>
        </PreferenceSection>

        <PreferenceSection
          id="grants"
          title="Grant history"
          summary={draft.prioritiseGrantRecipients ? "Favour past grant recipients" : null}
          hint="Grant awards published through 360Giving by UK funders and foundations."
          open={open.has("grants")}
          onToggle={() => toggleSection("grants")}
        >
          <fieldset className="m-0 grid min-w-0 grid-cols-1 gap-2.5 border-0 p-0 sm:grid-cols-2">
            <legend className="sr-only">Grant history</legend>
            {(
              [
                {
                  value: false,
                  label: "No preference",
                  description: "Grant history makes no difference to your queue.",
                },
                {
                  value: true,
                  label: "Favour past grant recipients",
                  description: "Clients with at least one recorded grant award rise up your queue.",
                },
              ] as const
            ).map((option) => {
              const active = draft.prioritiseGrantRecipients === option.value;
              return (
                <label
                  key={String(option.value)}
                  className="flex cursor-pointer flex-col rounded-inset border border-rule bg-white px-3.5 py-3 transition-colors hover:bg-paper/60 has-checked:border-lead has-checked:bg-lead-wash/50 has-focus-visible:ring-2 has-focus-visible:ring-lead/30"
                >
                  <input
                    type="radio"
                    name="grant_history_choice"
                    checked={active}
                    onChange={() => update({ prioritiseGrantRecipients: option.value })}
                    className="sr-only"
                  />
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-ink">{option.label}</span>
                    <span
                      aria-hidden="true"
                      className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
                        active ? "border-lead bg-lead text-white" : "border-rule bg-white"
                      }`}
                    >
                      {active && <Check className="size-2.5" strokeWidth={3} />}
                    </span>
                  </span>
                  <span className="mt-1 text-[13px] leading-[1.55] text-dim">{option.description}</span>
                </label>
              );
            })}
          </fieldset>
        </PreferenceSection>

        <PreferenceSection
          id="followUp"
          title="Follow-up timing"
          summary={`${draft.firstFollowUpDays} and ${draft.secondFollowUpDays} days`}
          hint="Days of silence on a client you own — counted from the last email, reply or status change."
          open={open.has("followUp")}
          onToggle={() => toggleSection("followUp")}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-inset border border-rule px-3.5 py-3">
              <label htmlFor="first_follow_up_days" className="text-sm font-semibold text-ink">
                First follow-up
              </label>
              <div className="mt-2 flex items-center gap-2">
                <input
                  id="first_follow_up_days"
                  type="number"
                  inputMode="numeric"
                  min={MIN_FOLLOW_UP_DAYS}
                  max={MAX_FIRST_FOLLOW_UP_DAYS}
                  value={draft.firstFollowUpDays}
                  onChange={(event) => update({ firstFollowUpDays: Number(event.target.value) })}
                  aria-describedby="first_follow_up_hint"
                  className={`${NUMBER_INPUT} tabular-nums`}
                />
                <span className="text-sm text-dim">days</span>
              </div>
              <p id="first_follow_up_hint" className="mt-2 text-[13px] leading-[1.55] text-dim">
                You get a reminder and the client appears under Needs attention.{" "}
                {MIN_FOLLOW_UP_DAYS}–{MAX_FIRST_FOLLOW_UP_DAYS} days.
              </p>
            </div>

            <div className="rounded-inset border border-rule px-3.5 py-3">
              <label htmlFor="second_follow_up_days" className="text-sm font-semibold text-ink">
                Second follow-up
              </label>
              <div className="mt-2 flex items-center gap-2">
                <input
                  id="second_follow_up_days"
                  type="number"
                  inputMode="numeric"
                  min={MIN_FOLLOW_UP_DAYS}
                  max={MAX_SECOND_FOLLOW_UP_DAYS}
                  value={draft.secondFollowUpDays}
                  onChange={(event) => update({ secondFollowUpDays: Number(event.target.value) })}
                  aria-invalid={orderingError ? true : undefined}
                  aria-describedby={`second_follow_up_hint${orderingError ? " second_follow_up_error" : ""}`}
                  className={`${NUMBER_INPUT} tabular-nums`}
                />
                <span className="text-sm text-dim">days</span>
              </div>
              <p id="second_follow_up_hint" className="mt-2 text-[13px] leading-[1.55] text-dim">
                A second reminder, and the client is moved to{" "}
                <span className="font-semibold text-ink">No response</span> automatically. Up to{" "}
                {MAX_SECOND_FOLLOW_UP_DAYS} days.
              </p>
            </div>
          </div>

          {orderingError && (
            <p id="second_follow_up_error" role="alert" className="mt-3 text-[13px] font-semibold text-stop">
              {orderingError}
            </p>
          )}

          <button
            type="button"
            onClick={() =>
              update({
                firstFollowUpDays: DEFAULT_FIRST_FOLLOW_UP_DAYS,
                secondFollowUpDays: DEFAULT_SECOND_FOLLOW_UP_DAYS,
              })
            }
            disabled={
              draft.firstFollowUpDays === DEFAULT_FIRST_FOLLOW_UP_DAYS &&
              draft.secondFollowUpDays === DEFAULT_SECOND_FOLLOW_UP_DAYS
            }
            className={`mt-3 -ml-2.5 ${QUIET_BUTTON}`}
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
            Reset to {DEFAULT_FIRST_FOLLOW_UP_DAYS} and {DEFAULT_SECOND_FOLLOW_UP_DAYS} days
          </button>
        </PreferenceSection>
      </section>

      <div className="sticky bottom-4 z-10 mx-auto flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-panel border border-rule bg-white px-4 py-3 sm:w-1/2">
        <p aria-live="polite" className="mr-auto flex items-center gap-2 text-[13px]">
          {state.status === "error" && state.message ? (
            <span className="font-semibold text-stop">{state.message}</span>
          ) : orderingError ? (
            <span className="font-semibold text-stop">Fix follow-up timing to save</span>
          ) : changed ? (
            <span className="flex items-center gap-2 text-ink">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-hold" />
              Unsaved changes
            </span>
          ) : (
            <span className="text-dim">No changes yet · Esc to cancel</span>
          )}
        </p>
        <button type="button" onClick={cancel} disabled={pending} className={QUIET_BUTTON}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || Boolean(orderingError) || !changed}
          aria-busy={pending || undefined}
          className={PRIMARY_BUTTON}
        >
          {pending && <Loader2 className="size-3.5 animate-spin" strokeWidth={2.2} />}
          {pending ? "Saving…" : "Save preferences"}
        </button>
      </div>
    </form>
  );
}
