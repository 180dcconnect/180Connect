"use client";

import { useState, useMemo } from "react";
import {
  Inbox,
  MessageSquare,
  Clock,
  Star,
} from "lucide-react";
import {
  MOCK_INBOX_THREADS,
  type MockThread,
} from "@/lib/inbox-mock-data";
import { GmailSidebar, type GmailFolder } from "./gmail-sidebar";
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

export type GmailCategoryTab = "primary" | "inbound" | "awaiting" | "starred" | "sent";

const PAGE_SIZE = 15;

export function GmailInboxShell({
  initialThreads = MOCK_INBOX_THREADS,
}: {
  initialThreads?: MockThread[];
}) {
  const [threads, setThreads] = useState<MockThread[]>(initialThreads);
  const [activeFolder, setActiveFolder] = useState<GmailFolder>("inbox");
  const [activeCategoryTab, setActiveCategoryTab] = useState<GmailCategoryTab>("primary");
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isSplitView, setIsSplitView] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);

  // Filter threads based on folder, category tab, and label.
  // (The BrandSearchBar above is a visual starting point — its submit writes
  // URL params nothing here reads, so there is no query filter to apply.)
  const filteredThreads = useMemo(() => {
    return threads.filter((thread) => {
      // 1. Folder filter
      if (activeFolder === "starred") {
        if (!thread.isStarred) return false;
      } else if (activeFolder === "sent") {
        if (thread.folder !== "sent" && thread.status !== "sent") return false;
      } else if (activeFolder === "drafts") {
        if (thread.folder !== "drafts") return false;
      } else if (activeFolder === "trash") {
        if (thread.folder !== "trash") return false;
      } else {
        // Inbox folder: exclude trash
        if (thread.folder === "trash") return false;
      }

      // 2. Sector / Label filter
      if (selectedLabel) {
        if (thread.sector !== selectedLabel) return false;
      }

      // 3. Category Tab filter (only applies inside Inbox)
      if (activeFolder === "inbox" && !selectedLabel) {
        if (activeCategoryTab === "inbound") {
          if (thread.status !== "replied") return false;
        } else if (activeCategoryTab === "awaiting") {
          if (thread.status !== "awaiting") return false;
        } else if (activeCategoryTab === "starred") {
          if (!thread.isStarred) return false;
        } else if (activeCategoryTab === "sent") {
          if (thread.status !== "sent") return false;
        }
      }

      return true;
    });
  }, [threads, activeFolder, activeCategoryTab, selectedLabel]);

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
  const sentCount = useMemo(
    () => threads.filter((t) => t.folder === "sent" || t.status === "sent").length,
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

  function handleSendNewOutreach(message: { to: string; subject: string; body: string }) {
    const now = new Date().toISOString();
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
      folder: "sent",
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
    <div className="flex h-[calc(100vh-1.5rem)] w-full gap-2 font-sans bg-[#f6f8fc] pt-1 pr-2 pb-2 pl-0 rounded-2xl">
      {/* Left Gmail Navigation */}
      <GmailSidebar
        activeFolder={activeFolder}
        onSelectFolder={(folder) => {
          setActiveFolder(folder);
          setActiveThreadId(null);
        }}
        selectedLabel={selectedLabel}
        onSelectLabel={(label) => {
          setSelectedLabel(label);
          setActiveThreadId(null);
        }}
        unreadCount={unreadCount}
        starredCount={starredCount}
        sentCount={sentCount}
        draftsCount={draftsCount}
        trashCount={trashCount}
        onOpenCompose={() => setIsComposeOpen(true)}
      />

      {/* Right Column: search on the shell background, mail surface below.
          min-h-0 all the way down so only the white thread list scrolls —
          the page itself never does. */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <div className="mb-2 shrink-0">
          <BrandSearchBar
            tone="light"
            placeholder="Search"
            subjects={["organisations", "contacts", "subjects"]}
            categories={{
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
              "Filter by sector": "sector",
              "Filter by status": "status",
              "Filter by owner": "owner",
              "Filter by organisation type": "type",
              "Filter by priority score": "score",
            }}
          />
        </div>

      {/* Main Mail Surface (borderless, shadowless) */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-white rounded-2xl overflow-hidden">
        {/* Full conversation reading view (when active in non-split mode) */}
        {activeThread && !isSplitView ? (
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
            <div className="p-3 border-b border-slate-100">
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
                isSplitView={isSplitView}
                onToggleSplitView={() => setIsSplitView(!isSplitView)}
                pageIndex={pageIndex}
                pageSize={PAGE_SIZE}
                onPrevPage={() => setPageIndex(Math.max(0, pageIndex - 1))}
                onNextPage={() => setPageIndex(pageIndex + 1)}
              />

              {/* Gmail Category Tabs (Only on Inbox folder) */}
              {activeFolder === "inbox" && !selectedLabel && (
                <div className="flex items-center gap-1 border-b border-slate-200 mt-2 px-1 text-xs select-none">
                  <button
                    type="button"
                    onClick={() => setActiveCategoryTab("primary")}
                    className={`flex items-center gap-2.5 px-6 py-3 border-b-2 font-bold transition-all cursor-pointer ${
                      activeCategoryTab === "primary"
                        ? "border-blue-600 text-blue-600 bg-blue-50/40"
                        : "border-transparent text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <Inbox className="h-4 w-4" />
                    <span>Primary</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveCategoryTab("inbound")}
                    className={`flex items-center gap-2.5 px-6 py-3 border-b-2 font-bold transition-all cursor-pointer ${
                      activeCategoryTab === "inbound"
                        ? "border-emerald-600 text-emerald-700 bg-emerald-50/40"
                        : "border-transparent text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <MessageSquare className="h-4 w-4 text-emerald-600" />
                    <span>Inbound Replies</span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-800 font-bold">
                      Action Needed
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveCategoryTab("awaiting")}
                    className={`flex items-center gap-2.5 px-6 py-3 border-b-2 font-bold transition-all cursor-pointer ${
                      activeCategoryTab === "awaiting"
                        ? "border-amber-500 text-amber-700 bg-amber-50/40"
                        : "border-transparent text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <Clock className="h-4 w-4 text-amber-500" />
                    <span>Awaiting Response</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveCategoryTab("starred")}
                    className={`flex items-center gap-2.5 px-6 py-3 border-b-2 font-bold transition-all cursor-pointer ${
                      activeCategoryTab === "starred"
                        ? "border-amber-500 text-amber-600 bg-amber-50/40"
                        : "border-transparent text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <Star className="h-4 w-4 text-amber-400" />
                    <span>Starred</span>
                  </button>
                </div>
              )}
            </div>

            {/* Split View Container OR Single List */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
              {/* Thread List Table */}
              <div
                className={`flex-1 min-h-0 overflow-y-auto ${
                  isSplitView && activeThread ? "max-w-md border-r border-slate-200" : ""
                }`}
              >
                {paginatedThreads.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center text-slate-500">
                    <Inbox className="h-12 w-12 text-slate-300 stroke-[1.5] mb-3" />
                    <p className="text-sm font-semibold text-slate-700">No messages in this view</p>
                    <p className="text-xs text-slate-400 mt-1 max-w-sm">
                      Try selecting another folder or clearing search filters.
                    </p>
                  </div>
                ) : (
                  paginatedThreads.map((thread) => (
                    <GmailThreadRow
                      key={thread.id}
                      thread={thread}
                      isSelected={selectedIds.has(thread.id)}
                      isActive={activeThreadId === thread.id}
                      onSelect={() => handleSelectThread(thread.id)}
                      onOpen={handleOpenThread}
                      onToggleStar={() => handleToggleStar(thread.id)}
                      onDelete={() => handleDeleteThread(thread.id)}
                      onToggleRead={() => handleToggleRead(thread.id)}
                    />
                  ))
                )}
              </div>

              {/* Split-Pane Reading View */}
              {isSplitView && (
                <div className="flex-1 overflow-hidden">
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
                    <div className="flex flex-col items-center justify-center h-full text-center text-slate-400 p-8">
                      <Inbox className="h-10 w-10 text-slate-300 stroke-[1.5] mb-2" />
                      <p className="text-sm font-medium text-slate-600">No conversation selected</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Select a thread from the list on the left to preview it here.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
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
