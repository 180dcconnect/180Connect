"use client";

import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Inbox,
  MessageSquare,
  Clock,
  AlarmClock,
  CalendarClock,
  Star,
  Pencil,
  SendHorizontal,
  StickyNote,
  Trash2,
  Tag,
  Check,
  type LucideIcon,
  X,
} from "lucide-react";
import {
  formatGmailTimestamp,
  resolveDateFilter,
  searchThreads,
  type InboxThreadTag,
  type InboxThreadView,
} from "@/lib/inbox-thread-view";
import { threadMatchesLabels } from "@/lib/inbox/label-filter";
import { createTagAction } from "@/lib/tags/tag-actions";
import {
  mockFillThreads,
} from "@/lib/inbox-mock-data";
import type { AddressableClient } from "@/lib/inbox/real-threads";
import { DEFAULT_FOLLOW_UP_THRESHOLDS } from "@/lib/outreach/follow-up-recommendations";
import {
  applyThreadFlags,
  getThreadFlagsServerSnapshot,
  getThreadFlagsSnapshot,
  seedThreadFlags,
  subscribeToThreadFlags,
  updateThreadFlags,
  type InboxThreadStateRow,
  type ThreadFlags,
} from "@/lib/inbox/thread-flags";
import {
  applyInboxThreadFlags,
  type InboxThreadFlagUpdate,
} from "@/app/inbox/actions";
import { GmailSidebar, SECTORS, type GmailFolder, type SidebarLabel } from "./gmail-sidebar";
import { GmailActionBar, type SelectionState } from "./gmail-action-bar";
import { GmailThreadRow } from "./gmail-thread-row";
import { GmailReadingPane } from "./gmail-reading-pane";
import { cancelScheduledEmail } from "@/app/clients/[id]/outreach-actions";
import { GmailComposeModal } from "./gmail-compose-modal";
import { emailHtmlToPlainText } from "@/lib/outreach/email-html";
import { BrandSearchBar } from "@/components/brand/search-bar";
import {
  PRIORITY_SCORE_FILTERS,
  SECTOR_FILTER_OPTIONS,
} from "@/app/clients/visible-clients";
import {
  ORGANISATION_TYPES,
  formatOrganisationType,
} from "@/lib/organisation-format";

export type GmailCategoryTab =
  | "primary"
  | "inbound"
  | "awaiting"
  | "followup"
  | "starred"
  | "sent";

const PAGE_SIZE = 50;

interface CategoryTabConfig {
  id: GmailCategoryTab;
  label: string;
  icon: LucideIcon;
  iconClass?: string;
  activeTextClass: string;
  indicatorBg: string;
  renderBadge?: (counts: CategoryBadgeCounts) => React.ReactNode;
}

interface CategoryBadgeCounts {
  inbound: number;
  awaiting: number;
  followUpDue: number;
}

/** Shared count pill for the category tabs — hidden entirely when the count is
    zero, so a tab only carries a number when it has something in it. */
function countBadge(count: number, toneClass: string): React.ReactNode {
  if (count <= 0) return null;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${toneClass}`}
    >
      {count}
    </span>
  );
}

const CATEGORY_TABS: readonly CategoryTabConfig[] = [
  {
    id: "primary",
    label: "Primary",
    icon: Inbox,
    activeTextClass: "text-lead",
    indicatorBg: "bg-lead",
  },
  {
    id: "inbound",
    label: "Inbound Replies",
    icon: MessageSquare,
    iconClass: "text-emerald-600",
    activeTextClass: "text-emerald-700",
    indicatorBg: "bg-emerald-600",
    renderBadge: (counts) =>
      countBadge(counts.inbound, "bg-emerald-100 text-emerald-800"),
  },
  {
    id: "awaiting",
    label: "Awaiting Response",
    icon: Clock,
    iconClass: "text-amber-800",
    activeTextClass: "text-amber-900",
    indicatorBg: "bg-amber-800",
    renderBadge: (counts) =>
      countBadge(counts.awaiting, "bg-amber-100 text-amber-900"),
  },
  {
    id: "followup",
    label: "Follow-up Due",
    icon: AlarmClock,
    iconClass: "text-rose-500",
    activeTextClass: "text-rose-700",
    indicatorBg: "bg-rose-500",
    renderBadge: (counts) =>
      countBadge(counts.followUpDue, "bg-rose-100 text-rose-800"),
  },
  {
    id: "starred",
    label: "Starred",
    icon: Star,
    iconClass: "text-amber-400",
    activeTextClass: "text-amber-600",
    indicatorBg: "bg-amber-500",
  },
];

/** Follow-Up Due mirrors the real recommendation engine
    (`src/lib/outreach/follow-up-recommendations.ts`): a thread counts when we
    sent last and nothing has come back inside the CAM's first-follow-up
    threshold.

    That threshold is the viewer's own `outreach_preferences.first_follow_up_days`,
    read by the page and passed in — it used to be hardcoded to 7 here, so a CAM
    who had set their own threshold in Settings saw this tab disagree with the
    dashboard's Needs Attention panel about the same clients.
    `DEFAULT_FOLLOW_UP_THRESHOLDS.first` is the fallback, and is the same AC
    default the database column carries. */
function daysSilent(thread: InboxThreadView): number {
  const elapsed = Date.now() - new Date(thread.lastActivityAt).getTime();
  return Math.floor(elapsed / (24 * 60 * 60 * 1000));
}

function isFollowUpDue(thread: InboxThreadView, thresholdDays: number): boolean {
  if (thread.status !== "awaiting" && thread.status !== "sent") return false;
  return daysSilent(thread) >= thresholdDays;
}

/**
 * Date presets in the search panel. Copied verbatim from the import-status
 * bar's DATE_OPTIONS (same labels, same values) so the two pickers agree;
 * the bar's day/range pickers add ISO days and `from..to` ranges around them.
 */
const DATE_OPTIONS = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "Past 7 days", value: "7d" },
  { label: "Past 30 days", value: "30d" },
  { label: "This month", value: "this_month" },
  { label: "Last month", value: "last_month" },
];

/** Query parameter the date category writes — the bar keys its date-picker UI
 *  off this exact name, same as import-status. */
const DATE_CATEGORY = "Filter by date";

/**
 * Empty states are per-folder, never generic: an empty Drafts and an empty
 * Trash mean different things, and the screen should say which. Search and
 * label empties are computed at render (they quote the query/label back).
 */
const FOLDER_EMPTY_STATES: Record<GmailFolder, { icon: LucideIcon; title: string; hint: string }> = {
  inbox: {
    icon: Inbox,
    title: "All caught up",
    hint: "Nothing waiting in the inbox right now.",
  },
  starred: {
    icon: Star,
    title: "No starred threads",
    hint: "Star a thread to pin it here.",
  },
  scheduled: {
    icon: CalendarClock,
    title: "Nothing scheduled",
    hint: "Messages you schedule from compose will wait here until they send.",
  },
  sent: {
    icon: SendHorizontal,
    title: "Nothing sent yet",
    hint: "New outreach you send will appear here.",
  },
  drafts: {
    icon: StickyNote,
    title: "No drafts yet",
    hint: "Drafts you save while composing will wait here.",
  },
  trash: {
    icon: Trash2,
    title: "Trash is empty",
    hint: "Threads you delete will show up here.",
  },
};

/** One open compose window. */
type ComposeWindow = {
  /** Stable identity: the draft's row id, or `new:<n>` for a blank compose. */
  key: string;
  /** The outreach_messages row being edited, or null for a fresh email. */
  draftId: string | null;
  recipient?: string;
  subject?: string;
  body?: string;
  minimised: boolean;
};

/** Two fit beside the sidebar on a laptop; a third does not. */
const MAX_EXPANDED_COMPOSERS = 2;

/** Widths the modal itself uses, needed here to stack the windows. */
const COMPOSER_WIDTH_PX = 600;
const COMPOSER_MINIMISED_WIDTH_PX = 320;
const COMPOSER_GAP_PX = 12;
const COMPOSER_EDGE_PX = 32;

export function GmailInboxShell({
  initialThreads = mockFillThreads(),
  initialThreadId,
  initialComposeClientId = null,
  addressableClients,
  initialTags = [],
  followUpDays = DEFAULT_FOLLOW_UP_THRESHOLDS.first,
  initialThreadFlags = [],
  className = "h-[calc(100vh-1.5rem)]",
}: {
  initialThreads?: InboxThreadView[];
  initialThreadId?: string | null;
  /** Organisation id from ?compose=, opened as an addressed compose window. */
  initialComposeClientId?: string | null;
  /**
   * Every tag (TAGS) in play across the loaded threads, de-duplicated and
   * name-sorted by the page. Seeds the sidebar's custom-label rows and the
   * compose window's "Add label" picker — the mailbox does not invent a
   * label concept, it shows the client record's tags.
   */
  initialTags?: InboxThreadTag[];
  /**
   * The subset of `initialThreads` that came from Supabase rather than the
   * design fill. Compose can only send to these — their ids are organisation
   * ids — so it is passed through rather than derived here, where the two
   * kinds are already merged and indistinguishable by design.
   */
  /**
   * Every client Compose may address — see `buildAddressableClients`. Distinct
   * from the thread list on purpose: a client with no outreach yet has no
   * thread, but is still someone a CAM can write the first email to. This prop
   * replaced a `realThreads` one that fed the same directory, which is why
   * Compose could only ever find clients that had already been emailed.
   */
  addressableClients?: AddressableClient[];
  /** The viewer's own first-follow-up threshold, in days (F160). */
  followUpDays?: number;
  /**
   * This viewer's stored mailbox flags, straight from INBOX_THREAD_STATE. The
   * shell needs no viewer id of its own: the rows are already scoped to the
   * caller by the table's RLS, and the server action keys its writes the same
   * way.
   */
  initialThreadFlags?: InboxThreadStateRow[];
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  // The list exactly as the server built it. Everything downstream reads
  // `threads` below, which is this with the viewer's own flags laid over it.
  const [serverThreads, setServerThreads] = useState<InboxThreadView[]>(initialThreads);
  /**
   * Starred / read / trashed, as this viewer last left them.
   *
   * Read from INBOX_THREAD_STATE by the page and seeded into the store during
   * render, not in an effect: an effect would give one paint with no flags at
   * all, so every starred thread would flicker unstarred on load. `seedThreadFlags`
   * identity-compares the rows, so calling it each render is a no-op until the
   * server actually sends new ones.
   *
   * The flags stay a pure overlay (`applyThreadFlags`) rather than being baked
   * into the thread list, because the list is server data and these are not.
   */
  seedThreadFlags(initialThreadFlags);
  const threadFlags: ThreadFlags = useSyncExternalStore(
    subscribeToThreadFlags,
    getThreadFlagsSnapshot,
    getThreadFlagsServerSnapshot,
  );

  /**
   * Applies a flag change optimistically, then persists it.
   *
   * `updates` is the list the server action receives, so a bulk action is one
   * round trip rather than one per thread. A failed write rolls the store back
   * and surfaces the reason — a star that silently failed to save is worse
   * than one that visibly refuses.
   */
  const commitFlags = useCallback(
    (update: (previous: ThreadFlags) => ThreadFlags, updates: InboxThreadFlagUpdate[]) => {
      setFlagError(null);
      void updateThreadFlags(
        update,
        () => applyInboxThreadFlags(updates),
        (message) => setFlagError(message),
      );
    },
    [],
  );
  const [activeFolder, setActiveFolder] = useState<GmailFolder>("inbox");
  const [activeCategoryTab, setActiveCategoryTab] = useState<GmailCategoryTab>("primary");
  // Unstar inside the Starred tab is not an instant vanish. The row stays put,
  // showing its now-empty star, for a grace beat; then it is dropped from the
  // list and AnimatePresence collapses it out. `graceUnstarIds` is the set
  // still being shown past the filter, `graceTimers` the pending drop timers.
  const [graceUnstarIds, setGraceUnstarIds] = useState<Set<string>>(new Set());
  const graceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const GRACE_UNSTAR_MS = 2200;
  const clearGraceUnstar = useCallback((id: string) => {
    const timer = graceTimers.current.get(id);
    if (timer) clearTimeout(timer);
    graceTimers.current.delete(id);
    setGraceUnstarIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);
  // Each held row carries its own drop timer (GRACE_UNSTAR_MS), so the set
  // drains itself even if the tab changes underneath it; this just sweeps any
  // still-pending timers if the whole screen unmounts.
  useEffect(() => {
    const timers = graceTimers.current;
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, []);
  // Sector filtering has two independent sources, kept apart on purpose: the
  // sidebar's label rows, and the search bar's "Filter by sector" chips. They
  // used to share one Set, so a search could only ever add to the sidebar's
  // selection and clearing one silently cleared the other.
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [searchSectorLabels, setSearchSectorLabels] = useState<Set<string>>(new Set());
  const router = useRouter();
  // The one genuine loading state on this screen: a refresh re-runs the server
  // component, and the list shows skeletons until React has the new tree.
  // There used to be a second, `isLabelLoading`, driven by an invented 1.5s
  // timer around an in-memory filter — see triggerLabelFilter.
  const [isRefreshing, startRefresh] = useTransition();
  // Set when a star / read / trash write is refused. The store has already put
  // the flag back by now, so the banner explains a change the CAM can see
  // has reverted.
  const [flagError, setFlagError] = useState<string | null>(null);
  // One-shot confirmations that outlive the window that earned them — a saved
  // draft closes its compose window, which would take a modal-local message
  // down with it. Bottom-left, auto-dismissed, latest wins.
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);
  function showToast(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, 3500);
  }
  // The mailbox's custom labels ARE tags (TAGS/ORG_TAGS). Seeded from the
  // page's server read and grown in place when the sidebar's + creates one, so
  // a new tag shows without a full refresh. A refresh re-seeds it (below).
  const [tags, setTags] = useState<InboxThreadTag[]>(initialTags);
  const [seededTagsFrom, setSeededTagsFrom] = useState(initialTags);
  if (seededTagsFrom !== initialTags) {
    setSeededTagsFrom(initialTags);
    setTags(initialTags);
  }
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Active thread ID initialized from props, never from window during SSR/initial render
  const [activeThreadId, setActiveThreadId] = useState<string | null>(initialThreadId ?? null);
  // Threads whose bodies are already in flight, so re-opening one mid-fetch
  // does not fire a second request for the same conversation.
  const hydratingRef = useRef<Set<string>>(new Set());

  // Sync state on popstate (browser back/forward button)
  useEffect(() => {
    const handlePopState = () => {
      const thread = new URLSearchParams(window.location.search).get("thread");
      setActiveThreadId(thread);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);
  /**
   * Open compose windows, oldest first, stacked right-to-left like Gmail's.
   *
   * Keyed by `key` — the outreach_messages id for a resumed draft, a generated
   * id for a blank compose. Opening a draft that is already open focuses that
   * window instead of adding a second: two windows over one row would race on
   * save, last write winning silently while both still showed their own text.
   *
   * At most MAX_EXPANDED_COMPOSERS are expanded at once. This window is denser
   * than Gmail's — AI settings drill, booklet and profile sheets, recipient
   * search, attachment staging — so a third expanded one would not fit beside
   * the sidebar on a laptop. A new window minimises the oldest expanded one
   * rather than letting the row overflow off-screen.
   */
  const [composers, setComposers] = useState<ComposeWindow[]>([]);
  const nextComposerKey = useRef(0);

  /**
   * Open a compose window, or focus the one already editing this draft.
   *
   * Reopening a draft restores rather than duplicates, which is what keeps two
   * windows off one outreach_messages row. Opening past the expanded cap
   * minimises the oldest expanded window instead of refusing to open — the CAM
   * asked for this draft, so it appears; something else gets out of the way.
   */
  const openComposer = useCallback((spec: Omit<ComposeWindow, "key" | "minimised">) => {
    setComposers((open) => {
      if (spec.draftId) {
        const existing = open.find((w) => w.draftId === spec.draftId);
        if (existing) return open.map((w) => (w === existing ? { ...w, minimised: false } : w));
      }
      const key = spec.draftId ?? `new:${nextComposerKey.current++}`;
      let next = [...open, { ...spec, key, minimised: false }];
      const expanded = next.filter((w) => !w.minimised);
      if (expanded.length > MAX_EXPANDED_COMPOSERS) {
        const oldest = expanded[0];
        next = next.map((w) => (w === oldest ? { ...w, minimised: true } : w));
      }
      return next;
    });
  }, []);

  const closeComposer = useCallback((key: string) => {
    setComposers((open) => open.filter((w) => w.key !== key));
  }, []);

  const setComposerMinimised = useCallback((key: string, minimised: boolean) => {
    setComposers((open) => {
      const next = open.map((w) => (w.key === key ? { ...w, minimised } : w));
      if (minimised) return next;
      // Restoring one may push the row over the cap; the oldest other expanded
      // window yields, never the one just restored.
      const expanded = next.filter((w) => !w.minimised);
      if (expanded.length <= MAX_EXPANDED_COMPOSERS) return next;
      const victim = expanded.find((w) => w.key !== key);
      return victim ? next.map((w) => (w === victim ? { ...w, minimised: true } : w)) : next;
    });
  }, []);

  /**
   * Right-edge offset for each window, stacked right-to-left in open order so
   * a window never moves because a different one was minimised beside it.
   */
  /**
   * ?compose=<organisation id> arrives from the client record's "Write to this
   * client" link. Resolved against the addressable directory so the window
   * opens with a real recipient already saved rather than a raw id; an id that
   * matches nothing the viewer can email opens a blank window instead of
   * silently doing nothing.
   */
  useEffect(() => {
    if (!initialComposeClientId) return;
    const client = addressableClients?.find((c) => c.id === initialComposeClientId);
    openComposer({ draftId: null, recipient: client?.primaryContact?.email ?? undefined });
    // Deliberately once per mount: the page remounts on a new ?compose= (its
    // key includes the param), so this must not reopen on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const composerOffsets = useMemo(() => {
    const offsets: number[] = [];
    let right = COMPOSER_EDGE_PX;
    for (let i = composers.length - 1; i >= 0; i -= 1) {
      offsets[i] = right;
      right += (composers[i]!.minimised ? COMPOSER_MINIMISED_WIDTH_PX : COMPOSER_WIDTH_PX) + COMPOSER_GAP_PX;
    }
    return offsets;
  }, [composers]);
  const [pageIndex, setPageIndex] = useState(0);
  const [isAtBottom, setIsAtBottom] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  // The dropdown previews it live; Enter applies it to the list.
  const [liveQuery, setLiveQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [appliedDateValues, setAppliedDateValues] = useState<string[]>([]);
  const [appliedStatusValues, setAppliedStatusValues] = useState<string[]>([]);

  // A refresh re-runs the server component and hands down a new list; without
  // this the shell would keep rendering the threads it mounted with and the
  // refresh button would spin over stale rows. Adjusted during render rather
  // than in an effect — React's own pattern for "reset state when a prop
  // changes", and it avoids a second render pass showing the stale list.
  const [seededFrom, setSeededFrom] = useState(initialThreads);
  if (seededFrom !== initialThreads) {
    setSeededFrom(initialThreads);
    setServerThreads(initialThreads);
  }

  /** What the whole shell renders: server threads under this viewer's flags. */
  const threads = useMemo(
    () => applyThreadFlags(serverThreads, threadFlags),
    [serverThreads, threadFlags],
  );

  // Tags rendered as sidebar label rows: a tag's palette colour, or the deep
  // lead the sidebar already falls a colourless label back to.
  const customLabels = useMemo<SidebarLabel[]>(
    () => tags.map((tag) => ({ name: tag.name, bg: tag.colour ?? "var(--lead)" })),
    [tags],
  );

  const allLabels = useMemo(
    () => [...SECTORS, ...customLabels],
    [customLabels],
  );

  // organisation_id → its tags, so the compose window's "Add label" picker can
  // mark what is already on a client. Built from the server threads because
  // that is where the per-org tag lists were merged in.
  const tagsByClientId = useMemo(() => {
    const map = new Map<string, InboxThreadTag[]>();
    for (const thread of serverThreads) {
      if (thread.tags && thread.tags.length > 0) map.set(thread.id, thread.tags);
    }
    return map;
  }, [serverThreads]);

  const labelColorMap = useMemo(() => {
    const map = new Map<string, string>();
    allLabels.forEach((l) => map.set(l.name, l.bg));
    if (map.has("Health & Well-being") && !map.has("Health & Wellbeing")) {
      map.set("Health & Wellbeing", map.get("Health & Well-being")!);
    }
    return map;
  }, [allLabels]);

  /** What the list actually filters on: the sidebar's labels plus the search
      bar's sector chips. */
  const appliedLabels = useMemo(
    () => new Set([...selectedLabels, ...searchSectorLabels]),
    [selectedLabels, searchSectorLabels],
  );

  const activeLabels = useMemo(() => {
    return Array.from(appliedLabels).map((name) => ({
      name,
      bg: labelColorMap.get(name) ?? "var(--lead)",
    }));
  }, [appliedLabels, labelColorMap]);

  // Threads matching the applied query, for the list filter below.
  const queryMatchIds = useMemo(
    () => new Set(searchThreads(threads, appliedQuery).map((thread) => thread.id)),
    [threads, appliedQuery],
  );

  // Date ranges from the applied date selections (several combine with OR,
  // like every other multi-select here). Unparseable values resolve to null
  // and are ignored rather than matching nothing.
  const dateRanges = useMemo(() => {
    const now = new Date();
    return appliedDateValues
      .map((value) => resolveDateFilter(value, now))
      .filter((range): range is { from: number; to: number } => range !== null);
  }, [appliedDateValues]);

  // Filter threads based on folder, category tab, label, and the applied
  // search query (Enter in the bar; the dropdown previews it live).
  const filteredThreads = useMemo(() => {
    return threads.filter((thread) => {
      // 1. Folder filter
      if (activeFolder === "starred") {
        if (!thread.isStarred) return false;
        // Starring is a flag on a thread, not a folder, so this branch has to
        // exclude trash itself: it was the only folder filter testing nothing
        // but the star, which left a starred thread visible here after it was
        // trashed. A starred draft or scheduled email is deliberately still
        // listed — clicking a draft opens the composer, so it is reachable
        // rather than misleading.
        if (thread.folder === "trash") return false;
      } else if (activeFolder === "sent") {
        if (thread.folder === "trash" || thread.folder === "scheduled") return false;
        const hasSent =
          thread.folder === "sent" ||
          thread.status === "sent" ||
          thread.messages.some((m) => !m.isFromClient);
        if (!hasSent) return false;
      } else if (activeFolder === "scheduled") {
        if (thread.folder !== "scheduled") return false;
      } else if (activeFolder === "drafts") {
        if (thread.folder !== "drafts") return false;
      } else if (activeFolder === "trash") {
        if (thread.folder !== "trash") return false;
      } else {
        // Inbox folder: exclude trash, and anything still waiting on its
        // scheduled send — it has not been sent yet, so it is not a thread.
        if (thread.folder === "trash" || thread.folder === "scheduled") return false;
      }

      // 2. Sector / Label filter (multi-select / additive). A built-in sector
      //    label matches thread.sector; a tag label matches one of the thread's
      //    tags — see threadMatchesLabels.
      if (!threadMatchesLabels(thread, appliedLabels)) return false;

      // 3. Category Tab filter (only applies inside Inbox when no label filter is active)
      if (activeFolder === "inbox" && appliedLabels.size === 0) {
        if (activeCategoryTab === "inbound") {
          if (thread.status !== "replied") return false;
        } else if (activeCategoryTab === "awaiting") {
          if (thread.status !== "awaiting") return false;
        } else if (activeCategoryTab === "followup") {
          if (!isFollowUpDue(thread, followUpDays)) return false;
        } else if (activeCategoryTab === "starred") {
          if (!thread.isStarred && !graceUnstarIds.has(thread.id)) return false;
        } else if (activeCategoryTab === "sent") {
          if (thread.status !== "sent") return false;
        }
      }

      // 4. Search query filter
      if (appliedQuery.trim() && !queryMatchIds.has(thread.id)) return false;

      // 5. Date filter (panel selections, applied on submit)
      if (dateRanges.length > 0) {
        const sentAt = new Date(thread.lastActivityAt).getTime();
        const inRange = dateRanges.some(
          (range) => sentAt >= range.from && sentAt <= range.to,
        );
        if (!inRange) return false;
      }

      // 6. Status filter (panel selections, applied on submit)
      if (appliedStatusValues.length > 0) {
        if (!appliedStatusValues.includes(thread.status)) return false;
      }

      return true;
    });
  }, [threads, activeFolder, activeCategoryTab, appliedLabels, queryMatchIds, appliedQuery, dateRanges, appliedStatusValues, followUpDays, graceUnstarIds]);

  // Paginated slice
  const paginatedThreads = useMemo(() => {
    const start = pageIndex * PAGE_SIZE;
    return filteredThreads.slice(start, start + PAGE_SIZE);
  }, [filteredThreads, pageIndex]);

  // Folder Counts
  const unreadCount = useMemo(
    () => threads.filter((t) => !t.isRead && t.folder === "inbox").length,
    [threads]
  );
  const starredCount = useMemo(
    () => threads.filter((t) => t.isStarred && t.folder !== "trash").length,
    [threads]
  );
  const followUpDueCount = useMemo(
    () => threads.filter((t) => t.folder !== "trash" && isFollowUpDue(t, followUpDays)).length,
    [threads, followUpDays]
  );
  // Category-tab counts mirror each tab's own filter (see the category filter
  // block in filteredThreads): the Inbox view, trash/scheduled excluded.
  const inboxScoped = (t: InboxThreadView) =>
    t.folder !== "trash" && t.folder !== "scheduled";
  const inboundCount = useMemo(
    () => threads.filter((t) => inboxScoped(t) && t.status === "replied").length,
    [threads]
  );
  const awaitingCount = useMemo(
    () => threads.filter((t) => inboxScoped(t) && t.status === "awaiting").length,
    [threads]
  );
  const categoryBadgeCounts = useMemo<CategoryBadgeCounts>(
    () => ({
      inbound: inboundCount,
      awaiting: awaitingCount,
      followUpDue: followUpDueCount,
    }),
    [inboundCount, awaitingCount, followUpDueCount]
  );
  const scheduledCount = useMemo(
    () => threads.filter((t) => t.folder === "scheduled").length,
    [threads]
  );
  const sentCount = useMemo(
    () =>
      threads.filter(
        (t) =>
          t.folder !== "trash" &&
          t.folder !== "scheduled" &&
          (t.folder === "sent" ||
            t.status === "sent" ||
            t.messages.some((m) => !m.isFromClient))
      ).length,
    [threads]
  );
  const draftsCount = useMemo(
    () => threads.filter((t) => t.folder === "drafts").length,
    [threads]
  );
  const trashCount = useMemo(
    () => threads.filter((t) => t.folder === "trash").length,
    [threads]
  );
  // Threads per sector label, in the view a label tap lands on (the inbox,
  // trash excluded) — so each chip's number is exactly how many threads
  // selecting it will reveal.
  const labelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    threads.forEach((thread) => {
      if (thread.folder === "trash") return;
      counts[thread.sector] = (counts[thread.sector] ?? 0) + 1;
    });
    return counts;
  }, [threads]);

  // Selection State
  const selectionState: SelectionState = useMemo(() => {
    if (paginatedThreads.length === 0 || selectedIds.size === 0) return "none";
    const allSelected = paginatedThreads.every((t) => selectedIds.has(t.id));
    if (allSelected) return "all";
    return "some";
  }, [paginatedThreads, selectedIds]);

  // Active Thread
  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId),
    [threads, activeThreadId]
  );

  // Keep `?thread=` in step with what is open, so the URL is always a link to
  // the current view — copyable, and what a new tab reads on load. `replace`,
  // not `push`: opening threads should not stack up in the back button.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const currentThread = url.searchParams.get("thread");
    if (activeThreadId) {
      if (currentThread !== activeThreadId) {
        url.searchParams.set("thread", activeThreadId);
        window.history.replaceState(null, "", url);
      }
    } else if (currentThread !== null) {
      url.searchParams.delete("thread");
      window.history.replaceState(null, "", url);
    }
  }, [activeThreadId]);

  const threadHref = (threadId: string) => `?thread=${encodeURIComponent(threadId)}`;

  // Owner options for the search panel, derived from whoever holds threads
  // right now — the mock set has no team endpoint, so the data is the list.
  const ownerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    threads.forEach((thread) => {
      if (!seen.has(thread.camOwner.email)) {
        seen.set(thread.camOwner.email, thread.camOwner.name);
      }
    });
    return [
      { label: "Unassigned", value: "unassigned" },
      ...[...seen.entries()].map(([value, label]) => ({ label, value })),
    ];
  }, [threads]);

  // Suggestion rows for the bar's dropdown, recomputed on every keystroke.
  const suggestions = useMemo(
    () =>
      searchThreads(threads, liveQuery)
        .slice(0, 6)
        .map((thread) => ({
          id: thread.id,
          title: thread.subject,
          subtitle: `${thread.orgName} · ${thread.primaryContact.name}`,
          meta: formatGmailTimestamp(thread.lastActivityAt),
        })),
    [threads, liveQuery],
  );

  const handleListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const atBottom =
      scrollHeight <= clientHeight ||
      scrollTop + clientHeight >= scrollHeight - 8;
    setIsAtBottom((prev) => (prev !== atBottom ? atBottom : prev));
  };

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    const checkAtBottom = () => {
      const atBottom =
        el.scrollHeight <= el.clientHeight ||
        el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
      setIsAtBottom((prev) => (prev !== atBottom ? atBottom : prev));
    };

    checkAtBottom();

    const observer = new ResizeObserver(checkAtBottom);
    observer.observe(el);
  }, [paginatedThreads, activeCategoryTab, activeFolder, appliedLabels, activeThreadId]);

  /**
   * Applies a label filter.
   *
   * The 1.5s delay that used to sit here was simulated — a spinner invented to
   * make an instant, in-memory `Array.filter` feel like it had gone somewhere.
   * Against real threads it was a second and a half of nothing, every time a
   * sector was toggled, so it is gone: the filter applies on the same tick.
   */
  function triggerLabelFilter(nextLabels: Set<string>) {
    setSelectedLabels(nextLabels);
    setPageIndex(0);
    listRef.current?.scrollTo({ top: 0 });
  }

  function handleToggleLabel(labelName: string) {
    const next = new Set(selectedLabels);
    if (next.has(labelName)) {
      next.delete(labelName);
    } else {
      next.add(labelName);
    }
    setActiveThreadId(null);
    triggerLabelFilter(next);
  }

  /* The chip row above the list shows the union of both sources, so removing
     one has to reach both — a sector chip that arrived from the search bar
     would otherwise be undeletable from here. */
  function handleRemoveLabel(labelName: string) {
    const next = new Set(selectedLabels);
    next.delete(labelName);
    setSearchSectorLabels((prev) => {
      if (!prev.has(labelName)) return prev;
      const remaining = new Set(prev);
      remaining.delete(labelName);
      return remaining;
    });
    triggerLabelFilter(next);
  }

  function handleClearAllLabels() {
    setSearchSectorLabels(new Set());
    triggerLabelFilter(new Set());
  }

  /**
   * The sidebar's + creates a real tag (TAGS). On success it joins `tags`, so
   * the new label row and its filter work at once without a refresh; the next
   * server render re-seeds `tags` from `initialTags` and this optimistic entry
   * is replaced by the canonical one.
   */
  async function handleCreateLabel(
    name: string,
    colour: string | null,
  ): Promise<{ ok: boolean; message?: string }> {
    const result = await createTagAction(name, colour);
    if (!result.ok) {
      return { ok: false, message: result.message };
    }
    setTags((prev) =>
      prev.some((tag) => tag.id === result.tag.id)
        ? prev
        : [...prev, { id: result.tag.id, name: result.tag.name, colour: result.tag.colour ?? null }],
    );
    return { ok: true };
  }

  // Handlers
  function handleSelectThread(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  }

  function handleSelectAll() {
    setSelectedIds(new Set(paginatedThreads.map((t) => t.id)));
  }

  function handleDeselectAll() {
    setSelectedIds(new Set());
  }

  function handleSelectRead() {
    setSelectedIds(new Set(paginatedThreads.filter((t) => t.isRead).map((t) => t.id)));
  }

  function handleSelectUnread() {
    setSelectedIds(new Set(paginatedThreads.filter((t) => !t.isRead).map((t) => t.id)));
  }

  function handleSelectStarred() {
    setSelectedIds(new Set(paginatedThreads.filter((t) => t.isStarred).map((t) => t.id)));
  }

  /* Star / read / trash write to the viewer's flags rather than editing the
     thread list in place. Same visible behaviour, except that it now survives
     a reload: these edits used to live only in React state, so every one of
     them was undone by the next navigation. See @/lib/inbox/thread-flags. */

  function setStarred(ids: readonly string[], starred: boolean) {
    commitFlags(
      (prev) => {
        const next = new Set(prev.starred);
        ids.forEach((id) => (starred ? next.add(id) : next.delete(id)));
        return { ...prev, starred: next };
      },
      ids.map((organisationId) => ({ organisationId, isStarred: starred })),
    );
  }

  /** Read state has two override sets, since both directions are deliberate —
      a marked-unread thread must not be flipped back by the server's own
      derivation on the next load. */
  function setRead(ids: readonly string[], read: boolean) {
    commitFlags(
      (prev) => {
        const nextRead = new Set(prev.read);
        const nextUnread = new Set(prev.unread);
        ids.forEach((id) => {
          if (read) {
            nextRead.add(id);
            nextUnread.delete(id);
          } else {
            nextUnread.add(id);
            nextRead.delete(id);
          }
        });
        return { ...prev, read: nextRead, unread: nextUnread };
      },
      ids.map((organisationId) => ({ organisationId, read })),
    );
  }

  function setTrashed(ids: readonly string[]) {
    commitFlags(
      (prev) => {
        const next = new Set(prev.trashed);
        ids.forEach((id) => next.add(id));
        return { ...prev, trashed: next };
      },
      ids.map((organisationId) => ({ organisationId, isTrashed: true })),
    );
  }

  function handleToggleStar(id: string) {
    const thread = threads.find((t) => t.id === id);
    const wasStarred = !!thread?.isStarred;
    setStarred([id], !wasStarred);

    const inStarredTab =
      activeFolder === "inbox" &&
      appliedLabels.size === 0 &&
      activeCategoryTab === "starred";

    if (inStarredTab && wasStarred && !reduceMotion) {
      // Just unstarred while looking at the Starred tab: hold the row in place
      // for a grace beat before it is dropped and animated out.
      setGraceUnstarIds((prev) => new Set(prev).add(id));
      const timer = setTimeout(() => clearGraceUnstar(id), GRACE_UNSTAR_MS);
      graceTimers.current.set(id, timer);
    } else if (graceTimers.current.has(id)) {
      // Re-starred during the grace beat: cancel the drop, the row stays.
      clearGraceUnstar(id);
    }
  }

  function handleToggleRead(id: string) {
    const thread = threads.find((t) => t.id === id);
    setRead([id], !thread?.isRead);
  }

  function handleDeleteThread(id: string) {
    setTrashed([id]);
    if (activeThreadId === id) setActiveThreadId(null);
  }

  /**
   * The reading pane's scheduled-send controls. Cancel returns the row to
   * draft; edit cancels first (a schedule is a commitment to exact content —
   * editing in place would break that) and reopens the text in Compose. Both
   * resolve with an error to show or null: success closes the pane and
   * refetches, since the thread just changed folders.
   */
  async function handleCancelScheduled(
    thread: InboxThreadView,
    messageId: string,
  ): Promise<string | null> {
    const result = await cancelScheduledEmail({ organisationId: thread.id, messageId });
    if (!result.ok) return result.message;
    setActiveThreadId(null);
    router.refresh();
    return null;
  }

  async function handleEditScheduled(
    thread: InboxThreadView,
    messageId: string,
  ): Promise<string | null> {
    const entry = thread.messages.find((message) => message.id === messageId);
    const result = await cancelScheduledEmail({ organisationId: thread.id, messageId });
    if (!result.ok) return result.message;
    openComposer({
      draftId: messageId,
      recipient: thread.primaryContact?.email ?? undefined,
      subject: thread.subject,
      body: entry?.body ? emailHtmlToPlainText(entry.body) : undefined,
    });
    setActiveThreadId(null);
    router.refresh();
    return null;
  }

  // Bulk Handlers
  function handleMarkAsRead() {
    setRead([...selectedIds], true);
    setSelectedIds(new Set());
  }

  function handleMarkAsUnread() {
    setRead([...selectedIds], false);
    setSelectedIds(new Set());
  }

  /** Gmail's own rule for a mixed selection: if anything is unstarred, star
      everything; only an all-starred selection unstars. */
  function handleToggleStarSelected() {
    const selected = threads.filter((t) => selectedIds.has(t.id));
    const starring = selected.some((t) => !t.isStarred);
    setStarred(selected.map((t) => t.id), starring);
    setSelectedIds(new Set());
  }

  function handleDeleteSelected() {
    setTrashed([...selectedIds]);
    setSelectedIds(new Set());
    if (activeThreadId && selectedIds.has(activeThreadId)) {
      setActiveThreadId(null);
    }
  }

  /**
   * Refresh actually refetches now.
   *
   * It used to be a 450ms spinner over unchanged state — the one control on
   * the screen whose entire job is "show me what arrived since", doing nothing
   * of the kind. `router.refresh()` re-runs the server component, so the four
   * table reads behind the list run again and new replies appear; the spinner
   * runs until React has the new tree.
   */
  function handleRefresh() {
    startRefresh(() => {
      router.refresh();
    });
  }

  function handleOpenThread(thread: InboxThreadView) {
    // A draft is not something you can read — it is an email you have not
    // finished writing — so opening one resumes it in a compose window rather
    // than rendering a reading pane for a message nobody ever received. The
    // test is the thread's folder, not the current one, so this holds wherever
    // the draft was clicked: Drafts, Starred, search results.
    if (thread.folder === "drafts") {
      void resumeDraft(thread);
      return;
    }
    // Mark as read automatically when opening
    setRead([thread.id], true);
    setActiveThreadId(thread.id);
    void hydrate(thread);
  }

  /**
   * Open a draft thread in a compose window, with whatever it already holds.
   *
   * The list query omits message bodies (see `hydrate`), so the body is fetched
   * first and the window opens with the real text rather than blank. A failed
   * fetch still opens the window — on the draft's own row, with recipient and
   * subject — because losing the body is better than the click doing nothing.
   */
  async function resumeDraft(thread: InboxThreadView) {
    const hydrated = await hydrate(thread).catch(() => null);
    const source = hydrated ?? thread;
    // A thread with history holds old sent mail too — resuming means the
    // unsent text, scheduled first (it wins ties everywhere else), else the
    // draft, else whatever is newest. Before queued rows hydrated, this took
    // the last message outright and a draft reopened showing old sent mail.
    const pending =
      source.messages.find((message) => message.pendingKind === "scheduled") ??
      source.messages.find((message) => message.pendingKind === "draft");
    const last = pending ?? source.messages[source.messages.length - 1];
    openComposer({
      draftId: pending?.id ?? last?.id ?? thread.id,
      recipient: thread.primaryContact?.email ?? undefined,
      subject: thread.subject,
      body: last?.body ? emailHtmlToPlainText(last.body) : undefined,
    });
  }

  /**
   * Message bodies arrive per thread, on open.
   *
   * The list query deliberately does not select `outreach_messages.body` —
   * pulling every email's HTML for every organisation would move megabytes on
   * every page load, to render subjects and one-line snippets. A real thread
   * therefore reaches the browser with `messages: []`, and an empty `messages`
   * is exactly the signal that it has not been hydrated yet. Mock fill arrives
   * with its conversation already attached, so it never asks the server for
   * one that does not exist.
   */
  async function hydrate(thread: InboxThreadView) {
    if (thread.messages.length > 0 || hydratingRef.current.has(thread.id)) return;
    hydratingRef.current.add(thread.id);
    try {
      const response = await fetch(`/api/inbox/${thread.id}/thread`);
      if (!response.ok) return;
      const hydrated = (await response.json()) as InboxThreadView;
      // Message bodies are server data, not a viewer flag — they belong on the
      // underlying list.
      setServerThreads((prev) =>
        prev.map((t) => (t.id === thread.id ? { ...t, messages: hydrated.messages } : t)),
      );
    } catch {
      // A failed hydration leaves the pane's header and metadata intact; the
      // conversation simply stays empty rather than the thread failing to open.
    } finally {
      hydratingRef.current.delete(thread.id);
    }
  }

  // A thread reached by deep link (?thread=, or a browser back) opens without
  // anyone clicking a row, so it needs the same body fetch handleOpenThread
  // does. `hydrate` no-ops on a thread that already has its messages, which is
  // what keeps this from re-fetching on every unrelated re-render.
  useEffect(() => {
    if (!activeThreadId) return;
    const thread = threads.find((candidate) => candidate.id === activeThreadId);
    if (thread) void hydrate(thread);
  }, [activeThreadId, threads]);

  function handleSendNewOutreach(message: {
    to: string;
    subject: string;
    body: string;
    /** ISO instant when a scheduled send is due; absent means send now. */
    scheduledFor?: string;
  }) {
    const now = new Date().toISOString();
    const isScheduled = Boolean(message.scheduledFor);
    const newThread: InboxThreadView = {
      id: `new-thread-${Date.now()}`,
      orgName: message.to.includes("@") ? message.to.split("@")[0].toUpperCase() : message.to,
      orgType: "Partner Organisation",
      city: "London",
      country: "United Kingdom",
      sector: "Charities & NGOs",
      labelColor: "#0ea5e9",
      primaryContact: {
        name: message.to,
        role: "Primary Contact",
        email: message.to,
      },
      camOwner: {
        name: "Ada Lovelace",
        email: "ada.lovelace@180dc.org",
      },
      status: "sent",
      subject: message.subject,
      snippet: message.body.slice(0, 120),
      lastActivityAt: now,
      isRead: true,
      isStarred: false,
      isImportant: false,
      folder: isScheduled ? "scheduled" : "sent",
      scheduledFor: message.scheduledFor,
      attachments: [],
      notesCount: 0,
      handoversCount: 0,
      tags: [],
      messages: [
        {
          id: `msg-${Date.now()}`,
          senderName: "Ada Lovelace",
          senderEmail: "ada.lovelace@180dc.org",
          recipientName: message.to,
          recipientEmail: message.to,
          sentAt: now,
          subject: message.subject,
          body: message.body,
          isFromClient: false,
        },
      ],
    };

    setServerThreads((prev) => [newThread, ...prev]);
  }

  return (
    <div className={`flex flex-col w-full gap-2 font-sans bg-[#f6f8fc] min-h-0 overflow-hidden pt-2 ${className}`}>
      {/* Header: compose and search share one line, always. The compose box
          mirrors the sidebar's width, so the search starts where the surface
          starts and the sidebar's Inbox row meets the surface top. */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-56 shrink-0 pr-3">
          <div className="px-1">
            <button
              onClick={() => openComposer({ draftId: null })}
              type="button"
              className="flex items-center gap-3 rounded-2xl bg-[#c2e7ff] hover:bg-[#b3dcf8] active:scale-[0.98] transition-all px-5 py-3.5 shadow-sm text-slate-800 font-semibold text-sm hover:shadow-md cursor-pointer"
            >
              <Pencil className="h-5 w-5 text-slate-900 stroke-[2.5]" />
              <span>Compose</span>
            </button>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <BrandSearchBar
            tone="light"
            clearRowOnOpen
            placeholder="Search"
            busy={isRefreshing}
            subjects={["organisations", "contacts", "subjects"]}
            onQueryChange={setLiveQuery}
            suggestions={suggestions}
            onSuggestionSelect={(id) => {
              const thread = threads.find((t) => t.id === id);
              if (thread) handleOpenThread(thread);
            }}
            onSubmitQuery={(query, filters) => {
              /* A submission is the whole filter state, not a set of additions.
                 The sector chips used to be UNIONED into `selectedLabels`,
                 which meant a search could only ever add sectors — clearing
                 the chips and searching again left the old ones applied — and
                 a later "clear" branch then wiped the SIDEBAR's label
                 selection too, which the search bar had never touched. The two
                 sources are kept apart now: the bar owns `searchSectorLabels`,
                 the sidebar owns `selectedLabels`, and the list filters on the
                 union of the two (see `appliedLabels`). Submitting with no
                 sector chips clears the bar's contribution and leaves the
                 sidebar's alone. */
              setAppliedQuery(query);
              setAppliedDateValues(
                filters
                  .filter((filter) => filter.category === DATE_CATEGORY)
                  .map((filter) => filter.value),
              );
              setAppliedStatusValues(
                filters
                  .filter((filter) => filter.category === "Filter by status")
                  .map((filter) => filter.value),
              );
              setSearchSectorLabels(
                new Set(
                  filters
                    .filter((filter) => filter.category === "Filter by sector")
                    .map((filter) => {
                      const opt = SECTOR_FILTER_OPTIONS.find((s) => s.value === filter.value);
                      return opt ? opt.label : filter.label || filter.value;
                    }),
                ),
              );
              setPageIndex(0);
              listRef.current?.scrollTo({ top: 0 });
            }}
            recentKey="preview-inbox-before"
            chipsBelow={false}
            categories={{
              [DATE_CATEGORY]: DATE_OPTIONS,
              "Filter by sector": SECTOR_FILTER_OPTIONS,
              "Filter by status": [
                { label: "Replied", value: "replied" },
                { label: "Awaiting response", value: "awaiting" },
                { label: "Sent", value: "sent" },
              ],
              "Filter by owner": ownerOptions,
              "Filter by organisation type": ORGANISATION_TYPES.map((value) => ({
                label: formatOrganisationType(value),
                value,
              })),
              "Filter by priority score": PRIORITY_SCORE_FILTERS.map((band) => ({
                label: band.label,
                value: band.value,
              })),
            }}
            params={{
              [DATE_CATEGORY]: "date",
              "Filter by sector": "sector",
              "Filter by status": "status",
              "Filter by owner": "owner",
              "Filter by organisation type": "type",
              "Filter by priority score": "score",
            }}
          />
        </div>
      </div>

      {/* Content row: nav + surface share whatever height remains. */}
      <div className="flex flex-1 min-h-0 gap-2">
      {/* Left Gmail Navigation */}
      <GmailSidebar
        activeFolder={activeFolder}
        onSelectFolder={(folder) => {
          setSelectedLabels(new Set());
          setSearchSectorLabels(new Set());
          setActiveFolder(folder);
          setActiveThreadId(null);
          listRef.current?.scrollTo({ top: 0 });
        }}
        selectedLabels={selectedLabels}
        onToggleLabel={handleToggleLabel}
        onClearLabels={handleClearAllLabels}
        unreadCount={unreadCount}
        starredCount={starredCount}
        scheduledCount={scheduledCount}
        sentCount={sentCount}
        draftsCount={draftsCount}
        trashCount={trashCount}
        labelCounts={labelCounts}
        customLabels={customLabels}
        onCreateLabel={handleCreateLabel}
      />

      {/* Right Column: the mail surface fills the content row. */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
      {/* Main Mail Surface (borderless, shadowless) */}
      <div
        className={`flex-1 flex flex-col min-w-0 min-h-0 bg-white rounded-t-panel overflow-hidden transition-[border-radius] duration-200 ${
          activeThread || isAtBottom ? "rounded-b-panel" : "rounded-b-none"
        }`}
      >
        {/* Full conversation reading view */}
        {activeThread ? (
          <GmailReadingPane
            thread={activeThread}
            onBack={() => setActiveThreadId(null)}
            onToggleStar={handleToggleStar}
            onDelete={handleDeleteThread}
            onMarkUnread={(id) => {
              handleToggleRead(id);
              setActiveThreadId(null);
            }}
            onCancelScheduled={(messageId) => handleCancelScheduled(activeThread, messageId)}
            onEditScheduled={(messageId) => handleEditScheduled(activeThread, messageId)}
          />
        ) : (
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {/* A refused star / read / trash. The store has already reverted
                the flag by now, so this says why the row changed back rather
                than leaving the CAM to notice it silently. Dismissable, and
                cleared by the next successful write. */}
            {flagError && (
              <div
                className="mx-3 mt-3 flex items-start justify-between gap-3 rounded-panel border border-stop/25 bg-stop-wash px-3 py-2"
                role="alert"
              >
                <p className="text-xs font-semibold text-stop">{flagError}</p>
                <button
                  aria-label="Dismiss"
                  className="shrink-0 text-stop/70 transition-colors hover:text-stop"
                  onClick={() => setFlagError(null)}
                  type="button"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Top Toolbar */}
            <div className="p-3">
              <GmailActionBar
                selectionState={selectionState}
                selectedCount={selectedIds.size}
                totalCount={filteredThreads.length}
                onSelectAll={handleSelectAll}
                onDeselectAll={handleDeselectAll}
                onSelectRead={handleSelectRead}
                onSelectUnread={handleSelectUnread}
                onSelectStarred={handleSelectStarred}
                onRefresh={handleRefresh}
                isRefreshing={isRefreshing}
                onMarkAsRead={handleMarkAsRead}
                onMarkAsUnread={handleMarkAsUnread}
                onToggleStarSelected={handleToggleStarSelected}
                onDeleteSelected={handleDeleteSelected}
                pageIndex={pageIndex}
                pageSize={PAGE_SIZE}
                onPrevPage={() => {
                  setPageIndex(Math.max(0, pageIndex - 1));
                  listRef.current?.scrollTo({ top: 0 });
                }}
                onNextPage={() => {
                  setPageIndex(pageIndex + 1);
                  listRef.current?.scrollTo({ top: 0 });
                }}
                activeLabels={activeLabels}
                onRemoveLabel={handleRemoveLabel}
                onClearAllLabels={handleClearAllLabels}
              />
            </div>

            {/* Gmail Category Tabs (Only on Inbox folder when no label filters are active) */}
            {activeFolder === "inbox" && appliedLabels.size === 0 && (
              <div
                role="tablist"
                aria-label="Inbox categories"
                className="flex items-center gap-1 border-b border-rule-soft px-1 text-xs select-none"
              >
                {CATEGORY_TABS.map((tab) => {
                  const TabIcon = tab.icon;
                  const isSelected = activeCategoryTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={isSelected}
                      onClick={() => {
                        if (activeCategoryTab !== tab.id) {
                          setActiveCategoryTab(tab.id);
                          setPageIndex(0);
                        }
                        listRef.current?.scrollTo({ top: 0 });
                      }}
                      className={`relative flex items-center gap-2.5 px-6 py-3 font-semibold font-body text-sm transition-colors cursor-pointer ${
                        isSelected
                          ? tab.activeTextClass
                          : "text-dim hover:bg-paper hover:text-ink"
                      }`}
                    >
                      <TabIcon className={`h-4 w-4 ${tab.iconClass ?? ""}`} />
                      <span>{tab.label}</span>
                      {tab.renderBadge?.(categoryBadgeCounts)}
                      {isSelected && (
                        <motion.span
                          layoutId="activeCategoryTabIndicator"
                          aria-hidden="true"
                          className={`absolute inset-x-0 bottom-0 h-[3px] rounded-t-full ${tab.indicatorBg}`}
                          transition={
                            reduceMotion
                              ? { duration: 0 }
                              : { type: "spring", stiffness: 450, damping: 32 }
                          }
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Thread List Table */}
            <div
              ref={listRef}
              onScroll={handleListScroll}
              className="flex-1 min-h-0 overflow-y-auto"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={
                    activeFolder === "inbox" && appliedLabels.size === 0
                      ? activeCategoryTab
                      : `${activeFolder}-${Array.from(appliedLabels).join(",")}`
                  }
                  initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                  className="min-h-full"
                >
                  {isRefreshing ? (
                    <div className="divide-y divide-rule-soft animate-pulse" aria-label="Loading threads…">
                      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                        <div
                          key={i}
                          className="flex items-center gap-3 border-b border-rule-soft px-3 py-3"
                        >
                          <div className="flex items-center gap-1.5 shrink-0">
                            <div className="h-4 w-4 rounded bg-paper-sunk" />
                            <div className="h-4 w-4 rounded-full bg-paper-sunk" />
                          </div>
                          <div className="w-48 shrink-0 flex items-center gap-2">
                            <div className="h-3.5 w-32 rounded bg-paper-sunk" />
                          </div>
                          <div className="flex-1 min-w-0 flex items-center">
                            <div className="h-3.5 w-4/5 rounded bg-paper-sunk" />
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <div className="h-4 w-18 rounded-full bg-paper-sunk" />
                          </div>
                          <div className="w-28 shrink-0 text-right">
                            <div className="h-3 w-12 ml-auto rounded bg-paper-sunk" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : paginatedThreads.length === 0 ? (
                    (() => {
                      const trimmedQuery = appliedQuery.trim();
                      const empty = trimmedQuery
                        ? {
                            icon: Inbox,
                            title: `No results for “${trimmedQuery}”`,
                            hint: "Try a different organisation, subject, or contact — or clear the search and press Enter.",
                          }
                        : appliedLabels.size > 0
                          ? {
                              icon: Tag,
                              title:
                                appliedLabels.size === 1
                                  ? `Nothing under ${Array.from(appliedLabels)[0]}`
                                  : "Nothing matching selected labels",
                              hint: "Try another sector label or folder.",
                            }
                          : FOLDER_EMPTY_STATES[activeFolder];
                      const EmptyIcon = empty.icon;
                      const emptyHint =
                        !trimmedQuery &&
                        appliedLabels.size === 0 &&
                        dateRanges.length > 0
                          ? "No threads arrived in the selected dates — try widening the range."
                          : empty.hint;
                      return (
                        <div className="flex flex-col items-center justify-center py-20 text-center text-dim">
                          <EmptyIcon className="h-12 w-12 text-faint stroke-[1.5] mb-3" />
                          <p className="text-sm font-semibold text-ink">{empty.title}</p>
                          <p className="text-xs text-dim mt-1 max-w-sm">{emptyHint}</p>
                        </div>
                      );
                    })()
                  ) : (
                    <AnimatePresence initial={false}>
                      {paginatedThreads.map((thread) => (
                        <motion.div
                          key={thread.id}
                          initial={false}
                          exit={
                            reduceMotion ? undefined : { opacity: 0, height: 0 }
                          }
                          transition={{ duration: 0.32, ease: "easeInOut" }}
                          style={{ overflow: "hidden" }}
                        >
                          <GmailThreadRow
                            thread={thread}
                            isSelected={selectedIds.has(thread.id)}
                            hasSelection={selectedIds.size > 0}
                            isActive={activeThreadId === thread.id}
                            isSentView={activeFolder === "sent"}
                            isScheduledView={activeFolder === "scheduled"}
                            href={threadHref(thread.id)}
                            onSelect={() => handleSelectThread(thread.id)}
                            onOpen={handleOpenThread}
                            onToggleStar={() => handleToggleStar(thread.id)}
                            onDelete={() => handleDeleteThread(thread.id)}
                            onToggleRead={() => handleToggleRead(thread.id)}
                            onToggleSector={handleToggleLabel}
                            isSectorActive={selectedLabels.has(thread.sector)}
                            sectorBg={labelColorMap.get(thread.sector)}
                          />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        )}
        </div>
      </div>
      </div>

      {/* Floating compose windows, stacked bottom-right like Gmail's. */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key="shell-toast"
            role="status"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed bottom-5 left-5 z-[80] flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white shadow-[0_18px_40px_-16px_rgba(15,23,42,0.6)]"
          >
            <Check className="h-4 w-4 text-emerald-300" aria-hidden="true" />
            {toast}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setToast(null)}
              className="ml-1 rounded-full p-0.5 text-white/60 transition-colors hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {composers.map((composer, index) => (
        <GmailComposeModal
          key={composer.key}
          isOpen
          draftId={composer.draftId}
          initialRecipient={composer.recipient}
          initialSubject={composer.subject}
          initialBody={composer.body}
          rightOffsetPx={composerOffsets[index]}
          isMinimised={composer.minimised}
          onMinimisedChange={(minimised) => setComposerMinimised(composer.key, minimised)}
          onClose={() => closeComposer(composer.key)}
          directory={addressableClients}
          tags={tags}
          assignedTagsByClientId={tagsByClientId}
          onSend={handleSendNewOutreach}
          onDraftSaved={() => showToast("Draft saved")}
        />
      ))}
    </div>
  );
}

export { GmailInboxShell as GmailInboxShellBefore };
