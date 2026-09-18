"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotionConfig, type Variants } from "motion/react";
import { ArrowRight, AtSign, Check, Search } from "lucide-react";
import {
  PIPELINE_STATUSES,
  formatOutreachStatus,
  type PipelineStatus,
} from "@/lib/organisation-format";
import { MAX_BULK_STATUS_CLIENTS } from "@/lib/bulk-status";
import { MAX_BULK_NOTE_CLIENTS, MAX_NOTE_LENGTH, prepareComment } from "@/lib/bulk-note";
import { MAX_BULK_TAG_CLIENTS } from "@/lib/bulk-tags";
import {
  applyMentionInsertion,
  filterMentionCandidates,
  limitMentionIdsByOccurrences,
  mentionQueryAtCursor,
  splitNoteContentMentions,
  type MentionCandidate,
} from "@/lib/note-mentions";
import { MentionTag } from "@/components/ui/mention-tag";
import { getMentionDirectory } from "@/lib/mention-directory";
import { AnimateIcon } from "@/components/animate-ui/icons/icon";
import { MessageSquarePlus } from "@/components/animate-ui/icons/message-square-plus";
import { Tag } from "@/components/animate-ui/icons/tag";
import { User } from "@/components/animate-ui/icons/user";
import { Workflow } from "@/components/animate-ui/icons/workflow";
import { XIcon } from "@/components/animate-ui/icons/x";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { EASE, stagger } from "@/components/brand/motion";
import { LIP, SEARCH_GLASS, SEARCH_GLASS_LIGHT, SEARCH_GLASS_OPEN, SEARCH_GLASS_OPEN_LIGHT } from "@/components/brand/tokens";
import { useBulkSelection } from "./bulk-selection";

/**
 * Unified bulk action bar: F064 (status) + F065 (comment) + F253 (assign)
 * + F063 (tags), drawn in the BrandSearchBar's glass language.
 *
 * SELECTING IS POINTING, NOT COMMITTING — F062's bar is a readout of what the
 * CAM is holding plus the things they might do to all of it:
 *
 *   - The bar floats at the bottom of the page as a glass capsule; the
 *     count is the anchor, always visible.
 *   - The heavyweight inputs — a status picker, a tag picker, an owner picker,
 *     a comment composer — unfold *upwards* from the capsule, which stays
 *     pinned where the CAM's eye already is.
 *   - Every panel is the same height. Switching from one action to another is
 *     a crossfade inside a box that does not move, rather than the glass
 *     lurching to a new size on every tap.
 *   - The all-or-nothing consequence of a bulk change lives in a confirmation
 *     that takes over the same panel (the search bar's confirm sheet), not in
 *     a modal somewhere else on the page.
 */

export type BulkBarTone = "dark" | "light";

const BULK_BAR_TONES: Record<
  BulkBarTone,
  {
    glassClosed: string;
    glassOpen: string;
    rim: string;
    shadow: string;
    innerRow: string;
    innerRowClosed: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    textFaint: string;
    textSubtle: string;
    placeholder: string;
    title: string;
    activeText: string;
    iconColor: string;
    iconActive: string;
    activeDot: string;
    markerLime: string;
    markerAmber: string;
    divider: string;
    fieldBg: string;
    fieldFocusRing: string;
    outline: string;
    caret: string;
    rowHover: string;
    rowSelected: string;
    rowSelectedCheck: string;
    dlBg: string;
    commentBg: string;
    commentText: string;
    mentionVariant: "dark" | "light";
    mentionCandidateSelected: string;
    mentionCandidateNormal: string;
    tagSwatchRing: string;
    warningBox: string;
    warningDeselect: string;
    errorBox: string;
    primaryButton: string;
    primaryButtonSpinner: string;
    ghostButton: string;
    actionDisc: string;
    actionDiscHover: string;
    badgeBg: string;
    adminBadge: string;
    resultPillBg: string;
    resultPillText: string;
    resultPillRim: string;
    resultIcon: string;
    frostOverlay: string;
  }
> = {
  dark: {
    glassClosed: SEARCH_GLASS,
    glassOpen: SEARCH_GLASS_OPEN,
    rim: "ring-white/25",
    shadow: `${LIP}, 0 20px 40px -15px rgba(0, 0, 0, 0.6)`,
    innerRow: "bg-black/20",
    innerRowClosed: "bg-black/20",
    textPrimary: "text-[#f4f4ef]",
    textSecondary: "text-[#f4f4ef]/55",
    textMuted: "text-[#f4f4ef]/60",
    textFaint: "text-[#f4f4ef]/50",
    textSubtle: "text-[#f4f4ef]/45",
    placeholder: "placeholder:text-[#f4f4ef]/40",
    title: "text-white",
    activeText: "text-[#e6f5c0]",
    iconColor: "text-[#f4f4ef]/70 hover:text-white",
    iconActive: "text-[#e6f5c0]",
    activeDot: "bg-[#e6f5c0]",
    markerLime: "bg-[#e6f5c0]",
    markerAmber: "bg-amber-300",
    divider: "bg-white/15",
    fieldBg: "bg-white/10",
    fieldFocusRing: "focus-within:ring-[#e6f5c0]/60",
    outline: "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e6f5c0]",
    caret: "caret-[#e6f5c0]",
    rowHover: "hover:bg-white/10",
    rowSelected: "bg-white/15 text-[#e6f5c0]",
    rowSelectedCheck: "text-[#e6f5c0]",
    dlBg: "bg-black/25",
    commentBg: "bg-black/25",
    commentText: "text-[#f4f4ef]",
    mentionVariant: "dark",
    mentionCandidateSelected: "bg-white/15 text-[#e6f5c0]",
    mentionCandidateNormal: "text-white hover:bg-white/10",
    tagSwatchRing: "ring-white/20",
    warningBox: "bg-amber-400/10 text-amber-200",
    warningDeselect: "text-amber-200 hover:text-white",
    errorBox: "bg-red-400/10 text-red-200",
    primaryButton: "bg-[#e6f5c0] text-[#1a1a1a] hover:bg-[#d4e5a0]",
    primaryButtonSpinner: "bg-[#1a1a1a]",
    ghostButton: "text-[#f4f4ef]/70 hover:bg-white/10 hover:text-[#f4f4ef]",
    actionDisc: "bg-[#e6f5c0] text-[#1a1a1a]",
    actionDiscHover: "hover:bg-[#d4e5a0]",
    badgeBg: "bg-white/10 text-[#f4f4ef]",
    adminBadge: "bg-white/15 text-[#e6f5c0]",
    resultPillBg: SEARCH_GLASS_OPEN,
    resultPillText: "text-[#f4f4ef]",
    resultPillRim: "ring-white/25",
    resultIcon: "bg-[#e6f5c0] text-[#1a1a1a]",
    frostOverlay: "bg-white/8",
  },
  light: {
    glassClosed: SEARCH_GLASS_LIGHT,
    glassOpen: SEARCH_GLASS_OPEN_LIGHT,
    rim: "ring-slate-900/10",
    shadow: `${LIP}, 0 20px 40px -15px rgba(15, 23, 42, 0.12)`,
    innerRow: "bg-[#d8e1ef]",
    innerRowClosed: "bg-transparent",
    textPrimary: "text-slate-900",
    textSecondary: "text-slate-500",
    textMuted: "text-slate-500",
    textFaint: "text-slate-500",
    textSubtle: "text-slate-400",
    placeholder: "placeholder:text-slate-400",
    title: "text-slate-900",
    activeText: "text-slate-900",
    iconColor: "text-slate-600 hover:text-slate-900 hover:bg-slate-900/5",
    iconActive: "text-slate-900 bg-slate-900/10",
    activeDot: "bg-slate-900",
    markerLime: "bg-lime-600",
    markerAmber: "bg-amber-500",
    divider: "bg-slate-900/15",
    fieldBg: "bg-slate-900/5 ring-1 ring-slate-900/10",
    fieldFocusRing: "focus-within:ring-lime-600/60",
    outline: "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-600",
    caret: "caret-lime-600",
    rowHover: "hover:bg-slate-900/5",
    rowSelected: "bg-lime-100 text-lime-900 ring-1 ring-lime-600/30",
    rowSelectedCheck: "text-lime-700",
    dlBg: "bg-slate-900/5 ring-1 ring-slate-900/10",
    commentBg: "bg-slate-900/5 ring-1 ring-slate-900/10",
    commentText: "text-slate-800",
    mentionVariant: "light",
    mentionCandidateSelected: "bg-lime-100 text-lime-900",
    mentionCandidateNormal: "text-slate-800 hover:bg-slate-900/5",
    tagSwatchRing: "ring-black/10",
    warningBox: "bg-amber-50 ring-1 ring-amber-200/80 text-amber-900",
    warningDeselect: "text-amber-950 hover:underline",
    errorBox: "bg-red-50 ring-1 ring-red-200/80 text-red-800",
    primaryButton: "bg-lead text-white hover:bg-[#1b3160]",
    primaryButtonSpinner: "bg-white",
    ghostButton: "text-slate-600 hover:bg-slate-900/5 hover:text-slate-900",
    actionDisc: "bg-lead text-white",
    actionDiscHover: "hover:bg-[#1b3160]",
    badgeBg: "bg-slate-900/10 text-slate-700",
    adminBadge: "bg-lead/10 text-lead",
    resultPillBg: SEARCH_GLASS_OPEN_LIGHT,
    resultPillText: "text-slate-900",
    resultPillRim: "ring-slate-900/10",
    resultIcon: "bg-lead text-white",
    frostOverlay: "bg-transparent",
  },
};

/** Capsule height; half of it is the radius, so the open card's corners match. */
const ROW = 64;
/** One height for every panel, so switching actions never resizes the glass. */
const PANEL_HEIGHT = 340;

const PANEL_STAGGER = stagger(0.04, 0.08);
const OPTION_LIST: Variants = { hidden: {}, show: {} };

/**
 * Opacity and y only — never `filter`. A filter on any descendant of a
 * `backdrop-filter` element poisons its frost in Chrome and Safari (see the
 * note on GLASS_ITEM in BrandSearchBar).
 */
const GLASS_ITEM: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
};

const GLASS_OPTION: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: (index: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: EASE, delay: Math.min(index * 0.02, 0.2) },
  }),
};

const NO_SCROLLBAR =
  "[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]";

const PLACEHOLDER = "";

type ActivePanel = "status" | "note" | "tag" | "assign";
type Pending = "status" | "comment" | "assign";
type TeamMember = { id: string; full_name: string | null; role?: string | null };
type TagOption = { id: string; name: string; colour?: string | null };

const clients = (count: number) => `${count} client${count === 1 ? "" : "s"}`;

function initials(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function BulkActionsBar({
  team,
  canAssign,
  tags,
  canTag,
  tone = "light",
}: {
  team: TeamMember[];
  canAssign: boolean;
  tags: TagOption[];
  canTag: boolean;
  tone?: BulkBarTone;
}) {
  const T = BULK_BAR_TONES[tone];
  const router = useRouter();
  const reducedMotion = useReducedMotionConfig();
  const { ids, statusBlockedCount, selected, deselect, clear } = useBulkSelection();
  const [status, setStatus] = useState<PipelineStatus | typeof PLACEHOLDER>(PLACEHOLDER);
  const [comment, setComment] = useState("");
  const [activePanel, setActivePanel] = useState<ActivePanel | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const composerOverlayRef = useRef<HTMLDivElement | null>(null);

  // Assign state (F253)
  const [assignOwnerId, setAssignOwnerId] = useState("");
  const [assignReason, setAssignReason] = useState("");
  const [teamQuery, setTeamQuery] = useState("");

  // Tags state (F063)
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [tagQuery, setTagQuery] = useState("");

  // F485 mention state for the comment composer. `directory` is the same
  // /api/users/mention-candidates list the single-note composer uses —
  // fetched once, on the first `@` trigger — and `inserted` remembers every
  // id chosen in this draft so `apply` can reconcile it against the text (a
  // mention typed over or deleted notifies nobody).
  const insertedRef = useRef(new Map<string, string>());
  const [mentionedNames, setMentionedNames] = useState<string[]>([]);
  const [animatedMention, setAnimatedMention] = useState<{ name: string; key: string } | null>(
    null,
  );
  const [commentCursor, setCommentCursor] = useState(0);
  const [directory, setDirectory] = useState<MentionCandidate[] | null>(null);
  const [directoryFailed, setDirectoryFailed] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);

  const count = ids.length;
  const overStatusLimit = count > MAX_BULK_STATUS_CLIENTS;
  const overNoteLimit = count > MAX_BULK_NOTE_CLIENTS;
  const overTagLimit = count > MAX_BULK_TAG_CLIENTS;
  const preparedComment = prepareComment(comment);
  const statusBlocked = statusBlockedCount > 0;

  const resetTransients = useCallback(() => {
    setError(null);
    setResult(null);
    setStatus(PLACEHOLDER);
    setComment("");
    setActivePanel(null);
    setPending(null);
    insertedRef.current.clear();
    setMentionedNames([]);
    setAnimatedMention(null);
    setMentionIndex(0);
    setDismissedStart(null);
    setSelectedTagIds(new Set());
    setTagQuery("");
    setAssignOwnerId("");
    setAssignReason("");
    setTeamQuery("");
  }, []);

  // Escape walks back one step at a time: an open @mention listbox, then the
  // confirmation (back to its panel), then the panel, then the selection
  // itself. The textarea's own key handler stops propagation for the listbox
  // case; the check here covers Escape reaching the document any other way.
  useEffect(() => {
    if (count === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      if (pending !== null) {
        setPending(null);
        return;
      }
      if (activePanel === "note" && composerRef.current) {
        const trigger = mentionQueryAtCursor(
          composerRef.current.value,
          composerRef.current.selectionStart ?? 0,
        );
        if (trigger && trigger.start !== dismissedStart) {
          setDismissedStart(trigger.start);
          return;
        }
      }
      if (activePanel !== null) {
        setActivePanel(null);
        setError(null);
        return;
      }
      clear();
      resetTransients();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [count, busy, pending, activePanel, dismissedStart, clear, resetTransients]);

  // Pointerdown outside folds the panel away (and any confirmation in it) —
  // never mid-request, or the answer would land on a closed bar. Selection
  // toggles are ignored so adding/removing clients keeps the active panel open.
  useEffect(() => {
    if (activePanel === null) return;
    const onPointerDown = (event: PointerEvent) => {
      if (busy) return;
      const target = event.target as Node | null;
      if (barRef.current?.contains(target)) return;
      const element = (
        target instanceof Element ? target : target?.parentElement
      ) as Element | null;
      if (element?.closest?.("[data-client-select], [role='checkbox']")) return;
      setActivePanel(null);
      setPending(null);
      setError(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [activePanel, busy]);

  // The success line is a moment, not a fixture.
  useEffect(() => {
    if (result === null) return;
    const id = setTimeout(() => setResult(null), 4000);
    return () => clearTimeout(id);
  }, [result]);

  // Views mount after the previous one's exit (mode="wait"), so an effect
  // keyed on state would fire before the element exists. Stable callback refs
  // run exactly when it does.
  const attachComposer = useCallback((element: HTMLTextAreaElement | null) => {
    composerRef.current = element;
    element?.focus({ preventScroll: true });
  }, []);
  const focusOnMount = useCallback((element: HTMLElement | null) => {
    element?.focus({ preventScroll: true });
  }, []);

  const deselectStatusBlocked = useCallback(
    () =>
      deselect([...selected].filter(([, canStatus]) => !canStatus).map(([id]) => id)),
    [selected, deselect],
  );

  function togglePanel(panel: ActivePanel) {
    if (busy) return;
    setError(null);
    setPending(null);
    setActivePanel((prev) => (prev === panel ? null : panel));
  }

  // F485: the @mention trigger under the comment caret, if any. Routing on
  // chosen ids (not on parsing `@Name` out of the text) is what keeps an
  // email address or a bare `@` from becoming a notification.
  const mentionTrigger = mentionQueryAtCursor(comment, commentCursor);
  const mentionSuggestions =
    mentionTrigger && directory ? filterMentionCandidates(directory, mentionTrigger.query) : [];
  const mentionListOpen =
    activePanel === "note" &&
    pending === null &&
    mentionTrigger !== null &&
    mentionTrigger.start !== dismissedStart &&
    !directoryFailed &&
    (directory === null || mentionSuggestions.length > 0);

  function ensureDirectory() {
    if (directory !== null || directoryFailed) return;
    // Shared session cache (mention-directory.ts): typing `@` in both note
    // composers still costs a single request, and only when mentions are used.
    void getMentionDirectory()
      .then((users) => setDirectory(users))
      .catch(() => setDirectoryFailed(true));
  }

  function chooseMention(candidate: MentionCandidate) {
    const next = applyMentionInsertion(comment, commentCursor, candidate);
    insertedRef.current.set(candidate.id, candidate.fullName);
    setMentionedNames([...insertedRef.current.values()]);
    setAnimatedMention({ name: candidate.fullName, key: `${candidate.id}-${next.cursor}` });
    setComment(next.value);
    setMentionIndex(0);
    setDismissedStart(null);
    requestAnimationFrame(() => {
      composerRef.current?.setSelectionRange(next.cursor, next.cursor);
      setCommentCursor(next.cursor);
      composerRef.current?.focus();
    });
  }

  function onComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!mentionListOpen) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (directory === null || mentionSuggestions.length === 0) return;
      setMentionIndex((prev) =>
        event.key === "ArrowDown"
          ? (prev + 1) % mentionSuggestions.length
          : (prev - 1 + mentionSuggestions.length) % mentionSuggestions.length,
      );
    } else if (event.key === "Enter" || event.key === "Tab") {
      const candidate = directory === null ? undefined : mentionSuggestions[mentionIndex];
      if (candidate) {
        event.preventDefault();
        chooseMention(candidate);
      }
    } else if (event.key === "Escape") {
      // Dismiss the listbox only — and stop the key reaching the document
      // listener, which would otherwise close the whole composer.
      event.preventDefault();
      event.stopPropagation();
      if (mentionTrigger) setDismissedStart(mentionTrigger.start);
    }
  }

  const showResult = result !== null && count === 0;

  function finishWith(message: string) {
    setPending(null);
    setActivePanel(null);
    clear();
    setResult(message);
    router.refresh();
  }

  async function apply(action: Pending) {
    setBusy(true);
    setError(null);
    try {
      let endpoint = "";
      let payload: unknown = null;
      if (action === "status") {
        endpoint = "/api/clients/bulk-status";
        payload = { ids, status };
      } else if (action === "comment") {
        endpoint = "/api/clients/bulk-note";
        // Only ids whose `@Name` is still mentioned in the draft are sent,
        // capped per name at its occurrence count — a mention typed over,
        // deleted, or extended into a different name takes its id with it.
        // Each id echoes the name as inserted, so a rename before saving
        // keeps the mention.
        const mentionedUsers = limitMentionIdsByOccurrences(
          comment,
          [...insertedRef.current.entries()].map(([id, name]) => ({ id, name })),
        )
          .map((id) => ({ id, name: insertedRef.current.get(id) ?? "" }))
          .filter((user) => user.name !== "");
        payload = {
          ids,
          comment: preparedComment.ok ? preparedComment.content : comment,
          mentionedUsers,
        };
      } else {
        // assign
        if (!assignOwnerId) {
          setError("Choose a team member to assign, or Unassigned.");
          setPending(null);
          return;
        }
        if (!assignReason.trim()) {
          setError("A reason is required so the handover can be understood later.");
          setPending(null);
          return;
        }
        const targetOwnerId = assignOwnerId === "unassigned" ? null : assignOwnerId;
        endpoint = "/api/clients/bulk-assign-owner";
        payload = {
          organisationIds: ids,
          newOwnerId: targetOwnerId,
          ownerId: targetOwnerId,
          reason: assignReason.trim(),
        };
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (response.ok) {
        if (action === "status") setStatus(PLACEHOLDER);
        else if (action === "comment") {
          setComment("");
          insertedRef.current.clear();
          setMentionedNames([]);
          setAnimatedMention(null);
          setMentionIndex(0);
          setDismissedStart(null);
        } else {
          setAssignOwnerId("");
          setAssignReason("");
          setTeamQuery("");
        }
        finishWith(
          body.message ??
            (action === "status"
              ? "The selected clients were updated."
              : action === "comment"
                ? "The comment was added to the selected clients."
                : `Assigned ${clients(count)}.`),
        );
        return;
      }
      setError(
        body.error ??
          (action === "status"
            ? "These statuses could not be changed."
            : action === "comment"
              ? "The comment could not be added."
              : "These clients could not be assigned."),
      );
      setPending(null);
    } catch {
      setError("Could not reach the server. Nothing was changed — check your connection.");
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  const label = status === PLACEHOLDER ? "" : formatOutreachStatus(status);

  // F063 AC1: one or more existing tags applied to every selected client in a
  // single action. Applies immediately — additive and reversible via F192 — and
  // reports through the same result/error lines as the rest of the bar.
  async function applyTags() {
    if (selectedTagIds.size === 0) {
      setError("Choose at least one tag to apply.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/clients/bulk-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, tagIds: [...selectedTagIds] }),
      });
      const body = await response.json();
      if (response.ok) {
        setSelectedTagIds(new Set());
        setTagQuery("");
        finishWith(body.message ?? "The tags were applied to the selected clients.");
        return;
      }
      setError(body.error ?? "The tags could not be applied.");
    } catch {
      setError("Could not reach the server. Nothing was changed — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  const toggleTag = (tagId: string) =>
    setSelectedTagIds((current) => {
      const next = new Set(current);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });

  const trimmedTagQuery = tagQuery.trim().toLowerCase();
  const visibleTags = trimmedTagQuery
    ? tags.filter((tag) => tag.name.toLowerCase().includes(trimmedTagQuery))
    : tags;

  const trimmedTeamQuery = teamQuery.trim().toLowerCase();
  const visibleTeam = trimmedTeamQuery
    ? team.filter((member) =>
        (member.full_name ?? (member.role === "admin" ? "Unnamed Admin" : "Unnamed CAM"))
          .toLowerCase()
          .includes(trimmedTeamQuery),
      )
    : team;
  const assigneeName =
    assignOwnerId === "unassigned"
      ? "Unassigned"
      : team.find((member) => member.id === assignOwnerId)?.full_name ??
        (team.find((member) => member.id === assignOwnerId)?.role === "admin"
          ? "Unnamed Admin"
          : "Unnamed CAM");
  const canReviewAssign = !busy && assignOwnerId !== "" && assignReason.trim() !== "";

  const pillMotion = reducedMotion
    ? { initial: false, animate: { opacity: 1 } }
    : {
        initial: { y: 36, opacity: 0 },
        animate: { y: 0, opacity: 1 },
        exit: { y: 36, opacity: 0 },
        transition: { duration: 0.3, ease: EASE },
      };

  const panelOpen = activePanel !== null;
  const view = pending !== null ? `confirm-${pending}` : activePanel;

  function renderView() {
    if (pending !== null) {
      const copy =
        pending === "status"
          ? {
              title: `Move ${clients(count)} to ${label}?`,
              description: `Applies to every selected client in one action, including any the current filter hides. Clients already on ${label} are left alone.`,
              details: [
                { label: "Clients", value: String(count) },
                { label: "New status", value: label },
                { label: "Undo", value: "Client by client only" },
              ],
              confirm: `Update ${count}`,
              working: "Updating…",
            }
          : pending === "comment"
            ? {
                title: `Add this note to ${clients(count)}?`,
                description:
                  "Each client gets its own copy under your name. Owners, and anyone you @mentioned, are notified.",
                details: [
                  { label: "Clients", value: String(count) },
                  { label: "Undo", value: "Delete on each client" },
                ],
                confirm: `Add to ${count}`,
                working: "Adding…",
              }
            : {
                title:
                  assignOwnerId === "unassigned"
                    ? `Release ${clients(count)} to unassigned pool?`
                    : `Assign ${clients(count)} to ${assigneeName}?`,
                description:
                  assignOwnerId === "unassigned"
                    ? "Clients return to the unowned pool and open tasks are unassigned."
                    : "Ownership and open tasks move together, recorded in each client's audit log.",
                details: [
                  { label: "New owner", value: assigneeName },
                  { label: "Reason", value: assignReason.trim() },
                ],
                confirm: assignOwnerId === "unassigned" ? `Release ${count}` : `Assign ${count}`,
                working: assignOwnerId === "unassigned" ? "Releasing…" : "Assigning…",
              };

      return (
        <>
          <motion.p
            variants={GLASS_ITEM}
            className={`font-body shrink-0 px-1 text-xl font-medium ${T.title}`}
          >
            {copy.title}
          </motion.p>
          <motion.p
            variants={GLASS_ITEM}
            className={`mt-1.5 shrink-0 px-1 text-[13px] leading-[1.6] ${T.textMuted}`}
          >
            {copy.description}
          </motion.p>
          <motion.dl
            variants={GLASS_ITEM}
            className={`mt-4 flex shrink-0 flex-col gap-2 rounded-2xl ${T.dlBg} px-4 py-3`}
          >
            {copy.details.map((detail) => (
              <div className="flex items-baseline gap-4" key={detail.label}>
                <dt className={`shrink-0 text-[12px] ${T.textFaint}`}>{detail.label}</dt>
                <dd className={`min-w-0 flex-1 truncate text-right text-[13px] font-medium ${T.textPrimary}`}>
                  {detail.value}
                </dd>
              </div>
            ))}
          </motion.dl>
          {pending === "comment" && (
            <motion.div
              variants={GLASS_ITEM}
              className={`mt-2 min-h-0 flex-1 overflow-y-auto rounded-2xl ${T.commentBg} px-4 py-3 text-[14px] leading-[1.6] break-words whitespace-pre-wrap ${T.commentText} ${NO_SCROLLBAR}`}
            >
              {splitNoteContentMentions(
                preparedComment.ok ? preparedComment.content : comment,
                mentionedNames,
              ).map((part, index) =>
                part.mention ? (
                  <MentionTag key={index} text={part.text} variant={T.mentionVariant} animate={false} />
                ) : (
                  <span key={index}>{part.text}</span>
                ),
              )}
            </motion.div>
          )}
          <motion.div
            variants={GLASS_ITEM}
            className="mt-auto flex shrink-0 items-center justify-end gap-2 pt-3"
          >
            <GhostButton ref={focusOnMount} disabled={busy} onClick={() => setPending(null)} T={T}>
              Back
            </GhostButton>
            <PrimaryPill busy={busy} disabled={busy} onClick={() => apply(pending)} T={T}>
              {busy ? copy.working : copy.confirm}
            </PrimaryPill>
          </motion.div>
        </>
      );
    }

    if (activePanel === "status") {
      return (
        <>
          <PanelHeader title="Change status" meta={clients(count)} T={T} />
          {(statusBlocked || overStatusLimit) && (
            <motion.p
              variants={GLASS_ITEM}
              className={`mt-3 shrink-0 rounded-2xl ${T.warningBox} px-3.5 py-2.5 text-[13px] leading-[1.55]`}
            >
              {statusBlocked ? (
                <>
                  <span className="font-semibold">
                    {statusBlockedCount} of {count} {statusBlockedCount === 1 ? "isn't" : "aren't"}{" "}
                    yours to change.
                  </span>{" "}
                  It&apos;s all-or-nothing —{" "}
                  <button
                    type="button"
                    className={`font-semibold underline underline-offset-2 ${T.outline} ${T.warningDeselect}`}
                    disabled={busy}
                    onClick={deselectStatusBlocked}
                  >
                    deselect {statusBlockedCount === 1 ? "it" : "them"}
                  </button>{" "}
                  or ask an admin.
                </>
              ) : (
                `One change covers at most ${MAX_BULK_STATUS_CLIENTS} clients. Deselect some to continue.`
              )}
            </motion.p>
          )}
          <motion.ul
            variants={OPTION_LIST}
            className={`mt-3 grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-1 overflow-y-auto ${NO_SCROLLBAR}`}
          >
            {PIPELINE_STATUSES.map((option, index) => (
              <OptionRow
                key={option}
                index={index}
                selected={status === option}
                disabled={busy || overStatusLimit}
                onClick={() => setStatus(option)}
                T={T}
              >
                <span className="truncate">{formatOutreachStatus(option)}</span>
              </OptionRow>
            ))}
          </motion.ul>
          <PanelFooter
            T={T}
            hint={
              status !== PLACEHOLDER ? (
                <>
                  Moving to <span className={`font-medium ${T.title}`}>{label}</span>
                </>
              ) : (
                "Pick where they're going"
              )
            }
          >
            <PrimaryPill
              disabled={busy || status === PLACEHOLDER || overStatusLimit || statusBlocked}
              onClick={() => setPending("status")}
              T={T}
            >
              Review
            </PrimaryPill>
          </PanelFooter>
        </>
      );
    }

    if (activePanel === "note") {
      const draftMentionParts = splitNoteContentMentions(comment, mentionedNames);
      return (
        <>
          <PanelHeader title="Add a note" meta={clients(count)} T={T} />
          <motion.div
            variants={GLASS_ITEM}
            className={`mt-3 flex min-h-0 flex-1 flex-col rounded-2xl ${T.fieldBg} px-4 pt-3 pb-2 transition-shadow ${T.fieldFocusRing}`}
          >
            <div className="relative min-h-0 flex-1">
              <div
                ref={composerOverlayRef}
                aria-hidden="true"
                className={`font-body pointer-events-none absolute inset-0 overflow-hidden text-[15px] leading-[1.6] break-words whitespace-pre-wrap ${NO_SCROLLBAR}`}
              >
                {draftMentionParts.map((part, index) =>
                  part.mention ? (
                    <MentionTag
                      key={`${index}-${part.text}-${animatedMention?.key ?? ""}`}
                      text={part.text}
                      variant={T.mentionVariant}
                      animate={animatedMention?.name === part.text.slice(1)}
                      // Metric-stable: the overlay sits under a transparent
                      // textarea, so the highlight must measure like plain
                      // text or the caret drifts from the visible glyphs.
                      matchTextarea
                    />
                  ) : (
                    <span key={index} className={T.textPrimary}>
                      {part.text}
                    </span>
                  ),
                )}
              </div>
              <textarea
                ref={attachComposer}
                id="bulk-comment"
                aria-label={`Note for ${clients(count)}`}
                className={`font-body relative min-h-0 w-full h-full resize-none bg-transparent text-[15px] leading-[1.6] whitespace-pre-wrap break-words text-transparent ${T.caret} outline-none ${T.placeholder} ${NO_SCROLLBAR}`}
                placeholder="Write the same note for every selected client…"
                value={comment}
                maxLength={MAX_NOTE_LENGTH}
                disabled={busy}
                role="combobox"
                aria-expanded={mentionListOpen}
                aria-controls={mentionListOpen ? "bulk-comment-mentions" : undefined}
                aria-activedescendant={
                  mentionListOpen && directory !== null && mentionSuggestions[mentionIndex]
                    ? `bulk-comment-mentions-${mentionSuggestions[mentionIndex].id}`
                    : undefined
                }
                onChange={(event) => {
                  setComment(event.target.value);
                  setMentionIndex(0);
                  setDismissedStart(null);
                  setCommentCursor(event.target.selectionStart ?? event.target.value.length);
                  if (mentionQueryAtCursor(event.target.value, event.target.selectionStart ?? 0)) {
                    ensureDirectory();
                  }
                }}
                onSelect={(event) =>
                  setCommentCursor(
                    event.currentTarget.selectionStart ?? event.currentTarget.value.length,
                  )
                }
                onKeyDown={onComposerKeyDown}
                onScroll={(event) => {
                  if (composerOverlayRef.current) {
                    composerOverlayRef.current.scrollTop = event.currentTarget.scrollTop;
                    composerOverlayRef.current.scrollLeft = event.currentTarget.scrollLeft;
                  }
                }}
              />
            </div>
            <div className={`flex shrink-0 items-center justify-between pt-1 text-[12px] ${T.textSubtle}`}>
              <span>Type @ to mention a teammate</span>
              <span className="tabular-nums">
                {comment.length} / {MAX_NOTE_LENGTH}
              </span>
            </div>
          </motion.div>
          <AnimatePresence initial={false}>
            {mentionListOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: EASE }}
                className="shrink-0 overflow-hidden"
              >
                {directory === null ? (
                  <p className={`px-3 pt-2 text-[13px] ${T.textMuted}`} role="status">
                    Finding teammates…
                  </p>
                ) : (
                  <ul
                    id="bulk-comment-mentions"
                    role="listbox"
                    aria-label="Mention a teammate"
                    className={`mt-2 flex max-h-[112px] flex-col gap-0.5 overflow-y-auto ${NO_SCROLLBAR}`}
                  >
                    {mentionSuggestions.map((candidate, index) => (
                      <li
                        key={candidate.id}
                        id={`bulk-comment-mentions-${candidate.id}`}
                        role="option"
                        aria-selected={index === mentionIndex}
                      >
                        <button
                          type="button"
                          className={`font-body flex w-full items-center gap-2.5 rounded-2xl px-3 py-1.5 text-left text-[15px] font-medium transition-colors ${
                            index === mentionIndex
                              ? T.mentionCandidateSelected
                              : T.mentionCandidateNormal
                          }`}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => chooseMention(candidate)}
                          onMouseEnter={() => setMentionIndex(index)}
                        >
                          <AtSign aria-hidden="true" className="h-4 w-4 shrink-0 opacity-60" />
                          <span className="truncate">{candidate.fullName}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          <PanelFooter
            T={T}
            hint={
              overNoteLimit ? (
                <span className="text-amber-500 font-medium">
                  One note covers at most {MAX_BULK_NOTE_CLIENTS} clients.
                </span>
              ) : (
                "Every selected client gets its own copy"
              )
            }
          >
            <PrimaryPill
              disabled={busy || !preparedComment.ok || overNoteLimit}
              onClick={() => setPending("comment")}
              T={T}
            >
              Review
            </PrimaryPill>
          </PanelFooter>
        </>
      );
    }

    if (activePanel === "tag") {
      return (
        <>
          <PanelHeader
            title="Apply tags"
            meta={selectedTagIds.size > 0 ? `${selectedTagIds.size} chosen` : clients(count)}
            T={T}
          />
          <PanelSearch
            label="Search tags"
            placeholder="Search tags…"
            value={tagQuery}
            onChange={setTagQuery}
            T={T}
          />
          <motion.ul
            variants={OPTION_LIST}
            className={`mt-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto ${NO_SCROLLBAR}`}
          >
            {visibleTags.map((tag, index) => (
              <OptionRow
                key={tag.id}
                index={index}
                selected={selectedTagIds.has(tag.id)}
                disabled={busy}
                onClick={() => toggleTag(tag.id)}
                T={T}
              >
                <span
                  aria-hidden="true"
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ring-1 ${T.tagSwatchRing}`}
                  style={{ backgroundColor: tag.colour ?? "transparent" }}
                />
                <span className="truncate">{tag.name}</span>
              </OptionRow>
            ))}
            {visibleTags.length === 0 && (
              <EmptyRow T={T}>
                {trimmedTagQuery ? `No tag matches “${tagQuery.trim()}”.` : "No tags yet."}
              </EmptyRow>
            )}
          </motion.ul>
          <PanelFooter
            T={T}
            hint={
              overTagLimit ? (
                <span className="text-amber-500 font-medium">
                  At most {MAX_BULK_TAG_CLIENTS} clients — deselect some.
                </span>
              ) : selectedTagIds.size > 0 ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setSelectedTagIds(new Set())}
                  className={`rounded-full transition-colors ${T.textMuted} hover:${T.title} ${T.outline}`}
                >
                  Clear choice
                </button>
              ) : (
                "Added alongside existing tags"
              )
            }
          >
            <PrimaryPill
              busy={busy}
              disabled={busy || selectedTagIds.size === 0 || overTagLimit}
              onClick={applyTags}
              T={T}
            >
              {busy ? "Applying…" : `Apply to ${count}`}
            </PrimaryPill>
          </PanelFooter>
        </>
      );
    }

    // assign
    return (
      <>
        <PanelHeader title="Assign owner" meta={clients(count)} T={T} />
        <PanelSearch
          label="Search team"
          placeholder="Search team…"
          value={teamQuery}
          onChange={setTeamQuery}
          T={T}
        />
        <motion.ul
          variants={OPTION_LIST}
          className={`mt-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto ${NO_SCROLLBAR}`}
        >
          <OptionRow
            key="unassigned"
            index={0}
            selected={assignOwnerId === "unassigned"}
            disabled={busy}
            onClick={() =>
              setAssignOwnerId((current) => (current === "unassigned" ? "" : "unassigned"))
            }
            T={T}
          >
            <span
              aria-hidden="true"
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${T.badgeBg} text-[10px] font-semibold tracking-wide`}
            >
              UA
            </span>
            <span className="truncate">Unassigned</span>
          </OptionRow>
          {visibleTeam.map((member, index) => (
            <OptionRow
              key={member.id}
              index={index + 1}
              selected={assignOwnerId === member.id}
              disabled={busy}
              onClick={() =>
                setAssignOwnerId((current) => (current === member.id ? "" : member.id))
              }
              T={T}
            >
              <span
                aria-hidden="true"
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${T.badgeBg} text-[10px] font-semibold tracking-wide`}
              >
                {initials(member.full_name)}
              </span>
              <span className="truncate">
                {member.full_name ?? (member.role === "admin" ? "Unnamed Admin" : "Unnamed CAM")}
              </span>
              {member.role === "admin" && (
                <span className={`ml-auto shrink-0 rounded ${T.adminBadge} px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider`}>
                  Admin
                </span>
              )}
            </OptionRow>
          ))}
          {visibleTeam.length === 0 && (
            <EmptyRow T={T}>
              {trimmedTeamQuery
                ? `No one matches “${teamQuery.trim()}”.`
                : "No team members to assign."}
            </EmptyRow>
          )}
        </motion.ul>
        {/* The ask field's shape: the last thing to fill in carries the go disc. */}
        <motion.div
          variants={GLASS_ITEM}
          className={`mt-3 flex shrink-0 items-center gap-2 rounded-2xl ${T.fieldBg} py-1.5 pr-1.5 pl-4 transition-shadow ${T.fieldFocusRing}`}
        >
          <input
            type="text"
            value={assignReason}
            disabled={busy}
            aria-label="Reason for the handover"
            placeholder="Reason for the handover (audit log)"
            onChange={(event) => setAssignReason(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canReviewAssign) {
                event.preventDefault();
                setPending("assign");
              }
            }}
            className={`font-body min-w-0 flex-1 bg-transparent text-[15px] ${T.textPrimary} ${T.caret} outline-none ${T.placeholder}`}
          />
          <button
            type="button"
            aria-label="Review assignment"
            disabled={!canReviewAssign}
            onClick={() => setPending("assign")}
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${T.actionDisc} ${T.actionDiscHover} transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${T.outline}`}
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        </motion.div>
      </>
    );
  }

  return (
    <>
      <AnimatePresence>
        {count > 0 && (
          <motion.div
            {...pillMotion}
            className="fixed inset-x-0 bottom-6 z-40 mx-auto w-[min(36rem,calc(100vw-2rem))]"
            role="region"
            aria-label="Bulk actions"
          >
            {/* justify-end pins the capsule to the bottom edge, so as the card's
                height grows the clip reveals the panel from the top down — the
                glass unfolds upwards and the row never moves. */}
            <motion.div
              ref={barRef}
              className="relative flex w-full flex-col justify-end overflow-hidden backdrop-blur-[20px]"
              style={{
                boxShadow: T.shadow,
                borderRadius: ROW / 2,
              }}
              animate={{
                height: panelOpen ? "auto" : ROW,
                backgroundColor: panelOpen ? T.glassOpen : T.glassClosed,
              }}
              initial={false}
              transition={
                reducedMotion
                  ? { duration: 0 }
                  : {
                      height: { duration: 0.6, ease: EASE },
                      backgroundColor: { duration: 0.7, ease: EASE },
                    }
              }
            >
              {/* Frost on its own childless leaf — see BrandSearchBar. */}
              <div
                className="pointer-events-none absolute inset-0 z-0 rounded-[inherit] backdrop-blur-[20px]"
                aria-hidden="true"
              />
              <div
                className={`pointer-events-none absolute inset-0 z-30 rounded-[inherit] ring-1 ${T.rim} ring-inset`}
                aria-hidden="true"
              />
              <motion.div
                className={`pointer-events-none absolute inset-0 z-0 ${T.frostOverlay}`}
                initial={false}
                animate={{ opacity: panelOpen ? 1 : 0 }}
                transition={{ duration: 0.3, ease: EASE }}
              />

              {/* PANEL — above the capsule, one fixed height for every action. */}
              <AnimatePresence initial={false}>
                {panelOpen && (
                  <motion.div
                    key="panel"
                    id="bulk-actions-panel"
                    className="relative z-10 flex shrink-0 flex-col"
                    style={{ height: PANEL_HEIGHT }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.18, ease: EASE } }}
                    transition={{ duration: 0.5, ease: EASE, delay: 0.2 }}
                  >
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={view}
                        className="flex min-h-0 flex-1 flex-col px-5 pt-5 pb-3"
                        variants={PANEL_STAGGER}
                        initial="hidden"
                        animate="show"
                        exit={{ opacity: 0, y: -6, transition: { duration: 0.15, ease: EASE } }}
                      >
                        {renderView()}
                      </motion.div>
                    </AnimatePresence>
                    <AnimatePresence initial={false}>
                      {error && (
                        <motion.p
                          role="alert"
                          aria-live="polite"
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.25, ease: EASE }}
                          className={`mx-5 mb-3 shrink-0 rounded-2xl ${T.errorBox} px-3.5 py-2 text-[13px] font-medium`}
                        >
                          {error}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* CAPSULE — always the bottom row. */}
              <div
                className={`relative z-20 flex shrink-0 items-center gap-3 rounded-full pr-3 pl-6 ${
                  panelOpen ? T.innerRow : T.innerRowClosed
                }`}
                style={{ height: ROW }}
              >
                <p
                  className="font-body flex min-w-0 flex-1 items-baseline gap-[0.4ch] text-[15px] whitespace-nowrap sm:text-base"
                  aria-live="polite"
                >
                  <RollingCount value={count} reducedMotion={reducedMotion ?? false} toneClass={T.activeText} />
                  <span className={T.textPrimary}>
                    {count === 1 ? "client" : "clients"} selected
                  </span>
                  <span className={`hidden truncate ${T.textSecondary} sm:inline`}>
                    across all filters
                  </span>
                </p>

                <div className="flex shrink-0 items-center gap-0.5">
                  <BarIcon
                    label={activePanel === "status" ? "Close status options" : "Change status"}
                    expanded={activePanel === "status"}
                    active={activePanel === "status"}
                    disabled={busy}
                    onClick={() => togglePanel("status")}
                    marker={
                      status !== PLACEHOLDER ? "lime" : statusBlocked ? "amber" : undefined
                    }
                    T={T}
                  >
                    <Workflow size={18} />
                  </BarIcon>
                  <BarIcon
                    label={activePanel === "note" ? "Close note composer" : "Add a note"}
                    expanded={activePanel === "note"}
                    active={activePanel === "note"}
                    disabled={busy}
                    onClick={() => togglePanel("note")}
                    marker={comment.trim().length > 0 ? "lime" : undefined}
                    T={T}
                  >
                    <MessageSquarePlus size={18} />
                  </BarIcon>
                  {canTag && (
                    <BarIcon
                      label={activePanel === "tag" ? "Close tags" : "Apply tags"}
                      expanded={activePanel === "tag"}
                      active={activePanel === "tag"}
                      disabled={busy || overTagLimit || tags.length === 0}
                      onClick={() => togglePanel("tag")}
                      marker={selectedTagIds.size > 0 ? "lime" : undefined}
                      T={T}
                    >
                      <Tag size={18} />
                    </BarIcon>
                  )}
                  {canAssign && (
                    <BarIcon
                      label={activePanel === "assign" ? "Close assign owner" : "Assign owner"}
                      expanded={activePanel === "assign"}
                      active={activePanel === "assign"}
                      disabled={busy}
                      onClick={() => togglePanel("assign")}
                      marker={assignOwnerId ? "lime" : undefined}
                      T={T}
                    >
                      <User size={18} />
                    </BarIcon>
                  )}

                  <span className={`mx-1.5 h-5 w-px ${T.divider}`} aria-hidden="true" />

                  <BarIcon
                    label="Clear selection"
                    disabled={busy}
                    onClick={() => {
                      clear();
                      resetTransients();
                    }}
                    T={T}
                  >
                    <XIcon size={18} />
                  </BarIcon>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showResult && (
          <motion.div
            key="bulk-result"
            className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4"
            initial={reducedMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.35, ease: EASE, delay: reducedMotion ? 0 : 0.15 }}
          >
            <p
              role="status"
              className={`font-body flex items-center gap-3 rounded-full py-2 pr-5 pl-2 text-[15px] ${T.resultPillText} ring-1 ${T.resultPillRim} backdrop-blur-[20px]`}
              style={{
                backgroundColor: T.resultPillBg,
                boxShadow: T.shadow,
              }}
            >
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${T.resultIcon}`}>
                <Check className="h-4 w-4" />
              </span>
              {result}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* ─── Pieces ─────────────────────────────────────────────────────────────── */

/**
 * A bare icon on the glass — no chip behind it. Active reads as lime ink plus
 * a dot that glides between icons (shared layoutId), so switching panels shows
 * *where* you moved rather than one chip blinking off and another on.
 */
function BarIcon({
  label,
  expanded,
  active = false,
  disabled,
  onClick,
  marker,
  T,
  children,
}: {
  label: string;
  expanded?: boolean;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  /** Something is staged in this panel (lime) or needs attention (amber). */
  marker?: "lime" | "amber";
  T: (typeof BULK_BAR_TONES)[BulkBarTone];
  children: React.ReactNode;
}) {
  return (
    <InfoTooltip
      title={label}
      side="top"
      sideOffset={10}
      contentClassName="px-3 py-1.5 text-xs font-semibold"
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={expanded}
        aria-controls={expanded ? "bulk-actions-panel" : undefined}
        disabled={disabled}
        onClick={onClick}
        className={`relative grid h-9 w-9 place-items-center rounded-full transition-colors duration-200 disabled:pointer-events-none disabled:opacity-30 ${T.outline} ${
          active ? T.iconActive : T.iconColor
        }`}
      >
        <AnimateIcon animateOnHover className="flex size-full items-center justify-center">
          {children}
        </AnimateIcon>
        {marker && !active && (
          <span
            aria-hidden="true"
            className={`absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full ${
              marker === "lime" ? T.markerLime : T.markerAmber
            }`}
          />
        )}
        {active && (
          <motion.span
            layoutId="bulk-bar-active-dot"
            aria-hidden="true"
            className={`absolute bottom-0 left-1/2 -ml-0.5 h-1 w-1 rounded-full ${T.activeDot}`}
            transition={{ duration: 0.4, ease: EASE }}
          />
        )}
      </button>
    </InfoTooltip>
  );
}

/** The count rolls rather than blinks when rows are ticked on and off. */
function RollingCount({
  value,
  reducedMotion,
  toneClass = "text-[#e6f5c0]",
}: {
  value: number;
  reducedMotion: boolean;
  toneClass?: string;
}) {
  return (
    <span className={`relative inline-flex overflow-hidden font-semibold tabular-nums ${toneClass}`}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          initial={reducedMotion ? false : { y: "80%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reducedMotion ? { opacity: 0 } : { y: "-80%", opacity: 0 }}
          transition={{ duration: 0.35, ease: EASE }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function PanelHeader({
  title,
  meta,
  T,
}: {
  title: string;
  meta?: string;
  T: (typeof BULK_BAR_TONES)[BulkBarTone];
}) {
  return (
    <motion.div
      variants={GLASS_ITEM}
      className="flex shrink-0 items-baseline justify-between gap-3 px-1"
    >
      <p className={`font-body text-lg font-medium ${T.title}`}>{title}</p>
      {meta && <p className={`font-body text-[13px] ${T.textMuted}`}>{meta}</p>}
    </motion.div>
  );
}

function PanelSearch({
  label,
  placeholder,
  value,
  onChange,
  T,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  T: (typeof BULK_BAR_TONES)[BulkBarTone];
}) {
  return (
    <motion.label
      variants={GLASS_ITEM}
      className={`mt-3 flex shrink-0 items-center gap-2.5 rounded-xl ${T.fieldBg} px-3.5 py-2 transition-shadow ${T.fieldFocusRing}`}
    >
      <Search aria-hidden="true" className={`h-4 w-4 shrink-0 ${T.textSubtle}`} />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`font-body min-w-0 flex-1 bg-transparent text-[15px] ${T.textPrimary} ${T.caret} outline-none ${T.placeholder} [&::-webkit-search-cancel-button]:hidden`}
      />
    </motion.label>
  );
}

function OptionRow({
  index,
  selected,
  disabled,
  onClick,
  T,
  children,
}: {
  index: number;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  T: (typeof BULK_BAR_TONES)[BulkBarTone];
  children: React.ReactNode;
}) {
  return (
    <motion.li variants={GLASS_OPTION} custom={index} className="min-w-0">
      <button
        type="button"
        aria-pressed={selected}
        disabled={disabled}
        onClick={onClick}
        className={`font-body flex w-full items-center justify-between gap-2 rounded-2xl px-3 py-2 text-left text-[15px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${T.outline} ${
          selected ? T.rowSelected : `${T.title} ${T.rowHover}`
        }`}
      >
        <span className="flex min-w-0 items-center gap-2.5">{children}</span>
        {selected && <Check aria-hidden="true" className={`h-4 w-4 shrink-0 ${T.rowSelectedCheck}`} />}
      </button>
    </motion.li>
  );
}

function EmptyRow({
  children,
  T,
}: {
  children: React.ReactNode;
  T: (typeof BULK_BAR_TONES)[BulkBarTone];
}) {
  return (
    <motion.li
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: EASE }}
      className={`font-body px-3 py-3 text-[15px] ${T.textMuted}`}
      role="status"
    >
      {children}
    </motion.li>
  );
}

function PanelFooter({
  hint,
  T,
  children,
}: {
  hint: React.ReactNode;
  T: (typeof BULK_BAR_TONES)[BulkBarTone];
  children: React.ReactNode;
}) {
  return (
    <motion.div
      variants={GLASS_ITEM}
      className="mt-auto flex shrink-0 items-center justify-between gap-3 pt-3"
    >
      <p className={`font-body min-w-0 truncate px-1 text-[13px] ${T.textMuted}`}>{hint}</p>
      {children}
    </motion.div>
  );
}

function PrimaryPill({
  busy = false,
  disabled,
  onClick,
  T,
  children,
}: {
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  T: (typeof BULK_BAR_TONES)[BulkBarTone];
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`font-body inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full ${T.primaryButton} pr-3 pl-4 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${T.outline}`}
    >
      {children}
      {busy ? (
        <span
          aria-hidden="true"
          className={`ml-0.5 h-3.5 w-3.5 animate-spin rounded-[3px] ${T.primaryButtonSpinner}`}
          style={{ animationDuration: "2.5s" }}
        />
      ) : (
        <ArrowRight aria-hidden="true" className="h-4 w-4" />
      )}
    </button>
  );
}

function GhostButton({
  ref,
  disabled,
  onClick,
  T,
  children,
}: {
  ref?: React.Ref<HTMLButtonElement>;
  disabled?: boolean;
  onClick: () => void;
  T: (typeof BULK_BAR_TONES)[BulkBarTone];
  children: React.ReactNode;
}) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`font-body h-9 rounded-full px-4 text-[13px] font-semibold ${T.ghostButton} transition-colors disabled:opacity-40 ${T.outline}`}
    >
      {children}
    </button>
  );
}
