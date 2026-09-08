"use client";

import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { ArrowRight, Check, ChevronLeft, History, Mail, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { EASE, stagger } from "@/components/brand/motion";
import { LIP, SEARCH_GLASS, SEARCH_GLASS_FROSTED, SEARCH_GLASS_FROSTED_LIGHT, SEARCH_GLASS_LIGHT, SEARCH_GLASS_OPEN, SEARCH_GLASS_OPEN_LIGHT } from "@/components/brand/tokens";
import { tagPillStyle } from "@/lib/tags/tag-colours";

/** Cycles behind the prompt while the field is empty and unfocused. */
const DEFAULT_SUBJECTS = ["Charities", "Companies", "Grants", "Clients"] as const;

const SUBJECT_HOLD = 2400;

/** Collapsed row height; also the pill's radius, so `rounded-full` and the open
 *  card's corner are the same number and the morph has nothing to interpolate. */
const ROW = 64;

const PANEL_STAGGER = stagger(0.05, 0.14);

const OPTION_LIST: Variants = { hidden: {}, show: {} };

/**
 * Motion inside the glass must never touch `filter` — not even `blur(0px)`.
 * Any non-none filter on a descendant of a `backdrop-filter` element poisons
 * the parent's backdrop sampling in Chrome and Safari (the child-filter
 * compositing bug): the frost reads for a second and then goes flat forever,
 * exactly what the lingering `blur(0px)` from the old blur-up rows did. So
 * everything in here rises on opacity and y only. The house blur-up entrance
 * stays everywhere outside the glass.
 */
const GLASS_ITEM: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
};

const glassItemIndexed = (step = 0.025, cap = 0.3): Variants => ({
  hidden: { opacity: 0, y: 8 },
  show: (index: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: EASE, delay: Math.min(index * step, cap) },
  }),
});

const GLASS_OPTIONS = glassItemIndexed(0.025, 0.3);

/**
 * Which surface the bar sits on. Dark is the brand glass (the default —
 * every existing host renders byte-identical output). Light wears the Gmail
 * pill shade for hosts on a light surface. Lime accents stay lime in both:
 * the disc, badges and selected states are the brand moment, and lime reads
 * on light too — only running text and focus rings move to slate/lime-600 so
 * they stay legible.
 */
export type SearchBarTone = "dark" | "light";

const SEARCH_BAR_TONES: Record<
  SearchBarTone,
  {
    glassClosed: string;
    glassOpen: string;
    glassFrosted: string;
    rim: string;
    innerRow: string;
    ink: string;
    bright: string;
    muted: string;
    muted60: string;
    muted50: string;
    faint: string;
    faintPlaceholder: string;
    hoverRow: string;
    hoverRowSoft: string;
    hoverBright: string;
    hoverInk: string;
    toggle: string;
    outline: string;
    ringFocus: string;
    ringVisibleFocus: string;
    caret: string;
    fieldBg: string;
    fieldRing: string;
    fieldScheme: string;
    selected: string;
    selectedBtn: string;
    accentText: string;
    divider: string;
    well: string;
    disc: string;
    discHover: string;
    /** Rolling-square spinner: fill + glow. Lime on dark glass, lead on light. */
    spinner: string;
  }
> = {
  dark: {
    glassClosed: SEARCH_GLASS,
    glassOpen: SEARCH_GLASS_OPEN,
    glassFrosted: SEARCH_GLASS_FROSTED,
    rim: "ring-white/25",
    innerRow: "bg-black/20",
    ink: "text-[#f4f4ef]",
    bright: "text-white",
    muted: "text-[#f4f4ef]/55",
    muted60: "text-[#f4f4ef]/60",
    muted50: "text-[#f4f4ef]/50",
    faint: "text-[#f4f4ef]/70",
    faintPlaceholder: "placeholder:text-[#f4f4ef]/40",
    hoverRow: "hover:bg-white/10",
    hoverRowSoft: "hover:bg-white/8",
    hoverBright: "hover:text-white",
    hoverInk: "hover:text-[#f4f4ef]",
    toggle: "bg-white/12 text-[#f4f4ef] hover:bg-white/20",
    outline: "focus-visible:outline-[#e6f5c0]",
    ringFocus: "focus:ring-[#e6f5c0]",
    ringVisibleFocus: "focus-visible:ring-[#e6f5c0]",
    caret: "caret-[#e6f5c0]",
    fieldBg: "bg-white/10",
    fieldRing: "ring-white/15",
    fieldScheme: "[color-scheme:dark]",
    selected: "bg-white/15 text-[#e6f5c0]",
    selectedBtn: "bg-white/20 text-[#e6f5c0] ring-1 ring-[#e6f5c0]/50",
    accentText: "text-[#e6f5c0]",
    divider: "border-white/10",
    well: "bg-black/25",
    disc: "bg-[#e6f5c0] text-[#1a1a1a]",
    discHover: "hover:bg-[#d4e5a0]",
    spinner: "bg-[#e6f5c0] shadow-[0_0_10px_#e6f5c0]",
  },
  light: {
    glassClosed: SEARCH_GLASS_LIGHT,
    glassOpen: SEARCH_GLASS_OPEN_LIGHT,
    glassFrosted: SEARCH_GLASS_FROSTED_LIGHT,
    rim: "ring-transparent",
    innerRow: "bg-[#d8e1ef]",
    ink: "text-slate-900",
    bright: "text-slate-900",
    muted: "text-slate-500",
    muted60: "text-slate-500",
    muted50: "text-slate-500",
    faint: "text-slate-600",
    faintPlaceholder: "placeholder:text-slate-400",
    hoverRow: "hover:bg-slate-900/5",
    hoverRowSoft: "hover:bg-slate-900/5",
    hoverBright: "hover:text-slate-900",
    hoverInk: "hover:text-slate-900",
    toggle: "bg-slate-900/8 text-slate-700 hover:bg-slate-900/12",
    outline: "focus-visible:outline-lime-600",
    ringFocus: "focus:ring-lime-600",
    ringVisibleFocus: "focus-visible:ring-lime-600",
    caret: "caret-lime-600",
    fieldBg: "bg-slate-900/5",
    fieldRing: "ring-slate-900/15",
    fieldScheme: "[color-scheme:light]",
    selected: "bg-lime-100 text-lime-800",
    selectedBtn: "bg-lime-100 text-lime-800 ring-1 ring-lime-600/40",
    accentText: "text-lime-800",
    divider: "border-slate-900/10",
    well: "bg-slate-900/5",
    disc: "bg-lead text-white",
    discHover: "hover:bg-[#1b3160]",
    spinner: "bg-lead shadow-[0_0_10px_var(--lead)]",
  },
};

function rankOption(label: string, query: string): number {
  const l = label.toLowerCase();
  if (l.startsWith(query)) return 0;
  if (l.includes(` ${query}`)) return 1;
  return l.includes(query) ? 2 : -1;
}

/**
 * F194 — `colour` is optional so only tag options carry it. In the dark glass
 * panel a colour renders as a swatch dot (the palette's text hues are tuned
 * for light surfaces, so tinting text here would be unreadable); on the light
 * chip row below the bar the full pill tint is used instead.
 */
export type FilterOption = { label: string; value: string; colour?: string };

/**
 * One row in the as-you-type suggestions dropdown (opt-in via `suggestions`).
 * The bar bolds the query's match inside `title` itself, so hosts pass plain
 * strings. `subtitle` and `meta` render as the second line and the trailing
 * detail, Gmail-style.
 */
export type SearchSuggestion = {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
};

const RECENT_STORAGE_PREFIX = "brand-search-recent:";

function readRecents(key: string): string[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(`${RECENT_STORAGE_PREFIX}${key}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    // Read lazily on focus (never during render) so server and client agree.
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string").slice(0, 5)
      : [];
  } catch {
    return [];
  }
}

function saveRecent(key: string | undefined, rawQuery: string): void {
  const query = rawQuery.trim();
  if (!key || !query || typeof window === "undefined") return;
  try {
    const next = [query, ...readRecents(key).filter(
      (entry) => entry.toLowerCase() !== query.toLowerCase(),
    )].slice(0, 5);
    window.localStorage.setItem(`${RECENT_STORAGE_PREFIX}${key}`, JSON.stringify(next));
  } catch {
    // Private mode and friends: recents just don't persist.
  }
}

/** Bolds the query's first match inside a suggestion title. Plain strings in,
 *  highlighted output out — the host never formats. */
function BoldMatch({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;
  const index = text.toLowerCase().indexOf(q);
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <strong className="font-extrabold">{text.slice(index, index + q.length)}</strong>
      {text.slice(index + q.length)}
    </>
  );
}

/**
 * A single row in the open panel, for placements that offer actions rather
 * than filters. Tapping a row with `expandedContent` swaps the button for
 * that content in place (a transform, not an accordion) — the content should
 * provide its own dismiss via the `collapse` control it receives, since no
 * external close button is rendered beside it.
 */
export type PanelRow = {
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  expandedContent?:
    | React.ReactNode
    | ((controls: { collapse: () => void }) => React.ReactNode);
  /**
   * Render the content directly with no button state — for fields that wear
   * their own button face (the gooey capsule's resting label) and need no
   * transform to become one.
   */
  alwaysExpanded?: boolean;
  onSelect?: () => void;
};

/**
 * Demo content, used only when a host page passes no `categories`. The matching
 * `DEFAULT_PARAMS` below keeps the two halves of that fallback in one place —
 * a category with no query parameter silently searches for nothing.
 */
const DEFAULT_CATEGORIES: Record<string, FilterOption[]> = {
  "Filter by city": ["London", "Manchester", "Birmingham", "Edinburgh", "Glasgow"].map((c) => ({ label: c, value: c })),
  "Filter by outreach status": ["Contacted", "Meeting set", "Proposal sent", "Closed won", "Closed lost"].map((c) => ({ label: c, value: c })),
  "Filter by owner": ["Bashir Bobboi", "Alice Smith", "Bob Jones", "Charlie Brown"].map((c) => ({ label: c, value: c })),
  "Filter by source": ["Companies House", "Charity Commission", "360Giving"].map((c) => ({ label: c, value: c })),
};

const DEFAULT_PARAMS: Record<string, string> = {
  "Filter by city": "city",
  "Filter by outreach status": "status",
  "Filter by owner": "owner",
  "Filter by source": "source",
};

/**
 * The host's status lines, cycling where the prompt normally sits. Its own
 * component so a run's first line is guaranteed by mounting rather than by an
 * effect that resets an index — and so reduced motion is handled in one place:
 * it holds the first line instead of swapping under someone who asked for
 * stillness.
 */
function StatusLine({ messages, tone = "dark" }: { messages: readonly string[]; tone?: SearchBarTone }) {
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reducedMotion || messages.length < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % messages.length), 3200);
    return () => clearInterval(id);
  }, [reducedMotion, messages.length]);

  const message = messages[index % messages.length];

  return (
    <span
      aria-live="polite"
      className="font-body flex min-w-0 items-center text-[15px] sm:text-base"
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={message}
          className={`truncate ${SEARCH_BAR_TONES[tone].ink}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.3, ease: EASE }}
        >
          {message}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function BrandSearchBar({
  className = "",
  tone = "dark",
  placeholder = "I want to learn about",
  subjects = DEFAULT_SUBJECTS,
  categories,
  params: paramNames,
   defaultQuery = "",
   defaultFilters = [],
   startOpen = false,
   frosted = false,
   clearRowOnOpen = false,
   promptButton = false,
   panelRows,
   compactRest = false,
   anchorLeft = false,
   chipsBelow = true,
   onSubmit,
   submitLabel = "Submit",
   onQueryChange,
   suggestions,
   onSuggestionSelect,
   onSubmitQuery,
   recentKey,
   busy = false,
   openSignal,
   confirmSignal,
   confirm,
   submitting = false,
   submittingMessages,
}: {
  className?: string;
  /** Light wears the Gmail pill shade for hosts on a light surface. Dark
   *  (default) is the brand glass — existing hosts are unaffected. */
  tone?: SearchBarTone;
  placeholder?: string;
  /** Words that cycle behind the prompt. Name what *this* page holds. */
  subjects?: readonly string[];
  categories?: Record<string, FilterOption[]>;
  /**
   * Category label → the query parameter its choice writes. Required alongside
   * `categories`: which URL a filter lands on is the host page's business, not
   * this component's, and hard-coding one page's parameter names here is what
   * stopped a second page from reusing the bar.
   */
   params?: Record<string, string>;
   defaultQuery?: string;
   defaultFilters?: (FilterOption & { category: string })[];
   /**
    * Open on mount. For hosts that remount the bar around an async job:
    * remounting with a failure already set reopens straight onto it instead
    * of hiding it behind a closed pill.
    */
   startOpen?: boolean;
   /**
    * Reactive open signal: whenever this value changes (after mount), the
    * panel opens. For failures that land while the panel is closed — the
    * error row is inside, so an invisible error is no error at all.
    */
   openSignal?: unknown;
   /**
    * Reactive confirm signal: whenever this value changes (after mount), the
    * panel opens straight onto the confirmation sheet. For hosts that need to
    * put the CAM back at the last step *before* the run — a retry after a
    * failure returns to "confirm or go back and edit", never straight into a
    * second paid call. Ignored when `confirm` is not set.
    */
   confirmSignal?: unknown;
   /**
    * Stronger frost on the glass (20px backdrop blur under a 0.5 tint instead
    * of 3px under 0.72), so the page behind an open panel reads as blurred
    * texture. Opt-in per instance — the clients-list bar keeps its look.
    */
   frosted?: boolean;
   /**
    * Let the prompt row take the open glass colour while the panel is out,
    * instead of holding its fixed `innerRow` shade. For hosts where the whole
    * open pill should read as one surface (the inbox search: top row goes
    * white with the panel). Off by default — the booklet composer keeps its
    * pinned top row.
    */
   clearRowOnOpen?: boolean;
   /**
    * Render the prompt row as a button that opens the panel instead of a
    * text input — for placements where the bar triggers options rather than
    * taking a query. The cycling subjects stay exactly as they are.
    */
   promptButton?: boolean;
   /**
    * Replace the filter categories (and their drill-down) with plain rows.
    * For placements like the booklet composer, whose panel offers actions
    * rather than filters.
    */
   panelRows?: PanelRow[];
   /**
    * Rest compact: the closed pill shrinks to its content instead of spanning
    * full width, then widens back on open before the panel unfolds — the
    * widen-then-drop two-beat. The widest cycling subject reserves the rest
    * width, so word swaps never resize the pill. Opt-in per instance.
    */
   compactRest?: boolean;
   /**
    * Anchor the pill to the left edge instead of centring it, so the
    * compact-rest widen grows rightward only before the panel drops down.
    * Inert without `compactRest`: a full-width pill is the same box centred
    * or left-anchored. Opt-in per instance.
    */
   anchorLeft?: boolean;
   /**
    * Show the selected-filter chips in a row under the pill. Hosts in a fixed
    * toolbar (whose height must never shift) set this false: their active
    * filters still surface at the bottom of the open dropdown instead.
    */
   chipsBelow?: boolean;
   /**
    * Primary go action for the panel, rendered as the lime arrow disc beside
    * the open/close toggle — the search bar's own submit button, copied. Only
    * rendered when provided.
    */
    onSubmit?: () => void;
    /** Accessible label for the submit disc. */
    submitLabel?: string;
    /**
     * Called with the query on every keystroke (the bar keeps owning the
     * field). Hosts use it to compute `suggestions` — without it there is
     * nothing to suggest from and the dropdown stays shut.
     */
    onQueryChange?: (query: string) => void;
    /**
     * As-you-type suggestions for the current query, Gmail-style. Rendered as
     * a dropdown whenever the field is focused, non-empty, and the filter
     * panel is closed. Omit entirely and the bar behaves exactly as before.
     */
    suggestions?: SearchSuggestion[];
    /** A suggestion row was chosen (click or Enter on highlight): open it. */
    onSuggestionSelect?: (id: string) => void;
    /**
     * Replaces the URL navigation on submit. Hosts that filter locally (no
     * route to drive) take the query and filters here instead; the rolling
     * square still plays its minimum beat first, exactly like a remote call.
     */
    onSubmitQuery?: (query: string, filters: (FilterOption & { category: string })[]) => void;
    /**
     * Enables recent searches: submitted queries persist under this key and
     * resurface when the empty field is focused. One key per placement so
     * hosts never read each other's history.
     */
    recentKey?: string;
    /**
     * The host's own work is running (a label filter resolving, a slow fetch).
     * The lime disc appears and wears the rolling square for as long as it is
     * true — the same signal as a submit, driven externally.
     */
    busy?: boolean;
   /**
    * Turns the submit disc into a two-step: the first click collapses the bar
    * and floats this under it, and `onSubmit` runs only once the CAM confirms.
    * For placements where submitting spends real money (a Gemini generation),
    * an arrow that fires on one stray click is the wrong shape.
    *
    * `details` is the "confirm your details" half — the host lists what the run
    * will actually use, so the choices made up in the panel are re-read at the
    * moment they take effect rather than remembered.
    */
   confirm?: {
     title: string;
     description?: string;
     details?: { label: string; value: string }[];
     confirmLabel?: string;
     cancelLabel?: string;
   };
    /**
     * The host's own work is running. The bar wears it: the disc becomes the
     * rolling square, and `submittingMessages` cycles where the prompt sits, so
     * a generation never has to be reported by a second block of UI somewhere
     * below the bar that started it. Omit the messages and the row stays
     * blank behind the spinner instead.
     */
   submitting?: boolean;
   submittingMessages?: readonly string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  // StrictMode-safe: a first-render guard ref would be consumed by the
  // double-invoked mount effect in dev and then open the panel for real on
  // the second pass. Comparing values instead only ever opens on a genuine
  // bump from the host.
  // Adjusted during render rather than in an effect: React re-runs this pass
  // before committing, so the panel is already open on the frame the bump
  // lands — no flash of the closed pill, and no cascading-render lint error.
  const [seenOpenSignal, setSeenOpenSignal] = useState(openSignal);
  if (seenOpenSignal !== openSignal) {
    setSeenOpenSignal(openSignal);
    if (openSignal) setOpen(true);
  }
  const [query, setQuery] = useState(defaultQuery);
  const [subject, setSubject] = useState(0);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedFilters, setSelectedFilters] = useState<(FilterOption & { category: string })[]>(defaultFilters);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [isSearching, setIsSearching] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  /**
   * `compactRest` morphs between two boxes whose sizes are known, so both ends
   * of the widen are measured pixels. Keyword ends (`fit-content` → `100%`)
   * cannot be tweened directly: Motion resolves them on the frame the
   * animation starts, which is the frame the panel mounts — and the panel's
   * own content is what `fit-content` then measures. The widen therefore began
   * at almost its end value and read as a snap, with the delayed height drop
   * arriving as a second one. Two numbers make it one continuous tween.
   *
   * Measured in pixels once on mount. The frame's inline width is only there
   * if the consumer passed one — most hosts let the flex row decide it.
   */
  const [restWidth, setRestWidth] = useState<number | null>(null);
  const [fullWidth, setFullWidth] = useState<number | null>(null);

  // The confirmation is a panel state, not a popover: it opens the bar and
  // takes over the drawer the rows live in, so everything this component does
  // happens inside one box.
  const [confirming, setConfirming] = useState(false);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  // Same render-phase adjustment as openSignal above.
  const [seenConfirmSignal, setSeenConfirmSignal] = useState(confirmSignal);
  if (seenConfirmSignal !== confirmSignal) {
    setSeenConfirmSignal(confirmSignal);
    if (confirmSignal && confirm) {
      setOpen(true);
      setConfirming(true);
    }
  }

  // The frame keeps its full width whether or not the bar is open, so it is
  // the one thing that can be observed for the open end (and for a resize).
  useEffect(() => {
    const frame = frameRef.current;
    if (!compactRest || !frame) return;
    const observer = new ResizeObserver(([entry]) => {
      setFullWidth(entry.contentRect.width);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [compactRest]);

  // The resting end has to be read while the bar is closed AND unlocked —
  // hence the null pass before each read, which lets `fit-content` resolve
  // fresh. Re-read once fonts settle: the resting pill is sized by its own
  // label, so a swapped face changes it.
  useEffect(() => {
    if (!compactRest) return;
    let raf = 0;
    const measure = () => {
      setRestWidth(null);
      raf = requestAnimationFrame(() => {
        if (rootRef.current) setRestWidth(rootRef.current.offsetWidth);
      });
    };
    measure();
    let cancelled = false;
    document.fonts?.ready.then(() => {
      // Closed is read off the box itself rather than off `open`: this fires on
      // the font loader's schedule, and re-measuring an open bar would unlock
      // its width mid-panel.
      if (cancelled || cardRef.current?.offsetHeight !== ROW) return;
      measure();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [compactRest]);


  // Confirm is the drawer's whole content while it is up, so it takes the
  // focus the drawer would otherwise hand to its rows. Without preventScroll
  // the browser yanks the page to the button mid-morph — the widen, the drop
  // and a scroll jump landing together is what reads as a broken animation.
  useEffect(() => {
    if (!confirming) return;
    confirmButtonRef.current?.focus({ preventScroll: true });
  }, [confirming]);

  const typing = query.length > 0;

  const statusMessages =
    submitting && submittingMessages?.length ? submittingMessages : null;

  // The subject only cycles while there is nothing else in the row to read —
  // except in prompt-button mode, where the cycling words ARE the button's
  // label and must keep turning even with the panel open.
  useEffect(() => {
    if (typing) return;
    if (open && !promptButton) return;
    const id = setInterval(
      () => setSubject((i) => (i + 1) % subjects.length),
      SUBJECT_HOLD,
    );
    return () => clearInterval(id);
  }, [open, typing, promptButton, subjects.length]);

  // Pointerdown, not click: a click that starts inside and ends outside (a drag
  // over the results) would otherwise close the panel out from under the cursor.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      setConfirming(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Memoised so the options memo below doesn't re-run on every render — a
  // fresh object literal here would defeat it.
  const FILTER_CATEGORIES: Record<string, FilterOption[]> = useMemo(() => categories || DEFAULT_CATEGORIES, [categories]);
  const FILTER_PARAMS: Record<string, string> = useMemo(() => paramNames || DEFAULT_PARAMS, [paramNames]);

  const [datePickerMode, setDatePickerMode] = useState<"day" | "range" | "presets">("day");
  const [customSingleDate, setCustomSingleDate] = useState<string>("");
  const [customRangeFrom, setCustomRangeFrom] = useState<string>("");
  const [customRangeTo, setCustomRangeTo] = useState<string>("");

  const isDateCategory = useMemo(() => {
    if (!activeFilter) return false;
    const paramKey = FILTER_PARAMS[activeFilter] ?? "";
    return paramKey === "date" || activeFilter.toLowerCase().includes("date");
  }, [activeFilter, FILTER_PARAMS]);

  const [prevDateCategoryFilter, setPrevDateCategoryFilter] = useState<string | null>(null);
  if (prevDateCategoryFilter !== activeFilter) {
    setPrevDateCategoryFilter(activeFilter);
    if (activeFilter && isDateCategory) {
      const current = selectedFilters.find((f) => f.category === activeFilter);
      if (current?.value) {
        if (current.value.includes("..")) {
          const [from, to] = current.value.split("..");
          setCustomRangeFrom(from);
          setCustomRangeTo(to);
          setDatePickerMode("range");
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(current.value)) {
          setCustomSingleDate(current.value);
          setDatePickerMode("day");
        } else {
          setDatePickerMode("presets");
        }
      }
    }
  }

  const formatShortDateDisplay = (iso: string): string => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      const [y, m, d] = iso.split("-").map(Number);
      return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    }
    return iso;
  };

  const applySingleDate = (dateVal: string) => {
    if (!dateVal || !activeFilter) return;
    const isSelected = selectedFilters.some(
      (f) => f.category === activeFilter && f.value === dateVal
    );
    if (isSelected) {
      setSelectedFilters((prev) =>
        prev.filter((f) => !(f.category === activeFilter && f.value === dateVal))
      );
    } else {
      const label = formatShortDateDisplay(dateVal);
      setSelectedFilters((prev) => [
        ...prev.filter((f) => f.category !== activeFilter),
        { category: activeFilter, label, value: dateVal },
      ]);
    }
  };

  const applyDateRange = (fromVal: string, toVal: string) => {
    if (!fromVal || !toVal || !activeFilter) return;
    const from = fromVal <= toVal ? fromVal : toVal;
    const to = fromVal <= toVal ? toVal : fromVal;
    const rangeVal = `${from}..${to}`;
    const isSelected = selectedFilters.some(
      (f) => f.category === activeFilter && f.value === rangeVal
    );
    if (isSelected) {
      setSelectedFilters((prev) =>
        prev.filter((f) => !(f.category === activeFilter && f.value === rangeVal))
      );
    } else {
      const label = `${formatShortDateDisplay(from)} – ${formatShortDateDisplay(to)}`;
      setSelectedFilters((prev) => [
        ...prev.filter((f) => f.category !== activeFilter),
        { category: activeFilter, label, value: rangeVal },
      ]);
    }
  };

  const applyDatePreset = (option: FilterOption) => {
    if (!activeFilter) return;
    const isSelected = selectedFilters.some(
      (f) => f.category === activeFilter && f.value === option.value
    );
    if (isSelected) {
      setSelectedFilters((prev) =>
        prev.filter((f) => !(f.category === activeFilter && f.value === option.value))
      );
    } else {
      setSelectedFilters((prev) => [
        ...prev.filter((f) => f.category !== activeFilter),
        { category: activeFilter, label: option.label, value: option.value },
      ]);
    }
  };

  // A host that filters locally takes the submission here instead of the
  // URL navigation below. The answer is instant, but the submit still wears
  // the rolling square for a beat first — a search that resolves in zero
  // frames reads as broken, so the spinner gets a guaranteed minimum run.
  const LOCAL_SUBMIT_SPIN_MS = 2000;

  const submitSearch = (filters = selectedFilters, q = query, closePanel = true) => {
    if (isSearching || busy) return;

    if (closePanel) {
      setOpen(false);
    }
    setFocused(false);

    // A host that filters locally takes the submission here instead of the
    // URL navigation below.
    if (onSubmitQuery) {
      if (q.trim()) saveRecent(recentKey, q);
      inputRef.current?.blur();
      setIsSearching(true);
      setTimeout(() => {
        startTransition(() => {
          onSubmitQuery(q, filters);
        });
        setTimeout(() => {
          setIsSearching(false);
        }, 400);
      }, LOCAL_SUBMIT_SPIN_MS);
      return;
    }

    setIsSearching(true);

    const params = new URLSearchParams(window.location.search);
    params.delete("q");
    params.delete("page");
    Object.values(FILTER_PARAMS).forEach((name) => params.delete(name));

    if (q) params.set("q", q);

    // `append`, not `set`: the panel already lets several options be chosen in
    // one category, but `set` overwrote each with the next, so only the last
    // survived the trip through the URL and multi-select silently behaved like
    // single-select. Repeating the parameter is what the host page reads back
    // as an array.
    filters.forEach((f) => {
      params.append(FILTER_PARAMS[f.category] ?? "filter", f.value);
    });

    // Plays the rolling square animation before navigating (dev's designed
    // submit moment). Still a soft navigation — router.replace, no document
    // reload — so F052's AC4 holds; the spinner doubles as the double-submit
    // guard via `isSearching`.
    setTimeout(() => {
      startTransition(() => {
        router.replace(`?${params.toString()}`, { scroll: false });
      });
      setTimeout(() => {
        setIsSearching(false);
      }, 400);
    }, 1500);

    if (closePanel) {
      setOpen(false);
    }
  };

  // Removing a chip only stages the removal — nothing executes until the
  // search button or Enter is pressed (the documented contract above the
  // search execution note in design-system.md). Used by the in-dropdown chips;
  // the under-pill row below does the same inline.
  const removeFilter = (category: string, value: string) => {
    setSelectedFilters((prev) =>
      prev.filter((filter) => !(filter.value === value && filter.category === category)),
    );
  };

  const close = () => {
    setOpen(false);
    setConfirming(false);
    setTimeout(() => {
      setActiveFilter(null);
      setFilterQuery("");
      setExpandedRow(null);
    }, 300);
  };

  const dismissSuggest = () => {
    setHighlight(-1);
    setFocused(false);
    inputRef.current?.blur();
  };

  const activateRow = (row: ActiveRow) => {
    if (row.kind === "suggestion") {
      onSuggestionSelect?.(row.item.id);
      dismissSuggest();
      return;
    }
    setQuery(row.query);
    onQueryChange?.(row.query);
    submitSearch(selectedFilters, row.query);
  };

  const handleEnter = () => {
    if (showSuggestions || showRecents) {
      if (highlight >= 0 && highlight < activeRows.length) {
        activateRow(activeRows[highlight]);
        return;
      }
      if (showSuggestions) {
        submitSearch();
        inputRef.current?.blur();
        return;
      }
      return;
    }
    submitSearch();
    inputRef.current?.blur();
  };

  const trimmedFilterQuery = filterQuery.trim();

  const T = SEARCH_BAR_TONES[tone];

  // As-you-type suggestions live here, not in `open`: typing shows matches,
  // the sliders toggle shows filters, and the two never fight. Everything
  // below is inert unless the host passes `suggestions` (and `recentKey` for
  // recents) — existing hosts render exactly as before.
  const suggestId = useId();
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [recents, setRecents] = useState<string[]>([]);
  const suggestMode = !promptButton && suggestions !== undefined && !open;
  const showSuggestions = suggestMode && typing && focused;
  const showRecents =
    suggestMode && !typing && focused && recentKey !== undefined && recents.length > 0;
  const panelOut = open || showSuggestions || showRecents;

  type ActiveRow =
    | { kind: "suggestion"; item: SearchSuggestion }
    | { kind: "recent"; query: string };
  const activeRows: ActiveRow[] =
    showSuggestions && suggestions
      ? suggestions.map((item) => ({ kind: "suggestion" as const, item }))
      : showRecents
        ? recents.map((recent) => ({ kind: "recent" as const, query: recent }))
        : [];

  useEffect(() => {
    setHighlight(-1);
  }, [query, suggestions, open]);

  const activeOptions = useMemo(() => {
    if (!activeFilter) return [];
    const all = FILTER_CATEGORIES[activeFilter] ?? [];
    const q = trimmedFilterQuery.toLowerCase();
    if (!q) return all;

    // Decorate-sort-undecorate: the source index is the tie-break, so equally
    // ranked options keep the order the host page gave them.
    return all
      .map((option, index) => ({ option, index, rank: rankOption(option.label, q) }))
      .filter((entry) => entry.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map((entry) => entry.option);
  }, [activeFilter, trimmedFilterQuery, FILTER_CATEGORIES]);

  return (
    <div className={`flex w-full max-w-[600px] flex-col gap-3 ${className}`}>
      <div ref={frameRef} className="relative h-[64px] w-full z-50">
        <motion.div
          ref={rootRef}
          className={`absolute top-0 ${anchorLeft ? "left-0" : "left-1/2"} w-full flex flex-col pointer-events-auto`}
          style={{
            ...(anchorLeft ? {} : { x: "-50%" }),
          }}
          animate={{
            width: compactRest
              ? open
                ? (fullWidth ?? "100%")
                : (restWidth ?? "fit-content")
              : "100%",
          }}
          initial={false}
          transition={
            compactRest
              ? {
                  width: { duration: 0.42, ease: EASE, delay: open ? 0 : 0.42 },
                }
              : { duration: 0.7, ease: EASE }
          }
          onKeyDown={(e) => {
            if (e.key === "Escape" && (showSuggestions || showRecents)) {
              e.stopPropagation();
              dismissSuggest();
            } else if (
              (e.key === "ArrowDown" || e.key === "ArrowUp") &&
              (showSuggestions || showRecents) &&
              activeRows.length > 0
            ) {
              e.preventDefault();
              e.stopPropagation();
              setHighlight((current) =>
                e.key === "ArrowDown"
                  ? (current + 1) % activeRows.length
                  : (current - 1 + activeRows.length) % activeRows.length,
              );
            } else if (e.key === "Escape" && confirming) {
              e.stopPropagation();
              setConfirming(false);
            } else if (e.key === "Escape" && open) {
              e.stopPropagation();
              close();
              inputRef.current?.blur();
            } else if (e.key === "Enter") {
              e.preventDefault();
              handleEnter();
            }
          }}
        >
          {/* Card containing Search Row + Panels (Ends at "All results for...") */}
          <motion.div
            ref={cardRef}
            className={`w-full overflow-hidden relative ${frosted ? "backdrop-blur-[20px]" : "backdrop-blur-[3px]"}`}
            style={{
              boxShadow: LIP,
              borderRadius: ROW / 2,
            }}
            animate={{
              height: panelOut ? "auto" : ROW,
              // Pixels at both ends once measured (see restWidth/fullWidth), so
              // the widen is a pure number tween with nothing to resolve on the
              // frame it starts. The keyword pair is only the pre-measure
              // fallback for the first frame.
              backgroundColor: panelOut
                ? frosted
                  ? T.glassFrosted
                  : T.glassOpen
                : T.glassClosed,
            }}
            initial={false}
            transition={
              compactRest
                ? {
                    height: { duration: 0.42, ease: EASE, delay: open ? 0.42 : 0 },
                    backgroundColor: { duration: 0.7, ease: EASE },
                  }
                : { duration: 0.7, ease: EASE }
            }
          >
          {/* The frost lives on its own childless layer, never on the container
              that holds the panel. `backdrop-filter` is defeated by any `filter`
              anywhere in its own subtree — a promoted `will-change: filter` layer
              is enough — and the panel's content is full of them (liquid-gooey
              paints its capsule through an SVG drop-shadow filter, and Motion's
              blur-up variants settle at a lingering `blur(0px)`). Sharing one
              element made the frost read for a second or two and then go flat for
              the rest of the session, once the compositor promoted whichever
              filtered descendant painted last. A leaf can never be poisoned: it
              has no descendants. It samples the page *and* the container's own
              tint painted beneath it, which is flat, so the look is unchanged. */}
          <div
            className={`pointer-events-none absolute inset-0 z-0 rounded-[inherit] ${frosted ? "backdrop-blur-[20px]" : "backdrop-blur-[3px]"}`}
            aria-hidden="true"
          />

          <div
            className={`pointer-events-none absolute inset-0 z-30 rounded-[inherit] ring-1 ${T.rim} ring-inset`}
            aria-hidden="true"
          />

      {/* Lifts the open panel off pure ink so it reads as lit glass rather than a
          hole in the page. Small, because the tint underneath is doing the work. */}
      <motion.div
        className="pointer-events-none absolute inset-0 z-0 bg-white/8"
        initial={false}
        animate={{ opacity: open ? 1 : 0 }}
        transition={{ duration: 0.3, ease: EASE }}
      />

      <div className={`relative z-20 flex items-center pr-3 pl-7 rounded-[32px] transition-colors duration-300 ${clearRowOnOpen && panelOut ? "bg-transparent" : T.innerRow}`} style={{ height: ROW }}>
        {promptButton ? (
          <button
            type="button"
            onClick={() => {
              if (!submitting) setOpen(true);
            }}
            disabled={submitting}
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-label="Open options"
            className="relative mr-3 min-w-0 flex-1 cursor-pointer text-left disabled:cursor-default"
          >
            {statusMessages ? (
              // Reported here rather than under the card, so the thing that
              // started the run is the thing that shows it running. Mounted per
              // run, so every run opens on the first line without a reset.
              <StatusLine messages={statusMessages} tone={tone} />
            ) : submitting ? (
              // A submitting host with no messages wants the spinner alone:
              // blank row, screen-reader label only. The row's height comes
              // from its fixed-height parent, so nothing collapses.
              <span className="font-body flex min-w-0 items-center text-[15px] sm:text-base">
                <span className="sr-only">Working…</span>
              </span>
            ) : (
              <span
                className="font-body flex items-center gap-[0.4ch] text-[15px] whitespace-nowrap sm:text-base"
                aria-hidden="true"
              >
                <span className={T.muted}>{placeholder}</span>
                <span className="relative">
                  <span className="invisible">
                    {subjects.reduce((a, b) => (b.length > a.length ? b : a), "")}
                  </span>
                  <AnimatePresence initial={false} mode="popLayout">
                    <motion.span
                      key={subjects[subject]}
                      className={`absolute inset-0 ${T.ink}`}
                      initial={{ opacity: 0, y: 10, filter: tone === "light" ? "blur(6px)" : undefined }}
                      animate={{ opacity: 1, y: 0, filter: tone === "light" ? "blur(0px)" : undefined }}
                      exit={{ opacity: 0, y: -10, filter: tone === "light" ? "blur(6px)" : undefined }}
                      transition={{ duration: 0.45, ease: EASE }}
                    >
                      {subjects[subject]}
                    </motion.span>
                  </AnimatePresence>
                </span>
              </span>
            )}
          </button>
        ) : (
        <div className="relative min-w-0 flex-1 mr-3">
          <input
            ref={inputRef}
            type="search"
            value={query}
            aria-label={`${placeholder}…`}
            {...(suggestions !== undefined
              ? {
                  role: "combobox",
                  "aria-autocomplete": "list",
                  "aria-controls": suggestId,
                  "aria-expanded": showSuggestions || showRecents,
                  ...(highlight >= 0
                    ? { "aria-activedescendant": `${suggestId}-opt-${highlight}` }
                    : {}),
                }
              : {})}
            onChange={(e) => {
              setQuery(e.target.value);
              onQueryChange?.(e.target.value);
              // Suggest hosts trade the filter panel for matches mid-typing;
              // mode="wait" above sequences the handoff. Other hosts keep the
              // panel they opened.
              if (suggestions !== undefined && open) setOpen(false);
            }}
            onFocus={() => {
              setFocused(true);
              if (recentKey) setRecents(readRecents(recentKey));
            }}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                handleEnter();
              }
            }}
            className={`font-body w-full bg-transparent text-[15px] ${T.ink} ${T.caret} outline-none focus-visible:outline-none sm:text-base [&::-webkit-search-cancel-button]:hidden`}
          />

          {/* Sits over the empty field rather than in `placeholder`, which can
              only carry one colour and cannot animate. Click-through so the
              prompt still focuses the input. */}
          {!typing && (
            <div
              className="font-body pointer-events-none absolute inset-0 flex items-center gap-[0.4ch] text-[15px] whitespace-nowrap sm:text-base"
              aria-hidden="true"
            >
              <span className={T.muted}>{placeholder}</span>
              <span className="relative">
                {/* Reserves the widest subject's width so the row never jumps
                    as the word swaps under an absolutely-positioned twin. */}
                <span className="invisible">
                  {subjects.reduce((a, b) => (b.length > a.length ? b : a), "")}
                </span>
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.span
                    key={subjects[subject]}
                    className={`absolute inset-0 ${T.ink}`}
                    initial={{ opacity: 0, y: 10, filter: tone === "light" ? "blur(6px)" : undefined }}
                    animate={{ opacity: 1, y: 0, filter: tone === "light" ? "blur(0px)" : undefined }}
                    exit={{ opacity: 0, y: -10, filter: tone === "light" ? "blur(6px)" : undefined }}
                    transition={{ duration: 0.45, ease: EASE }}
                  >
                    {subjects[subject]}
                  </motion.span>
                </AnimatePresence>
              </span>
            </div>
          )}
        </div>
        )}

        <AnimatePresence>
          {(typing || selectedFilters.length > 0 || isSearching || busy) && (
            <motion.div
              initial={{ width: 0, opacity: 0, scale: 0.8 }}
              animate={{ width: 30, opacity: 1, scale: 1 }}
              exit={{ width: 0, opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="shrink-0 overflow-visible"
            >
              <button
                type="button"
                aria-label={isSearching || busy ? "Searching…" : "Search"}
                title={isSearching || busy ? "Searching…" : "Press Enter or click to search"}
                disabled={isSearching || busy}
                onClick={() => {
                  submitSearch();
                  inputRef.current?.blur();
                }}
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-all focus-visible:outline-2 focus-visible:outline-offset-2 ${T.outline} ${
                  isSearching || busy
                    ? "bg-transparent"
                    : `${T.disc} ${T.discHover}`
                }`}
              >
                {isSearching || busy ? (
                  <div
                    className={`h-4.5 w-4.5 rounded-[4px] animate-spin ${T.spinner}`}
                    style={{ animationDuration: "2.5s" }}
                  />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="ml-3 flex shrink-0 items-center gap-2">
          {onSubmit && (
            <button
              type="button"
              aria-label={submitting ? `${submitLabel} — working…` : submitLabel}
              title={submitting ? `${submitLabel} — working…` : submitLabel}
              aria-expanded={confirm ? confirming : undefined}
              disabled={submitting}
              onClick={() => {
                if (submitting) return;
                if (!confirm) {
                  onSubmit();
                  return;
                }
                // Arrow and Generate are the same button once the sheet is up:
                // the sheet already re-states the run, so a second arrow press
                // is the CAM agreeing to it, not a request to re-open it.
                if (confirming) {
                  setConfirming(false);
                  setOpen(false);
                  onSubmit();
                  return;
                }
                setOpen(true);
                setConfirming(true);
              }}
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-all focus-visible:outline-2 focus-visible:outline-offset-2 ${T.outline} ${
                submitting
                  ? "bg-transparent"
                  : `${T.disc} ${T.discHover}`
              }`}
            >
              {submitting ? (
                <div
                  className={`h-4.5 w-4.5 rounded-[4px] animate-spin ${T.spinner}`}
                  style={{ animationDuration: "2.5s" }}
                />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
            </button>
          )}
          <button
            type="button"
            aria-label={open ? "Close filters" : "Open filters"}
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            onClick={() => {
              if (open) {
                close();
                inputRef.current?.blur();
              } else {
                setOpen(true);
              }
            }}
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${T.toggle} transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${T.outline}`}
          >
            {open ? <X className="h-5 w-5" /> : <SlidersHorizontal className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <AnimatePresence initial={false} mode="wait">
        {open ? (
          <motion.div
            key="panel"
            id={listId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.18, ease: EASE } }}
            transition={{ duration: 0.5, ease: EASE, delay: compactRest ? 0.56 : 0.2 }}
            className="relative z-10"
            // Held at the open width for the whole morph. Left to `w-full` it
            // re-laid-out on every frame of the widen — rows squeezing and
            // reflowing inside the clip — which is the other half of what read
            // as a snap.
            style={compactRest && fullWidth ? { width: fullWidth } : undefined}
          >
            <AnimatePresence mode="wait">
              {confirm && confirming ? (
                <motion.div
                  key="confirm"
                  className="flex h-[280px] flex-col justify-center px-6 py-5"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                  transition={{ duration: 0.3, ease: EASE }}
                  role="group"
                  aria-label={confirm.title}
                >
                  <p className={`font-body text-xl font-medium ${T.bright}`}>{confirm.title}</p>
                  {confirm.description && (
                    <p className={`mt-1.5 text-[13px] ${T.muted60}`}>{confirm.description}</p>
                  )}

                  {confirm.details && confirm.details.length > 0 && (
                    <dl className={`mt-4 flex flex-col gap-2 rounded-2xl ${T.well} px-4 py-3`}>
                      {confirm.details.map((detail) => (
                        <div className="flex items-baseline gap-4" key={detail.label}>
                          <dt className={`shrink-0 text-[12px] ${T.muted50}`}>{detail.label}</dt>
                          <dd className={`min-w-0 flex-1 truncate text-right text-[13px] ${T.ink}`}>
                            {detail.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  <div className="mt-5 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      className={`rounded-full px-4 py-2 text-[13px] font-semibold ${T.faint} transition-colors ${T.hoverRow} ${T.hoverInk} focus-visible:outline-2 focus-visible:outline-offset-2 ${T.outline}`}
                    >
                      {confirm.cancelLabel ?? "Back"}
                    </button>
                    <button
                      ref={confirmButtonRef}
                      type="button"
                      onClick={() => {
                        // Closing hands the run to the pill, which wears it as
                        // the rolling square and the status line.
                        setConfirming(false);
                        setOpen(false);
                        onSubmit?.();
                      }}
                      className={`rounded-full bg-[#e6f5c0] px-5 py-2 text-[13px] font-semibold text-[#1a1a1a] transition-colors hover:bg-[#d4e5a0] focus-visible:outline-2 focus-visible:outline-offset-2 ${T.outline}`}
                    >
                      {confirm.confirmLabel ?? submitLabel}
                    </button>
                  </div>
                </motion.div>
              ) : panelRows ? (
                <motion.ul
                  key="rows"
                  className="flex flex-col gap-1 px-4 py-4 h-[280px] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                  variants={PANEL_STAGGER}
                  initial="hidden"
                  animate="show"
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                >
                  {panelRows.map((row) => {
                    if (row.alwaysExpanded) {
                      return (
                        <motion.li key={row.label} variants={GLASS_ITEM}>
                          {row.hint && (
                            <p className={`px-3 pt-1 text-[13px] ${T.muted60}`}>
                              {row.hint}
                            </p>
                          )}
                          {typeof row.expandedContent === "function"
                            ? row.expandedContent({
                                collapse: () => setExpandedRow(null),
                              })
                            : row.expandedContent}
                        </motion.li>
                      );
                    }
                    const transformable = row.expandedContent !== undefined;
                    const transformed = expandedRow === row.label;
                    const interactive = transformable || row.onSelect !== undefined;
                    return (
                      <motion.li key={row.label} variants={GLASS_ITEM}>
                        <AnimatePresence mode="wait" initial={false}>
                          {transformable && transformed ? (
                            <motion.div
                              key={`${row.label}-field`}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.2, ease: EASE }}
                              className="px-3 py-2"
                            >
                              {typeof row.expandedContent === "function"
                                ? row.expandedContent({
                                    collapse: () => setExpandedRow(null),
                                  })
                                : row.expandedContent}
                            </motion.div>
                          ) : interactive ? (
                            <motion.button
                              key={`${row.label}-button`}
                              type="button"
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.15, ease: EASE }}
                              onClick={() => {
                                if (transformable) {
                                  setExpandedRow(row.label);
                                }
                                row.onSelect?.();
                              }}
                              className={`font-body flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors ${T.hoverRow} focus-visible:outline-2 focus-visible:outline-offset-2 ${T.outline}`}
                            >
                              {row.icon}
                              <span className="min-w-0 flex-1">
                                <span className={`block text-lg font-medium ${T.bright}`}>
                                  {row.label}
                                </span>
                                {row.hint && (
                                  <span className={`mt-0.5 block text-[13px] ${T.muted60}`}>
                                    {row.hint}
                                  </span>
                                )}
                              </span>
                              {transformable && (
                                <Plus
                                  aria-hidden="true"
                                  className={`h-4 w-4 shrink-0 ${T.faint}`}
                                />
                              )}
                            </motion.button>
                          ) : (
                            <div className="font-body flex w-full items-center gap-3 rounded-2xl px-3 py-2">
                              {row.icon}
                              <span className="min-w-0 flex-1">
                                <span className={`block text-lg font-medium ${T.bright}`}>
                                  {row.label}
                                </span>
                                {row.hint && (
                                  <span className={`mt-0.5 block text-[13px] ${T.muted60}`}>
                                    {row.hint}
                                  </span>
                                )}
                              </span>
                            </div>
                          )}
                        </AnimatePresence>
                      </motion.li>
                    );
                  })}
                </motion.ul>
              ) : activeFilter === null ? (
                  <motion.ul
                    key="categories"
                    className="flex flex-col gap-1 px-4 py-4 h-[280px] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                  variants={PANEL_STAGGER}
                  initial="hidden"
                  animate="show"
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                >
                  {Object.keys(FILTER_CATEGORIES).map((filter) => {
                    const count = selectedFilters.filter((f) => f.category === filter).length;
                    return (
                      <motion.li key={filter} variants={GLASS_ITEM}>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveFilter(filter);
                            setFilterQuery("");
                          }}
                          className={`font-body flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-lg font-medium ${T.bright} transition-colors ${T.hoverRow} ${T.hoverBright} focus-visible:outline-2 focus-visible:outline-offset-2 ${T.outline}`}
                        >
                          <span>{filter}</span>
                          {count > 0 && (
                            <span className="rounded-full bg-[#e6f5c0] px-2 py-0.5 text-xs font-bold text-[#1a1a1a]">
                              {count}
                            </span>
                          )}
                        </button>
                      </motion.li>
                    );
                  })}
                </motion.ul>
              ) : isDateCategory ? (
                <motion.div
                  key="date-options"
                  className="flex flex-col h-[280px] pt-3 overflow-hidden"
                  variants={PANEL_STAGGER}
                  initial="hidden"
                  animate="show"
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                >
                  {/* Top Bar with Back button and Mode Switcher */}
                  <motion.div variants={GLASS_ITEM} className={`px-4 pb-2.5 flex items-center justify-between gap-2 shrink-0 border-b ${T.divider}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveFilter(null);
                        setFilterQuery("");
                      }}
                      className={`font-body flex items-center gap-1 shrink-0 rounded-xl px-2.5 py-1 text-[13px] font-medium ${T.muted60} transition-colors ${T.hoverRowSoft} ${T.hoverInk} focus-visible:outline-2 focus-visible:outline-offset-2 ${T.outline}`}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Back
                    </button>

                    <div className={`flex items-center gap-1 ${T.fieldBg} p-0.5 rounded-xl`}>
                      <button
                        type="button"
                        onClick={() => setDatePickerMode("day")}
                        className={`font-body px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                          datePickerMode === "day"
                            ? "bg-[#e6f5c0] text-[#1a1a1a] shadow-xs"
                            : `${T.faint} ${T.hoverBright}`
                        }`}
                      >
                        Specific day
                      </button>
                      <button
                        type="button"
                        onClick={() => setDatePickerMode("range")}
                        className={`font-body px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                          datePickerMode === "range"
                            ? "bg-[#e6f5c0] text-[#1a1a1a] shadow-xs"
                            : `${T.faint} ${T.hoverBright}`
                        }`}
                      >
                        Date range
                      </button>
                      <button
                        type="button"
                        onClick={() => setDatePickerMode("presets")}
                        className={`font-body px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                          datePickerMode === "presets"
                            ? "bg-[#e6f5c0] text-[#1a1a1a] shadow-xs"
                            : `${T.faint} ${T.hoverBright}`
                        }`}
                      >
                        Presets
                      </button>
                    </div>
                  </motion.div>

                  {/* Panel Content */}
                  <div className="flex-1 p-4 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                    {datePickerMode === "day" && (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-3"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                              <input
                                type="date"
                                value={customSingleDate}
                                onChange={(e) => setCustomSingleDate(e.target.value)}
                                className={`font-body w-full ${T.fieldBg} text-sm font-semibold ${T.bright} rounded-xl px-3 py-2 outline-none ring-1 ${T.fieldRing} focus:ring-2 ${T.ringFocus} ${T.fieldScheme}`}
                              />
                            </div>
                            {(() => {
                              const isSelected = Boolean(
                                customSingleDate &&
                                selectedFilters.some((f) => f.category === activeFilter && f.value === customSingleDate)
                              );
                              return (
                                <button
                                  type="button"
                                  disabled={!customSingleDate}
                                  onClick={() => applySingleDate(customSingleDate)}
                                  className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-all shadow-xs disabled:opacity-40 disabled:cursor-not-allowed ${
                                    isSelected
                                      ? `${T.selectedBtn}`
                                      : "bg-[#e6f5c0] text-[#1a1a1a] hover:bg-[#d4e5a0]"
                                  }`}
                                >
                                  {isSelected ? (
                                    <>
                                      <Check className={`h-3.5 w-3.5 ${T.accentText}`} />
                                      <span>Selected</span>
                                    </>
                                  ) : (
                                    <>
                                      <Plus className="h-3.5 w-3.5" />
                                      <span>Select day</span>
                                    </>
                                  )}
                                </button>
                              );
                            })()}
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {datePickerMode === "range" && (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-3"
                      >
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <span className={`block text-[11px] font-semibold ${T.muted50} mb-1`}>From</span>
                            <input
                              type="date"
                              value={customRangeFrom}
                              onChange={(e) => setCustomRangeFrom(e.target.value)}
                              className={`font-body w-full ${T.fieldBg} text-xs sm:text-sm font-semibold ${T.bright} rounded-xl px-2.5 py-1.5 outline-none ring-1 ${T.fieldRing} focus:ring-2 ${T.ringFocus} ${T.fieldScheme}`}
                            />
                          </div>
                          <div>
                            <span className={`block text-[11px] font-semibold ${T.muted50} mb-1`}>To</span>
                            <input
                              type="date"
                              value={customRangeTo}
                              onChange={(e) => setCustomRangeTo(e.target.value)}
                              className={`font-body w-full ${T.fieldBg} text-xs sm:text-sm font-semibold ${T.bright} rounded-xl px-2.5 py-1.5 outline-none ring-1 ${T.fieldRing} focus:ring-2 ${T.ringFocus} ${T.fieldScheme}`}
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-end pt-1">
                          {(() => {
                            const rangeVal = `${customRangeFrom <= customRangeTo ? customRangeFrom : customRangeTo}..${customRangeFrom <= customRangeTo ? customRangeTo : customRangeFrom}`;
                            const isSelected = Boolean(
                              customRangeFrom &&
                              customRangeTo &&
                              selectedFilters.some((f) => f.category === activeFilter && f.value === rangeVal)
                            );
                            return (
                              <button
                                type="button"
                                disabled={!customRangeFrom || !customRangeTo}
                                onClick={() => applyDateRange(customRangeFrom, customRangeTo)}
                                className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-all shadow-xs disabled:opacity-40 disabled:cursor-not-allowed ${
                                  isSelected
                                    ? `${T.selectedBtn}`
                                    : "bg-[#e6f5c0] text-[#1a1a1a] hover:bg-[#d4e5a0]"
                                }`}
                              >
                                {isSelected ? (
                                  <>
                                    <Check className={`h-3.5 w-3.5 ${T.accentText}`} />
                                    <span>Selected</span>
                                  </>
                                ) : (
                                  <>
                                    <Plus className="h-3.5 w-3.5" />
                                    <span>Select range</span>
                                  </>
                                )}
                              </button>
                            );
                          })()}
                        </div>
                      </motion.div>
                    )}

                    {datePickerMode === "presets" && (
                      <motion.ul
                        variants={OPTION_LIST}
                        initial="hidden"
                        animate="show"
                        className="flex flex-col gap-1"
                      >
                        {activeOptions.map((option, index) => {
                          const isSelected = selectedFilters.some(
                            (f) => f.category === activeFilter && f.value === option.value
                          );
                          return (
                            <motion.li key={option.value} variants={GLASS_OPTIONS} custom={index}>
                              <button
                                type="button"
                                onClick={() => applyDatePreset(option)}
                                className={`font-body flex w-full items-center justify-between rounded-xl px-3 py-2 text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${T.outline} ${
                                  isSelected
                                    ? `${T.selected}`
                                    : `${T.bright} ${T.hoverRow} ${T.hoverBright}`
                                }`}
                              >
                                <span>{option.label}</span>
                                {isSelected && <Check className={`h-4 w-4 ${T.accentText}`} />}
                              </button>
                            </motion.li>
                          );
                        })}
                      </motion.ul>
                    )}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="options"
                  className="flex flex-col h-[280px] pt-4"
                  variants={PANEL_STAGGER}
                  initial="hidden"
                  animate="show"
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                >
                  <motion.div variants={GLASS_ITEM} className="mb-4 px-4 flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveFilter(null);
                        setFilterQuery("");
                      }}
                      className={`font-body flex items-center gap-1 shrink-0 rounded-2xl px-3 py-2 text-[15px] font-medium ${T.muted50} transition-colors ${T.hoverRowSoft} ${T.hoverInk} focus-visible:outline-2 focus-visible:outline-offset-2 ${T.outline}`}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Back
                    </button>

                    <input
                      type="search"
                      placeholder={`Search ${activeFilter?.replace("Filter by ", "").toLowerCase()}...`}
                      value={filterQuery}
                      onChange={(e) => setFilterQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          submitSearch();
                          inputRef.current?.blur();
                        }
                      }}
                      className={`font-body flex-1 min-w-0 ${T.fieldBg} text-[15px] ${T.ink} ${T.faintPlaceholder} rounded-xl px-4 py-2 outline-none focus-visible:ring-2 ${T.ringVisibleFocus} [&::-webkit-search-cancel-button]:hidden`}
                    />
                  </motion.div>

                  <motion.ul
                    variants={OPTION_LIST}
                    className="flex-1 flex flex-col gap-1 px-4 pb-4 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                  >
                    {activeOptions.map((option, index) => {
                      const isSelected = selectedFilters.some(
                        (f) => f.category === activeFilter && f.value === option.value
                      );
                      return (
                        <motion.li key={option.value} variants={GLASS_OPTIONS} custom={index}>
                          <button
                            type="button"
                            onClick={() => {
                              if (isSelected) {
                                setSelectedFilters((prev) =>
                                  prev.filter(
                                    (f) => !(f.category === activeFilter && f.value === option.value)
                                  )
                                );
                              } else {
                                setSelectedFilters((prev) => [
                                  ...prev,
                                  {
                                    category: activeFilter as string,
                                    label: option.label,
                                    value: option.value,
                                    colour: option.colour,
                                  },
                                ]);
                              }
                            }}
                            className={`font-body flex w-full items-center justify-between rounded-2xl px-3 py-2 text-lg font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${T.outline} ${
                              isSelected
                                ? `${T.selected}`
                                : `${T.bright} ${T.hoverRow} ${T.hoverBright}`
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              {option.colour && (
                                <span
                                  aria-hidden="true"
                                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: option.colour }}
                                />
                              )}
                              {option.label}
                            </span>
                            {isSelected && (
                              <Check className={`h-4 w-4 ${T.accentText}`} />
                            )}
                          </button>
                        </motion.li>
                      );
                    })}

                    {/* Explicit `initial`/`animate` rather than a variant. An
                        empty result is the one row that must never wait on the
                        panel's orchestration — inheriting the staggered variant
                        left it held at `hidden`, so a search that matched
                        nothing looked identical to a search that hadn't run yet. */}
                    {activeOptions.length === 0 && (
                      <motion.li
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.2, ease: EASE }}
                        className={`font-body px-3 py-3 text-[15px] ${T.muted60}`}
                        role="status"
                      >
                        {trimmedFilterQuery
                          ? `No match for “${trimmedFilterQuery}”.`
                          : "Nothing to filter by here."}
                      </motion.li>
                    )}
                  </motion.ul>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (showSuggestions || showRecents) ? (
          <motion.div
            key="suggest"
            id={suggestId}
            role="listbox"
            aria-label={showSuggestions ? `Suggestions for ${query.trim()}` : "Recent searches"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15, ease: EASE } }}
            transition={{ duration: 0.5, ease: EASE, delay: 0.2 }}
            className="relative z-10 flex h-[280px] flex-col px-4 pt-1 pb-4"
          >
            {/* As-you-type suggestions (or recents on an empty field): the dropdown
                half of the search. Typing shows matches, the toggle shows filters —
                one presence with mode="wait" hands off between them instead of
                overlapping, so opening filters mid-typing reads as one morph. */}
            {activeRows.length === 0 ? (
              <p className={`font-body px-3 py-3 text-[15px] ${T.muted60}`} role="status">
                {`No matches for “${query.trim()}”.`}
              </p>
            ) : (
              <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {activeRows.map((row, index) => (
                  <li key={row.kind === "suggestion" ? row.item.id : `recent:${row.query}`}>
                    <button
                      type="button"
                      role="option"
                      id={`${suggestId}-opt-${index}`}
                      aria-selected={highlight === index}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => activateRow(row)}
                      onMouseMove={() => {
                        if (highlight !== index) setHighlight(index);
                      }}
                      className={`font-body flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors ${T.hoverRow} ${
                        highlight === index ? T.fieldBg : ""
                      } focus-visible:outline-2 focus-visible:outline-offset-2 ${T.outline}`}
                    >
                      {row.kind === "suggestion" ? (
                        <Mail aria-hidden="true" className={`h-4 w-4 shrink-0 ${T.faint}`} />
                      ) : (
                        <History aria-hidden="true" className={`h-4 w-4 shrink-0 ${T.faint}`} />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-[15px] font-semibold ${T.bright}`}>
                          {row.kind === "suggestion" ? (
                            <BoldMatch text={row.item.title} query={query} />
                          ) : (
                            row.query
                          )}
                        </span>
                        {row.kind === "suggestion" && row.item.subtitle && (
                          <span className={`mt-0.5 block truncate text-[13px] ${T.muted60}`}>
                            {row.item.subtitle}
                          </span>
                        )}
                      </span>
                      {row.kind === "suggestion" && row.item.meta && (
                        <span className={`shrink-0 text-xs ${T.muted50}`}>{row.item.meta}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {showSuggestions && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => submitSearch()}
                className={`font-body mt-1 flex w-full shrink-0 items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-[15px] font-medium transition-colors ${T.hoverRow} focus-visible:outline-2 focus-visible:outline-offset-2 ${T.outline}`}
              >
                <Search aria-hidden="true" className={`h-4 w-4 shrink-0 ${T.faint}`} />
                <span className={`min-w-0 flex-1 truncate ${T.bright}`}>
                  {`All results for ‘${query.trim()}’`}
                </span>
                <kbd
                  aria-hidden="true"
                  className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-body font-semibold`}
                >
                  Press Enter
                </kbd>
              </button>
            )}
          </motion.div>
        ) : null}
          </AnimatePresence>

        {/* Clear filters button inside the dropdown panel (shown when chipsBelow=false) */}
        {selectedFilters.length > 0 && (
          <div className="flex items-center justify-end gap-2 px-4 pb-4">
            <button
              type="button"
              onClick={() => {
                setSelectedFilters([]);
              }}
              className={`font-body text-[13px] font-medium transition-colors ${T.muted50} ${T.hoverBright} ${T.hoverInk}`}
            >
              Clear filters
            </button>
          </div>
        )}
      </motion.div>

      {/* Active filter pills float UNDER the white card on a transparent background, not inside the card */}
      {selectedFilters.length > 0 && (panelOut || !chipsBelow) && (
        <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2 px-3 bg-transparent">
          <AnimatePresence>
            {selectedFilters.map((filter) => {
              const pill = tagPillStyle(filter.colour);
              return (
                <motion.span
                  key={`${filter.category}-${filter.value}`}
                  initial={{ opacity: 0, scale: 0.8, y: -6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8, y: -6 }}
                  layout
                  style={pill ?? undefined}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-medium shadow-sm ${
                    pill ? "" : "bg-[#f4f4ef] text-[#1a1a1a]"
                  }`}
                >
                  {pill && (
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: filter.colour }}
                    />
                  )}
                  {filter.label}
                  <button
                    type="button"
                    aria-label={`Remove ${filter.label} filter`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => removeFilter(filter.category, filter.value)}
                    className={`hover:bg-black/10 focus:outline-none flex h-4 w-4 items-center justify-center rounded-full transition-colors ${
                      pill ? "bg-black/5 text-black/50" : "bg-black/5 text-black/60"
                    }`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </motion.span>
              );
            })}
          </AnimatePresence>
          {(selectedFilters.length > 0 || query) && (
            <button
              type="button"
              onClick={() => {
                setSelectedFilters([]);
                setQuery("");
                onQueryChange?.("");
              }}
              className="text-[13px] font-medium text-black/40 hover:text-black transition-colors ml-1"
            >
              Clear filters
            </button>
          )}
        </div>
      )}
      </motion.div>

      </div>

      {/* Under the pill, not above it. The bar is pinned by its host page, and
          a chip row above it would push the pill down by its own height the
          moment a filter is picked — the one element on the page that must not
          move. Hanging underneath, the chips grow into the content instead, and
          the open panel simply covers them. Fixed-toolbar hosts hide this row
          (`chipsBelow={false}`) so picking a filter never shifts the layout —
          their chips live at the bottom of the open dropdown instead. */}
      {chipsBelow && (
      <div className="flex flex-wrap items-center gap-2 px-2 empty:hidden">
        <AnimatePresence>
        {selectedFilters.map((filter) => {
          // F194 AC2 — a coloured tag's chip wears the same pill tint the tag
          // chips use everywhere else; uncoloured filters keep the bone chip.
          const pill = tagPillStyle(filter.colour);
          return (
            <motion.span
              key={`${filter.category}-${filter.value}`}
              initial={{ opacity: 0, scale: 0.8, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: -10 }}
              layout
              style={pill ?? undefined}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-medium shadow-sm ${
                pill ? "" : "bg-[#f4f4ef] text-[#1a1a1a]"
              }`}
            >
              {pill && (
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: filter.colour }}
                />
              )}
              {filter.label}
              <button
                type="button"
                onClick={() => removeFilter(filter.category, filter.value)}
                className={`hover:bg-black/10 focus:outline-none flex h-4 w-4 items-center justify-center rounded-full transition-colors ${
                  pill ? "bg-black/5 text-black/50" : "bg-black/5 text-black/60"
                }`}
              >
                <X className="h-3 w-3" />
              </button>
            </motion.span>
          );
        })}
        </AnimatePresence>
        {(selectedFilters.length > 0 || query) && (
          <button
            type="button"
            onClick={() => {
              setSelectedFilters([]);
              setQuery("");
              onQueryChange?.("");
            }}
            className="text-[13px] font-medium text-black/40 hover:text-black transition-colors ml-1"
          >
            Clear filters
          </button>
        )}
      </div>
      )}
    </div>
  );
}



