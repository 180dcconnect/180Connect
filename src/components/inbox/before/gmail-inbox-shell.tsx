"use client";

import { useState, useMemo, useRef, useEffect } from "react";
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
  type LucideIcon,
} from "lucide-react";
import {
  MOCK_INBOX_THREADS,
  formatGmailTimestamp,
  resolveDateFilter,
  searchThreads,
  type MockThread,
} from "@/lib/inbox-mock-data";
import { GmailSidebar, SECTORS, type GmailFolder, type SidebarLabel } from "./gmail-sidebar";
import { GmailActionBar, type SelectionState } from "./gmail-action-bar";
import { GmailThreadRow } from "./gmail-thread-row";
import { GmailReadingPane } from "./gmail-reading-pane";
import { GmailComposeModal } from "./gmail-compose-modal";
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
  renderBadge?: (followUpDueCount: number) => React.ReactNode;
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
    renderBadge: () => (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-800 font-bold">
        Action Needed
      </span>
    ),
  },
  {
    id: "awaiting",
    label: "Awaiting Response",
    icon: Clock,
    iconClass: "text-amber-500",
    activeTextClass: "text-amber-700",
    indicatorBg: "bg-amber-500",
  },
  {
    id: "followup",
    label: "Follow-up Due",
    icon: AlarmClock,
    iconClass: "text-rose-500",
    activeTextClass: "text-rose-700",
    indicatorBg: "bg-rose-500",
    renderBadge: (count) =>
      count > 0 ? (
        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] text-rose-800 font-bold tabular-nums">
          {count}
        </span>
      ) : null,
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
    threshold. The engine reads that threshold from the owner's
    outreach_preferences; the mock has no preferences table, so it uses the AC
    default of 7 days. */
const FOLLOW_UP_DUE_DAYS = 7;

function daysSilent(thread: MockThread): number {
  const elapsed = Date.now() - new Date(thread.lastActivityAt).getTime();
  return Math.floor(elapsed / (24 * 60 * 60 * 1000));
}

function isFollowUpDue(thread: MockThread): boolean {
  if (thread.status !== "awaiting" && thread.status !== "sent") return false;
  return daysSilent(thread) >= FOLLOW_UP_DUE_DAYS;
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

export function GmailInboxShell({
  initialThreads = MOCK_INBOX_THREADS,
  className = "h-[calc(100vh-1.5rem)]",
}: {
  initialThreads?: MockThread[];
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [threads, setThreads] = useState<MockThread[]>(initialThreads);
  const [activeFolder, setActiveFolder] = useState<GmailFolder>("inbox");
  const [activeCategoryTab, setActiveCategoryTab] = useState<GmailCategoryTab>("primary");
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [appliedLabels, setAppliedLabels] = useState<Set<string>>(new Set());
  const [isLabelLoading, setIsLabelLoading] = useState(false);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [customLabels, setCustomLabels] = useState<SidebarLabel[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Seeded from `?thread=` so a row opened in a fresh tab lands on that thread.
  const [activeThreadId, setActiveThreadId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("thread");
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [isAtBottom, setIsAtBottom] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  // The dropdown previews it live; Enter applies it to the list.
  const [liveQuery, setLiveQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [appliedDateValues, setAppliedDateValues] = useState<string[]>([]);
  const [appliedStatusValues, setAppliedStatusValues] = useState<string[]>([]);

  const allLabels = useMemo(
    () => [...SECTORS, ...customLabels],
    [customLabels],
  );

  const labelColorMap = useMemo(() => {
    const map = new Map<string, string>();
    allLabels.forEach((l) => map.set(l.name, l.bg));
    if (map.has("Health & Well-being") && !map.has("Health & Wellbeing")) {
      map.set("Health & Wellbeing", map.get("Health & Well-being")!);
    }
    return map;
  }, [allLabels]);

  const activeLabels = useMemo(() => {
    return Array.from(selectedLabels).map((name) => ({
      name,
      bg: labelColorMap.get(name) ?? "var(--lead)",
    }));
  }, [selectedLabels, labelColorMap]);

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

      // 2. Sector / Label filter (multi-select / additive)
      if (appliedLabels.size > 0) {
        if (!appliedLabels.has(thread.sector)) return false;
      }

      // 3. Category Tab filter (only applies inside Inbox when no label filter is active)
      if (activeFolder === "inbox" && appliedLabels.size === 0) {
        if (activeCategoryTab === "inbound") {
          if (thread.status !== "replied") return false;
        } else if (activeCategoryTab === "awaiting") {
          if (thread.status !== "awaiting") return false;
        } else if (activeCategoryTab === "followup") {
          if (!isFollowUpDue(thread)) return false;
        } else if (activeCategoryTab === "starred") {
          if (!thread.isStarred) return false;
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
  }, [threads, activeFolder, activeCategoryTab, appliedLabels, queryMatchIds, appliedQuery, dateRanges, appliedStatusValues]);

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
    () => threads.filter((t) => t.folder !== "trash" && isFollowUpDue(t)).length,
    [threads]
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
    if (activeThreadId) url.searchParams.set("thread", activeThreadId);
    else url.searchParams.delete("thread");
    window.history.replaceState(null, "", url);
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

  // Cleanup loading timer on unmount
  useEffect(() => {
    return () => {
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
      }
    };
  }, []);

  // Label Filter Handlers with 1.5s simulated loading delay and neon spinner signal
  function triggerLabelFilter(nextLabels: Set<string>) {
    setSelectedLabels(nextLabels);
    setIsLabelLoading(true);
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current);
    }
    loadingTimerRef.current = setTimeout(() => {
      setAppliedLabels(nextLabels);
      setIsLabelLoading(false);
      setPageIndex(0);
      listRef.current?.scrollTo({ top: 0 });
    }, 1500);
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

  function handleRemoveLabel(labelName: string) {
    const next = new Set(selectedLabels);
    next.delete(labelName);
    triggerLabelFilter(next);
  }

  function handleClearAllLabels() {
    triggerLabelFilter(new Set());
  }

  function handleAddCustomLabel(label: SidebarLabel) {
    setCustomLabels((prev) => [...prev, label]);
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

  function handleToggleStar(id: string) {
    setThreads((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isStarred: !t.isStarred } : t))
    );
  }

  function handleToggleRead(id: string) {
    setThreads((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isRead: !t.isRead } : t))
    );
  }

  function handleDeleteThread(id: string) {
    setThreads((prev) =>
      prev.map((t) => (t.id === id ? { ...t, folder: "trash" } : t))
    );
    if (activeThreadId === id) setActiveThreadId(null);
  }

  // Bulk Handlers
  function handleMarkAsRead() {
    setThreads((prev) =>
      prev.map((t) => (selectedIds.has(t.id) ? { ...t, isRead: true } : t))
    );
    setSelectedIds(new Set());
  }

  function handleMarkAsUnread() {
    setThreads((prev) =>
      prev.map((t) => (selectedIds.has(t.id) ? { ...t, isRead: false } : t))
    );
    setSelectedIds(new Set());
  }

  function handleToggleStarSelected() {
    setThreads((prev) =>
      prev.map((t) => (selectedIds.has(t.id) ? { ...t, isStarred: !t.isStarred } : t))
    );
    setSelectedIds(new Set());
  }

  function handleDeleteSelected() {
    setThreads((prev) =>
      prev.map((t) => (selectedIds.has(t.id) ? { ...t, folder: "trash" } : t))
    );
    setSelectedIds(new Set());
    if (activeThreadId && selectedIds.has(activeThreadId)) {
      setActiveThreadId(null);
    }
  }

  function handleRefresh() {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
    }, 450);
  }

  function handleOpenThread(thread: MockThread) {
    // Mark as read automatically when opening
    setThreads((prev) =>
      prev.map((t) => (t.id === thread.id ? { ...t, isRead: true } : t))
    );
    setActiveThreadId(thread.id);
  }

  function handleSendReply(threadId: string, replyBody: string) {
    const now = new Date().toISOString();
    setThreads((prev) =>
      prev.map((t) => {
        if (t.id !== threadId) return t;
        const newMsg = {
          id: `reply-${Date.now()}`,
          senderName: t.camOwner.name,
          senderEmail: t.camOwner.email,
          recipientName: t.primaryContact.name,
          recipientEmail: t.primaryContact.email,
          sentAt: now,
          subject: t.subject.startsWith("Re:") ? t.subject : `Re: ${t.subject}`,
          body: replyBody,
          isFromClient: false,
        };
        return {
          ...t,
          status: "awaiting" as const,
          lastActivityAt: now,
          snippet: replyBody.slice(0, 100),
          messages: [...t.messages, newMsg],
        };
      })
    );
  }

  function handleSendNewOutreach(message: {
    to: string;
    subject: string;
    body: string;
    /** ISO instant when a scheduled send is due; absent means send now. */
    scheduledFor?: string;
  }) {
    const now = new Date().toISOString();
    const isScheduled = Boolean(message.scheduledFor);
    const newThread: MockThread = {
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

    setThreads((prev) => [newThread, ...prev]);
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
              onClick={() => setIsComposeOpen(true)}
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
            placeholder="Search"
            busy={isLabelLoading}
            subjects={["organisations", "contacts", "subjects"]}
            onQueryChange={setLiveQuery}
            suggestions={suggestions}
            onSuggestionSelect={(id) => {
              const thread = threads.find((t) => t.id === id);
              if (thread) handleOpenThread(thread);
            }}
            onSubmitQuery={(query, filters) => {
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
              const sectorFilters = filters
                .filter((filter) => filter.category === "Filter by sector")
                .map((filter) => {
                  const opt = SECTOR_FILTER_OPTIONS.find((s) => s.value === filter.value);
                  return opt ? opt.label : filter.label || filter.value;
                });
              if (sectorFilters.length > 0) {
                const next = new Set(selectedLabels);
                sectorFilters.forEach((s) => next.add(s));
                triggerLabelFilter(next);
              } else {
                setPageIndex(0);
                listRef.current?.scrollTo({ top: 0 });
              }
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
          if (loadingTimerRef.current) {
            clearTimeout(loadingTimerRef.current);
          }
          setIsLabelLoading(false);
          setSelectedLabels(new Set());
          setAppliedLabels(new Set());
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
        onAddCustomLabel={handleAddCustomLabel}
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
            onSendReply={handleSendReply}
          />
        ) : (
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
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
                      {tab.renderBadge?.(followUpDueCount)}
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
                  {isLabelLoading ? (
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
                    paginatedThreads.map((thread) => (
                      <GmailThreadRow
                        key={thread.id}
                        thread={thread}
                        isSelected={selectedIds.has(thread.id)}
                        hasSelection={selectedIds.size > 0}
                        isActive={activeThreadId === thread.id}
                        isSentView={activeFolder === "sent"}
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
                    ))
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        )}
        </div>
      </div>
      </div>

      {/* Floating Compose Modal */}
      <GmailComposeModal
        isOpen={isComposeOpen}
        onClose={() => setIsComposeOpen(false)}
        onSend={handleSendNewOutreach}
      />
    </div>
  );
}

export { GmailInboxShell as GmailInboxShellBefore };
