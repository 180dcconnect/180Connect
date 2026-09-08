"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  Inbox,
  Star,
  SendHorizontal,
  CalendarClock,
  StickyNote,
  Trash2,
  Plus,
  CheckCircle2,
} from "lucide-react";
import { OriginButton } from "@/components/ui/origin-button";
import { TAG_COLOURS } from "@/lib/tags/tag-colours";

export type GmailFolder =
  | "inbox"
  | "starred"
  | "scheduled"
  | "sent"
  | "drafts"
  | "trash";

export type SidebarLabel = { name: string; bg: string };

export const SECTORS: SidebarLabel[] = [
  { name: "Charities & NGOs", bg: "#06402B" },
  { name: "Health & Well-being", bg: "var(--lead)" },
  { name: "Youth & Education", bg: "#3730a3" },
  { name: "Environment", bg: "#0f766e" },
  { name: "Grants & Foundations", bg: "#5b21b6" },
];

/** Same shape as the client record's tags (tag-chips.tsx): a rectangle with a
    V notch punched into its right edge. There is no remove X here — these are
    filters, not assignments — so the notch is purely decorative.
    Solid deep-brand fills with white text (not colour tints): lead from
    globals.css, royal green, deep indigo / teal / violet. */
export const SECTOR_TAG_CLIP =
  "polygon(0 0, 100% 0, calc(100% - 8px) 50%, 100% 100%, 0 100%)";

export const SECTOR_COLOR_MAP: Record<string, string> = {
  "Charities & NGOs": "#06402B",
  "Health & Well-being": "var(--lead)",
  "Health & Wellbeing": "var(--lead)",
  "Youth & Education": "#3730a3",
  "Environment": "#0f766e",
  "Grants & Foundations": "#5b21b6",
};

export function getSectorColor(sector: string, fallback?: string): string {
  return SECTOR_COLOR_MAP[sector] ?? fallback ?? "var(--lead)";
}

/**
 * Returns CSS properties for a sector tag.
 * When active (filter selected): solid sector color fill with high-contrast white text.
 * When inactive (default row appearance): subtle 12% tint of the sector color with readable
 * dark-hue text in the sector color itself, matching the design system standard.
 */
export function getSectorTagStyle(
  color: string,
  isActive: boolean = false,
): React.CSSProperties {
  if (isActive) {
    return {
      clipPath: SECTOR_TAG_CLIP,
      backgroundColor: color,
      color: "#ffffff",
    };
  }
  return {
    clipPath: SECTOR_TAG_CLIP,
    backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
    color,
  };
}

export type GmailSidebarProps = {
  activeFolder: GmailFolder;
  onSelectFolder: (folder: GmailFolder) => void;
  selectedLabels: Set<string>;
  onToggleLabel: (label: string) => void;
  onClearLabels: () => void;
  unreadCount: number;
  starredCount: number;
  scheduledCount: number;
  sentCount: number;
  draftsCount: number;
  trashCount: number;
  /** Threads per sector label, so a chip shows what tapping it will reveal. */
  labelCounts: Record<string, number>;
  customLabels?: SidebarLabel[];
  onAddCustomLabel?: (label: SidebarLabel) => void;
  /**
   * Create a real tag (TAGS) for the typed name and colour. When provided it
   * replaces the local-only `onAddCustomLabel` path: the panel waits for the
   * server, shows what it refused with, and only selects + closes on success.
   * `colour` is a palette hex or null.
   */
  onCreateLabel?: (
    name: string,
    colour: string | null,
  ) => Promise<{ ok: boolean; message?: string }>;
};

/** A label created without a colour falls back to lead — the app's deep
    structural blue — which keeps white chip text readable. */
const DEFAULT_LABEL_BG = "var(--lead)";

/** The create-label popover is fixed to the + button it grows out of. */
const CREATE_PANEL_WIDTH = 280;

export function GmailSidebar({
  activeFolder,
  onSelectFolder,
  selectedLabels,
  onToggleLabel,
  onClearLabels,
  unreadCount,
  starredCount,
  scheduledCount,
  sentCount,
  draftsCount,
  trashCount,
  labelCounts,
  customLabels = [],
  onAddCustomLabel,
  onCreateLabel,
}: GmailSidebarProps) {
  // User-created labels, added through the + next to the heading.
  const [localCustomLabels, setLocalCustomLabels] = useState<SidebarLabel[]>([]);
  const [isCreatingLabel, setIsCreatingLabel] = useState(false);
  const serverBacked = Boolean(onCreateLabel);
  const effectiveCustomLabels =
    onAddCustomLabel || serverBacked ? customLabels : localCustomLabels;
  // Portals need the DOM: nothing portal-shaped renders on the server (or the
  // first client pass), so SSR and hydration agree. A plain `typeof document`
  // guard would flip mid-hydration; the external store stays false until commit.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftColour, setDraftColour] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [panelAnchor, setPanelAnchor] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const createPanelRef = useRef<HTMLDivElement>(null);

  const labels: SidebarLabel[] = [...SECTORS, ...effectiveCustomLabels];

  const closeCreatePanel = useCallback(() => {
    setIsCreateOpen(false);
    setDraftName("");
    setDraftColour(null);
    setCreateError(null);
  }, []);

  const openCreatePanel = useCallback(() => {
    const rect = createButtonRef.current?.getBoundingClientRect();
    setPanelAnchor(
      rect ? { top: rect.bottom + 8, right: rect.right } : { top: 64, right: 240 },
    );
    setDraftName("");
    setDraftColour(null);
    setCreateError(null);
    setIsCreateOpen(true);
  }, []);

  // Click-outside and Escape dismiss the panel, exactly like the record's
  // popovers. Clicks on the + itself are excluded so it can toggle.
  useEffect(() => {
    if (!isCreateOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (createPanelRef.current?.contains(target)) return;
      if (createButtonRef.current?.contains(target)) return;
      closeCreatePanel();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeCreatePanel();
    };
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCreateOpen, closeCreatePanel]);

  async function createLabel() {
    if (isCreatingLabel) return;
    const name = draftName.trim();
    if (!name) return;
    const taken = new Set(labels.map((label) => label.name.toLowerCase()));
    if (taken.has(name.toLowerCase())) {
      setCreateError("A label with this name already exists.");
      return;
    }

    // Server-backed: the tag is real (TAGS). Wait for it, and only select +
    // close once it exists — a failed create must not leave a phantom label
    // selected with nothing behind it.
    if (onCreateLabel) {
      setIsCreatingLabel(true);
      setCreateError(null);
      try {
        const result = await onCreateLabel(name, draftColour ?? null);
        if (!result.ok) {
          setCreateError(result.message ?? "That label could not be created.");
          return;
        }
        onToggleLabel(name);
        closeCreatePanel();
      } catch {
        setCreateError("That label could not be created. Try again.");
      } finally {
        setIsCreatingLabel(false);
      }
      return;
    }

    const newLabel = { name, bg: draftColour ?? DEFAULT_LABEL_BG };
    if (onAddCustomLabel) {
      onAddCustomLabel(newLabel);
    } else {
      setLocalCustomLabels((prev) => [...prev, newLabel]);
    }
    onToggleLabel(name);
    closeCreatePanel();
  }

  const folders = [
    {
      id: "inbox" as GmailFolder,
      label: "Inbox",
      icon: Inbox,
      count: unreadCount > 0 ? unreadCount : undefined,
      countBold: true,
    },
    {
      id: "starred" as GmailFolder,
      label: "Starred",
      icon: Star,
      count: starredCount > 0 ? starredCount : undefined,
    },
    {
      id: "scheduled" as GmailFolder,
      label: "Scheduled",
      icon: CalendarClock,
      count: scheduledCount > 0 ? scheduledCount : undefined,
    },
    {
      id: "sent" as GmailFolder,
      label: "Sent",
      icon: SendHorizontal,
      count: sentCount > 0 ? sentCount : undefined,
    },
    {
      id: "drafts" as GmailFolder,
      label: "Drafts",
      icon: StickyNote,
      count: draftsCount > 0 ? draftsCount : undefined,
    },
    {
      id: "trash" as GmailFolder,
      label: "Trash",
      icon: Trash2,
      count: trashCount > 0 ? trashCount : undefined,
    },
  ];

  return (
    <aside className="flex w-56 flex-col shrink-0 min-h-0 overflow-y-auto pr-3 select-none">
      {/* Main Folder Navigation */}
      <nav className="space-y-0.5">
        {folders.map((folder) => {
          const Icon = folder.icon;
          const isActive = activeFolder === folder.id;

          return (
            <button
              key={folder.id}
              type="button"
              onClick={() => {
                onClearLabels();
                onSelectFolder(folder.id);
              }}
              className={`group flex w-full items-center justify-between rounded-r-full px-4 py-2 text-sm transition-colors cursor-pointer ${
                isActive
                  ? "bg-[#d3e3fd] text-[#001d35] font-bold"
                  : "text-slate-700 hover:bg-slate-100 font-medium"
              }`}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    isActive ? "text-[#001d35]" : "text-slate-500 group-hover:text-slate-700"
                  }`}
                />
                <span className="truncate">{folder.label}</span>
              </div>
              {folder.count !== undefined && (
                <span
                  className={`text-xs ml-2 ${
                    isActive || folder.countBold
                      ? "font-bold text-[#001d35]"
                      : "text-slate-500 group-hover:text-slate-700"
                  }`}
                >
                  {folder.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Divider */}
      <div className="my-4" />

      {/* Labels / Sectors */}
      <div className="px-3">
        <div className="flex items-center justify-between mb-2">
          <span className="font-body text-sm font-medium text-slate-500">
            Labels
          </span>
          <button
            ref={createButtonRef}
            type="button"
            onClick={() => (isCreateOpen ? closeCreatePanel() : openCreatePanel())}
            aria-label="Create a new label"
            aria-expanded={isCreateOpen}
            title="Create a new label"
            className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-full transition-colors ${
              isCreateOpen
                ? "bg-[#d3e3fd] text-[#001d35]"
                : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            }`}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        </div>

        <div className="space-y-1">
          {labels.map((label) => {
            const isLabelActive = selectedLabels.has(label.name);
            const count = labelCounts[label.name] ?? 0;

            return (
              <button
                key={label.name}
                type="button"
                onClick={() => {
                  onToggleLabel(label.name);
                }}
                aria-pressed={isLabelActive}
                title={
                  isLabelActive
                    ? `Showing ${label.name} — click to remove filter`
                    : `${label.name} — ${count} ${count === 1 ? "thread" : "threads"}`
                }
                className="group flex w-full items-center justify-between gap-2 text-left cursor-pointer"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    style={{
                      clipPath: SECTOR_TAG_CLIP,
                      backgroundColor: label.bg,
                      color: "#ffffff",
                      filter: isLabelActive ? "brightness(1.25)" : undefined,
                    }}
                    className={`inline-flex max-w-full items-center py-1 pl-2.5 pr-3 font-body text-xs text-white transition ${
                      isLabelActive ? "font-bold" : "font-medium"
                    }`}
                  >
                    <span className="truncate">{label.name}</span>
                  </span>

                  <AnimatePresence>
                    {isLabelActive && (
                      <motion.span
                        key={`tick-${label.name}`}
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.5 }}
                        transition={{ duration: 0.15 }}
                        className="inline-flex items-center justify-center shrink-0"
                        aria-hidden="true"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth="3.5"
                          stroke="currentColor"
                          className="h-3.5 w-3.5 text-emerald-600 shrink-0"
                        >
                          <motion.path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M4.5 12.75l6 6 9-13.5"
                            initial={{ pathLength: 0 }}
                            animate={{
                              pathLength: 1,
                              transition: {
                                duration: 0.25,
                                ease: "easeOut",
                              },
                            }}
                            exit={{
                              pathLength: 0,
                              transition: {
                                duration: 0.15,
                              },
                            }}
                          />
                        </svg>
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>

                {count > 0 && (
                  <span
                    style={{ color: label.bg }}
                    className="shrink-0 font-body text-sm leading-none font-bold tabular-nums transition"
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom Status / Quota */}
      <div className="mt-auto pt-6 px-3">
        <div className="rounded-xl border border-slate-200/90 bg-white/70 p-3 shadow-xs">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            <span>Outreach Engine Active</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500 leading-tight">
            180DC Sheffield Mailbox connected via Gmail API.
          </p>
        </div>
      </div>

      {/* Create-label popover. Portaled to <body> because the aside scrolls,
          and a scroll container would clip an absolutely positioned panel.
          It floats over the sidebar, anchored to the + it grew out of, and
          uses the same spring the record's tag picker does. */}
      {mounted &&
        createPortal(
        <AnimatePresence>
          {isCreateOpen && panelAnchor && (
            <motion.div
              ref={createPanelRef}
              role="dialog"
              aria-label="Create a new label"
              style={{
                top: panelAnchor.top,
                left: Math.max(12, panelAnchor.right - CREATE_PANEL_WIDTH),
                width: CREATE_PANEL_WIDTH,
                transformOrigin: "top right",
              }}
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
              className="fixed z-50 rounded-panel border border-rule bg-white p-3 shadow-[0_18px_40px_-18px_rgba(20,26,34,0.32)]"
            >
              <div className="flex w-full flex-col">
                <input
                  autoFocus
                  value={draftName}
                  onChange={(event) => {
                    setDraftName(event.target.value);
                    if (createError) setCreateError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      createLabel();
                    }
                  }}
                  placeholder="Label name"
                  aria-label="Label name"
                  autoComplete="off"
                  className="w-full bg-transparent font-body text-[13px] text-ink outline-none placeholder:text-faint"
                />
                {createError && (
                  <p
                    role="alert"
                    className="mt-1.5 text-[11px] font-semibold text-stop"
                  >
                    {createError}
                  </p>
                )}
                <div className="mt-2.5 flex items-end justify-between gap-2 border-t border-rule-soft pt-2.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <ColourDot
                      colour={null}
                      name="Default"
                      selected={draftColour === null}
                      onSelect={() => setDraftColour(null)}
                    />
                    {TAG_COLOURS.map((colour) => (
                      <ColourDot
                        key={colour.hex}
                        colour={colour.hex}
                        name={colour.name}
                        selected={draftColour === colour.hex}
                        onSelect={() => setDraftColour(colour.hex)}
                      />
                    ))}
                  </div>
                  <OriginButton
                    size="xs"
                    variant="ink"
                    loading={isCreatingLabel}
                    disabled={
                      !draftName.trim() || createError !== null || isCreatingLabel
                    }
                    onClick={createLabel}
                    className="shrink-0"
                  >
                    {isCreatingLabel ? "Creating…" : "Create"}
                  </OriginButton>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </aside>
  );
}

/** One palette entry in the create-label popover. Mirrors the record's tag
    colour picker: full-strength dot, ring marks the choice. The Default dot is
    lead — the fill a colourless label chip will get. */
function ColourDot({
  colour,
  name,
  selected,
  onSelect,
}: {
  colour: string | null;
  name: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${name} colour`}
      aria-pressed={selected}
      title={name}
      style={{ backgroundColor: colour ?? DEFAULT_LABEL_BG }}
      className={`size-4.5 shrink-0 cursor-pointer rounded-full transition-transform hover:scale-110 focus-visible:outline-none ${
        selected
          ? "ring-2 ring-ink/70 ring-offset-2 ring-offset-white"
          : "ring-1 ring-black/10"
      }`}
    />
  );
}
