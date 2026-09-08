"use client";

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import {
  X,
  Minus,
  Maximize2,
  Minimize2,
  PenLine,
  Trash2,
  Loader2,
  Check,
  BookOpen,
  Building2,
  ChevronLeft,
  Mail,
  Phone,
  MapPin,
  ChevronDown,
  type LucideIcon,
  CalendarClock,
  UserPlus,
  Paperclip,
  MoreVertical,
  SpellCheck2,
  FileText,
  Tag,
} from "lucide-react";
import { LoaderPinwheel } from "@/components/animate-ui/icons/loader-pinwheel";
import { AiThinkingState } from "@/components/ui/ai-thinking-state";
import { StreamingDraftText } from "@/components/ui/streaming-draft-text";
import { useStageOneDraftStream } from "@/components/outreach/use-stage-one-draft-stream";
import { GooeyEmailInput } from "@/components/ui/gooey-email-input";
import { SendButton } from "@/components/ui/send-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/animate-ui/components/radix/tooltip";
import { EASE, stagger } from "@/components/brand/motion";
import { LIP } from "@/components/brand/tokens";
import type { AddressableClient } from "@/lib/inbox/real-threads";
import type { InboxThreadTag } from "@/lib/inbox-thread-view";
import { mockFillThreads } from "@/lib/inbox-mock-data";
import { attachDraftFile } from "@/app/clients/[id]/outreach-actions";
import {
  assignTagsBatchAction,
  createAndAssignTagAction,
} from "@/lib/tags/tag-actions";
import { createClient as createBrowserSupabase } from "@/lib/supabase/browser";
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  attachmentUploadFailureMessage,
  buildAttachmentStoragePath,
  formatFileSize,
  validateAttachmentFile,
  validateDraftAttachmentSet,
} from "@/lib/attachments";
import {
  fillAsAddressableClients,
  resolveRecipientThread,
  searchRecipients,
  type RecipientMatch,
} from "@/lib/inbox/recipients";
import {
  EMAIL_LENGTHS,
  EMAIL_REGISTER_LABELS,
  EMAIL_REGISTERS,
  OPENING_APPROACHES,
  CLOSING_APPROACHES,
  type EmailLength,
  type EmailRegister,
  type OpeningApproach,
  type ClosingApproach,
} from "@/lib/outreach/stage-one-prompt";
import { getSectorColor } from "./gmail-sidebar";
import {
  EmailReviewPanel,
  type EmailReviewDraft,
} from "@/components/outreach/email-review-panel";
import { composeBodyToHtml } from "@/lib/outreach/compose-body-html";
import {
  formatScheduleLong,
  formatScheduleTime,
  scheduleSuggestions,
  toLocalInputValue,
} from "@/components/outreach/schedule-send-dialog";

export type GmailComposeModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSend: (message: {
    to: string;
    subject: string;
    body: string;
    /** ISO instant a scheduled send is due; absent means send now. */
    scheduledFor?: string;
  }) => void;
  initialRecipient?: string;
  initialSubject?: string;
  /**
   * The clients this window may actually send to: every organisation the
   * viewer can see that has an address on it, built from Supabase — never the
   * design fill. `AddressableClient.id` is an organisation id (see
   * @/lib/inbox/real-threads), which is what makes a picked recipient
   * addressable by the approved send path.
   *
   * NOT the inbox's thread list. That list holds only organisations with
   * outreach history, so passing it here meant the only clients Compose could
   * find were ones already emailed — the first email to a client could not be
   * started from the inbox at all.
   *
   * Recipient lookup runs against this list alone when it has entries, so what
   * can be picked is exactly what can be sent to. With no directory — an empty
   * database — the window falls back to searching the design fill and Send
   * stays disabled, because a fill recipient resolves to no organisation and
   * the send would write nothing.
   */
  directory?: AddressableClient[];
  /**
   * Every tag (TAGS) the mailbox knows about, for the "Add label" control —
   * labels in this app ARE tags (F188-F194), the same ones the client record
   * manages. Empty disables the control.
   */
  tags?: InboxThreadTag[];
  /**
   * organisation_id → the tags currently on that organisation, so the picker
   * can mark them "On record" rather than offering to add them again. Built
   * from the loaded threads; a client with no thread simply resolves to none.
   */
  assignedTagsByClientId?: ReadonlyMap<string, readonly InboxThreadTag[]>;
};

/** Which context sheet is covering the draft, if any. */
type ContextPanel = "booklet" | "profile" | null;

/** The things the AI needs to write the email — the same five dials the client
    record's outreach tab offers for its Stage 1 email, plus the booklet and
    profile it reads as context (see src/app/clients/[id]/compose-button.tsx).
    Kept as one record so a selection is never left half-updated. */
type AiOptions = {
  length: EmailLength;
  register: EmailRegister;
  opening: OpeningApproach;
  closing: ClosingApproach;
};

/** The five dials, also used to track which picker drill page is open. */
type AiSettingKey = keyof AiOptions;

/** One setting's drill page: title, its options, and the typed setter that
    applies a pick. Values travel as strings so the option page stays generic. */
type AiSettingDrill = {
  key: AiSettingKey;
  title: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  selected: string;
  onSelect: (value: string) => void;
};

/* ---------------------------------------------------------------------------
   AI picker drill pages — the compose equivalent of the search bar's filter
   drill: same fonts, same motion, same back-and-search page shape, so tapping
   "Email length" reads exactly like tapping "Filter by sector".
--------------------------------------------------------------------------- */
const AI_PANEL_STAGGER = stagger(0.05, 0.14);
const AI_OPTION_LIST: Variants = { hidden: {}, show: {} };

/** Motion inside the picker is opacity + y only. The compose window's body
    sits over a backdrop-blur leaf, and any `filter` inside a subtree of a
    `backdrop-filter` ancestor kills the frost in Chrome/Safari — the same
    rule the search bar's glass obeys. */
const AI_ROW: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
};

const aiRowIndexed = (step = 0.025, cap = 0.3): Variants => ({
  hidden: { opacity: 0, y: 8 },
  show: (index: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: EASE, delay: Math.min(index * step, cap) },
  }),
});

const AI_OPTION_ROWS = aiRowIndexed(0.025, 0.3);

/** Level one: the list of settings, styled and animated like the search bar's
    "Filter by …" category page. A row whose setting already has a choice
    carries a lime chip so the current value shows without opening it. */
function AiCategoryPage({
  rows,
  onOpen,
}: {
  rows: Array<{ key: string; label: string; chip?: string; chipClassName?: string }>;
  onOpen: (key: string) => void;
}) {
  return (
    <motion.ul
      variants={AI_PANEL_STAGGER}
      initial="hidden"
      animate="show"
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      className="absolute inset-0 flex h-full flex-col gap-1 overflow-y-auto px-4 pt-3 pb-16 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
    >
      {rows.map((row) => (
        <motion.li key={row.key} variants={AI_ROW}>
          <button
            type="button"
            onClick={() => onOpen(row.key)}
            className="font-body flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left text-lg font-medium text-slate-900 transition-colors hover:bg-slate-900/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-600"
          >
            <span className="truncate">{row.label}</span>
            {row.chip && (
              <span
                className={`max-w-[45%] shrink-0 truncate rounded-full px-2 py-0.5 text-xs font-bold ${
                  row.chipClassName ?? "bg-lime-100 text-ink"
                }`}
              >
                {row.chip}
              </span>
            )}
          </button>
        </motion.li>
      ))}
    </motion.ul>
  );
}

/** Level two: one setting's options — a back button and the setting's name on
    top, options below. Selecting fills the choice (single-select) and Back
    returns to the settings list. */
function AiOptionPage({
  title,
  options,
  selected,
  onSelect,
  onBack,
}: {
  title: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  selected: string;
  onSelect: (value: string) => void;
  onBack: () => void;
}) {
  return (
    <motion.div
      variants={AI_PANEL_STAGGER}
      initial="hidden"
      animate="show"
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      className="absolute inset-0 flex h-full flex-col pt-3"
    >
      <motion.div variants={AI_ROW} className="flex shrink-0 items-center gap-2 px-4 pb-3">
        <button
          type="button"
          onClick={onBack}
          className="font-body flex shrink-0 cursor-pointer items-center gap-1 rounded-2xl px-3 py-2 text-[15px] font-medium text-slate-500 transition-colors hover:bg-slate-900/5 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-600"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <span className="font-body min-w-0 flex-1 truncate px-1 text-[15px] font-medium text-slate-500">
          {title}
        </span>
      </motion.div>

      <motion.ul
        variants={AI_OPTION_LIST}
        className="flex-1 flex flex-col gap-1 overflow-y-auto px-4 pb-16 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
      >
        {options.map((option, index) => {
          const isSelected = option.value === selected;
          return (
            <motion.li key={option.value} variants={AI_OPTION_ROWS} custom={index}>
              <button
                type="button"
                onClick={() => onSelect(option.value)}
                aria-pressed={isSelected}
                className={`font-body flex w-full cursor-pointer items-center justify-between rounded-2xl px-3 py-2 text-lg font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-600 ${
                  isSelected
                    ? "bg-lime-100 text-black"
                    : "text-slate-900 hover:bg-slate-900/5 hover:text-slate-900"
                }`}
              >
                <span>{option.label}</span>
                {isSelected && <Check className="h-4 w-4 text-lime-800" />}
              </button>
            </motion.li>
          );
        })}
      </motion.ul>
    </motion.div>
  );
}

/** Level two for "Email context" — not an enum, so instead of options it
    lists the client's booklet and profile with actions that open the sheets. */
function AiContextPage({
  hasClient,
  onOpenBooklet,
  onOpenProfile,
  onBack,
  onAddRecipient,
}: {
  hasClient: boolean;
  onOpenBooklet: () => void;
  onOpenProfile: () => void;
  onBack: () => void;
  /** No client yet: takes the CAM to the To field to pick one. */
  onAddRecipient: () => void;
}) {
  return (
    <motion.div
      variants={AI_PANEL_STAGGER}
      initial="hidden"
      animate="show"
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      className="absolute inset-0 flex h-full flex-col pt-3"
    >
      <motion.div variants={AI_ROW} className="flex shrink-0 items-center gap-2 px-4 pb-2">
        <button
          type="button"
          onClick={onBack}
          className="font-body flex shrink-0 cursor-pointer items-center gap-1 rounded-2xl px-3 py-2 text-[15px] font-medium text-slate-500 transition-colors hover:bg-slate-900/5 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-600"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <span className="font-body min-w-0 flex-1 truncate px-1 text-[15px] font-medium text-slate-500">
          What the AI reads
        </span>
      </motion.div>

      <motion.ul
        variants={AI_OPTION_LIST}
        className="flex-1 flex flex-col gap-1 overflow-y-auto px-4 pb-16 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
      >
        <motion.li variants={AI_OPTION_ROWS} custom={0}>
          <button
            type="button"
            onClick={onOpenBooklet}
            disabled={!hasClient}
            className={`font-body flex w-full cursor-pointer items-center justify-between rounded-2xl px-3 py-2 text-left text-lg font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-600 ${
              hasClient
                ? "text-slate-900 hover:bg-slate-900/5 hover:text-slate-900"
                : "cursor-not-allowed text-slate-400"
            }`}
          >
            <span className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-slate-400" />
              Client booklet
            </span>
            {hasClient && <ChevronDown className="h-4 w-4 -rotate-90 text-slate-400" />}
          </button>
        </motion.li>
        <motion.li variants={AI_OPTION_ROWS} custom={1}>
          <button
            type="button"
            onClick={onOpenProfile}
            disabled={!hasClient}
            className={`font-body flex w-full cursor-pointer items-center justify-between rounded-2xl px-3 py-2 text-left text-lg font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-600 ${
              hasClient
                ? "text-slate-900 hover:bg-slate-900/5 hover:text-slate-900"
                : "cursor-not-allowed text-slate-400"
            }`}
          >
            <span className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-slate-400" />
              Client profile
            </span>
            {hasClient && <ChevronDown className="h-4 w-4 -rotate-90 text-slate-400" />}
          </button>
        </motion.li>
        {!hasClient && (
          <motion.li
            variants={AI_ROW}
            role="status"
            className="flex flex-col items-start gap-2 px-3 py-2"
          >
            <button
              type="button"
              onClick={onAddRecipient}
              className="font-body flex cursor-pointer items-center gap-1.5 rounded-full bg-lead px-4 py-2 text-[13px] font-semibold text-white shadow-xs transition-colors hover:bg-[#1b3160] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-600"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Add recipient
            </button>
            <span className="font-body text-[15px] text-slate-500">
              Save a recipient above to unlock their booklet and profile.
            </span>
          </motion.li>
        )}
      </motion.ul>
    </motion.div>
  );
}


const DEFAULT_AI_OPTIONS: AiOptions = {
  length: "standard",
  register: "professional",
  opening: "mission_led",
  closing: "soft_cta",
};

const EMAIL_LENGTH_LABELS: Record<EmailLength, string> = {
  short: "Short",
  standard: "Standard",
  detailed: "Detailed",
};

const OPENING_APPROACH_LABELS: Record<OpeningApproach, string> = {
  mission_led: "Mission-led",
  direct_intro: "Direct introduction",
  news_hook: "Relevant news hook",
};

const CLOSING_APPROACH_LABELS: Record<ClosingApproach, string> = {
  soft_cta: "Soft invitation",
  meeting_request: "Request a short call",
  open_question: "Open question",
};

/** The gooey capsule's own merge takes `duration` ms; the saved chip waits it
    out so the pill is back in one piece before it turns navy. */
const GOOEY_MERGE_MS = 960;

/* The schedule presets, the two time formats and the `datetime-local` value
   helper used to be copied out here, beside identical copies in
   schedule-send-dialog.tsx — which is where they were lifted from when the
   client record grew the same dialog. Four duplicated pure functions is four
   places for the presets to drift apart, so this window imports them (see the
   top of this file) rather than keeping its own. The one behavioural
   difference the copy had was a bug: it offered "Monday morning" even on a
   Sunday, when that is the same instant as "Tomorrow morning". */




const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The half of `client_booklets` the booklet sheet renders. */
type SavedBookletView = {
  id: string;
  text: string;
  websiteUrl: string | null;
  generatedAt: string;
};

function contactDisplayName(match: RecipientMatch): string {
  const name = `${match.contact.firstName} ${match.contact.lastName}`.trim();
  return name || match.contact.jobTitle;
}

/** Splits `text` into highlighted / plain segments so a match row can bold
    exactly the part the typed query hit. Case-insensitive, first occurrence. */
function splitMatchedSegments(
  text: string,
  query: string,
): Array<{ text: string; matched: boolean }> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [{ text, matched: false }];
  const at = text.toLowerCase().indexOf(needle);
  if (at === -1) return [{ text, matched: false }];
  const segments: Array<{ text: string; matched: boolean }> = [];
  if (at > 0) segments.push({ text: text.slice(0, at), matched: false });
  segments.push({ text: text.slice(at, at + needle.length), matched: true });
  const after = text.slice(at + needle.length);
  if (after) segments.push({ text: after, matched: false });
  return segments;
}

/** Renders `text` with the query-matched run in <strong>. */
function HighlightedText({
  text,
  query,
  matchedClassName,
}: {
  text: string;
  query: string;
  matchedClassName: string;
}) {
  const segments = splitMatchedSegments(text, query);
  return (
    <>
      {segments.map((segment, index) =>
        segment.matched ? (
          <strong key={index} className={matchedClassName}>
            {segment.text}
          </strong>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

/** The client's icon: a letter avatar from the first two letters of the
    company's name, filled with the deep sector colour the sidebar labels use
    (the same solid deep-brand fills — white text on green / indigo / teal /
    violet / lead, not bright tints). */
function OrgAvatar({ orgName, color }: { orgName: string; color: string }) {
  const letters = orgName.trim().slice(0, 2).toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full text-[12px] font-semibold text-white"
      style={{ backgroundColor: color }}
    >
      {letters}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Fast, styled replacement for the native `title` tooltip on the compose
    modal's hover controls — the native one waits ~1s and can't be themed. */
function Hint({
  label,
  side = "top",
  children,
}: {
  label: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactElement;
}) {
  return (
    <Tooltip delayDuration={120}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        showArrow={false}
        className="bg-slate-900 text-[11px] font-medium text-white"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function GmailComposeModal({
  isOpen,
  onClose,
  onSend,
  initialRecipient = "",
  initialSubject = "",
  directory,
  tags,
  assignedTagsByClientId,
}: GmailComposeModalProps) {
  // The recipient is only ever the *saved* address — the in-flight text lives
  // inside the gooey capsule until its droplet commits it.
  const [savedTo, setSavedTo] = useState<string | null>(initialRecipient || null);
  // What is being typed into the capsule, so the match list can read it. The
  // gooey input is controlled here rather than owning its own text.
  const [recipientQuery, setRecipientQuery] = useState("");
  const [isRecipientFocused, setIsRecipientFocused] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [showSavedFlash, setShowSavedFlash] = useState(false);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState("");
  const [isMinimized, setIsMinimized] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  /**
   * The draft row this window handed to EmailReviewPanel, or null while still
   * composing. Send does not send: it creates the draft and opens the shared
   * review panel over it, which owns the approval gate and every commit.
   *
   * F250 is the reason it works this way rather than this window growing its
   * own approval checkbox and calling the send action itself. One gate, in one
   * component — `human-send-control.test.ts` asserts it, because two copies of
   * a safety gate is how one of them gets a fix and the other does not.
   */
  const [reviewDraft, setReviewDraft] = useState<EmailReviewDraft | null>(null);
  /** What creating that draft said when it refused. Shown above the actions. */
  const [sendError, setSendError] = useState<string | null>(null);
  // AI-first compose: an empty draft opens on the AI picker below, which asks
  // for the outreach tab's Stage 1 settings; writing by hand is the explicit
  // "Draft manually" escape from that picker.
  const [aiOptions, setAiOptions] = useState<AiOptions>(DEFAULT_AI_OPTIONS);
  // The saved booklet for the resolved client, read from client_booklets.
  // `failed` is kept apart from "none saved": one is worth retrying, the other
  // is a fact about the client.
  // The outreach_messages row Stage 1 generation created, if the CAM used it.
  // Send reuses this row rather than asking for a second blank one.
  const [generatedDraft, setGeneratedDraft] = useState<
    { id: string; recipientOnFile: string | null } | null
  >(null);
  // The last booklet read, tagged with the client it belongs to — see the
  // derivation below the fetch.
  const [bookletResult, setBookletResult] = useState<{
    clientId: string;
    booklet: SavedBookletView | null;
    failed: boolean;
  } | null>(null);
  const [isWritingManually, setIsWritingManually] = useState(false);
  // True while the AI options menu is being shown on request, even if a draft
  // already exists — any "use AI" affordance opens the menu first; it never
  // auto-drafts.
  const [showAiOptions, setShowAiOptions] = useState(false);
  // Which drill page the picker shows: null = the settings list, otherwise the
  // tapped setting (or context) — mirrors the search bar's filter drill.
  const [drillSetting, setDrillSetting] = useState<AiSettingKey | "context" | null>(null);
  const [errors, setErrors] = useState<{ to?: string; subject?: string }>({});
  const [panel, setPanel] = useState<ContextPanel>(null);
  const [isScheduleMenuOpen, setIsScheduleMenuOpen] = useState(false);
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [customWhen, setCustomWhen] = useState<string | null>(null);
  // The schedule dialog is a three-step flow: pick a time, confirm you mean it
  // (no more editing after), then a "scheduled for …" acknowledgement before
  // the window closes. `pendingWhen` carries the picked time across the steps.
  const [scheduleStep, setScheduleStep] = useState<"pick" | "confirm" | "done">("pick");
  const [pendingWhen, setPendingWhen] = useState<Date | null>(null);
  /** The time this draft is destined for, carried into the review panel. The
      panel commits it — this window never schedules anything itself. */
  const [pendingScheduleIso, setPendingScheduleIso] = useState<string | null>(null);
  const [isCloseDialogOpen, setIsCloseDialogOpen] = useState(false);
  // Files chosen in this window but not yet anywhere: they are uploaded to the
  // client's attachment store and linked to the draft only once Send has
  // created that draft (see handleSend). Held as raw File objects until then.
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  // Gmail keeps spell-check on by default; the ⋮ menu lets a CAM turn the
  // squiggles off for a draft full of names and acronyms.
  const [spellCheckOn, setSpellCheckOn] = useState(true);
  const [isKebabOpen, setIsKebabOpen] = useState(false);
  const [isLabelPickerOpen, setIsLabelPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const savedTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Live draft state for the X / Escape handler, which is registered once per
  // open: kept on a ref so a keystroke doesn't tear down and re-add the window
  // listener, but closing still asks whenever anything is on the page.
  const hasDraftContentRef = useRef(false);
  // Handle to the To field, so the Email-context panel's "Add recipient"
  // button can put the caret there without the panel knowing the field.
  const recipientInputRef = useRef<HTMLInputElement>(null);
  // Each AI button spins only its own pinwheel while hovered — one shared
  // flag had every AI icon on the dialog spinning together.
  const [draftPillHover, setDraftPillHover] = useState(false);
  const [generateHover, setGenerateHover] = useState(false);
  const [aiToolbarHover, setAiToolbarHover] = useState(false);
  // Token stream for the draft: thinking steps and live text while it flows,
  // resolving like the old JSON POST so handleAiDraft's flow is unchanged.
  const draftStream = useStageOneDraftStream();
  // A finished draft waits here while its reveal plays out. The editor takes
  // it in commitStagedDraft, once the last word has resolved.
  const [stagedGenerated, setStagedGenerated] = useState<{
    id: string;
    subject: string;
    body: string;
    recipientOnFile: string | null;
  } | null>(null);

  function commitStagedGenerated() {
    if (!stagedGenerated) return;
    setGeneratedDraft({
      id: stagedGenerated.id,
      recipientOnFile: stagedGenerated.recipientOnFile,
    });
    if (stagedGenerated.subject) {
      setSubject(stagedGenerated.subject);
      setErrors((prev) => ({ ...prev, subject: undefined }));
    }
    if (stagedGenerated.body) setBody(stagedGenerated.body);
    setStagedGenerated(null);
    setIsAiGenerating(false);
  }

  // The client behind the recipient. Until an address is saved there is no
  // record to show, so the context buttons have nothing to open.
  // Real clients when the inbox has any; the design fill otherwise, which
  // leaves Send disabled (see the `directory` prop).
  const addressable = useMemo(
    () => (directory && directory.length > 0 ? directory : null),
    [directory],
  );
  // Only built when there is no real directory to search.
  const fillDirectory = useMemo(
    () => (addressable ? [] : fillAsAddressableClients(mockFillThreads())),
    [addressable],
  );
  const client = useMemo(
    () => resolveRecipientThread(savedTo ?? "", addressable ?? fillDirectory),
    [savedTo, addressable, fillDirectory],
  );
  /** The client this draft can actually be sent to — null for a fill match. */
  const sendableClient = addressable ? client : null;

  // "Add label" = assign a tag to this client. The menu shows the client's
  // current tags apart from the rest. Locally-added assignments (made in this
  // window) are merged so a just-added label leaves the "assignable" list at
  // once, without waiting for the page to re-fetch.
  const [locallyAssignedTags, setLocallyAssignedTags] = useState<InboxThreadTag[]>(
    [],
  );
  const assignedTags = useMemo<InboxThreadTag[]>(() => {
    if (!sendableClient) return [];
    const fromServer = assignedTagsByClientId?.get(sendableClient.id) ?? [];
    const byId = new Map<string, InboxThreadTag>();
    for (const tag of [...fromServer, ...locallyAssignedTags]) byId.set(tag.id, tag);
    return [...byId.values()];
  }, [sendableClient, assignedTagsByClientId, locallyAssignedTags]);
  const assignableTags = useMemo<InboxThreadTag[]>(() => {
    const assignedIds = new Set(assignedTags.map((tag) => tag.id));
    return (tags ?? []).filter((tag) => !assignedIds.has(tag.id));
  }, [tags, assignedTags]);
  const suggestions = useMemo(
    () => (isScheduleDialogOpen ? scheduleSuggestions() : []),
    [isScheduleDialogOpen],
  );
  const matches = useMemo(
    () => searchRecipients(recipientQuery, 6, addressable ?? fillDirectory),
    [recipientQuery, addressable, fillDirectory],
  );

  /**
   * The client's saved booklet (F085/F086), fetched when the sheet is opened
   * for a real client.
   *
   * This used to render `getMockBooklet(client)` — invented prose about the
   * organisation's headcount, income mix and "openers that have worked",
   * generated from the thread's own fields. On the design fill that was
   * harmless set dressing; on a real charity it was fiction presented to a CAM
   * as research, for an organisation they were about to email. So there is now
   * only one source: `client_booklets`, through the same RLS-scoped read the
   * client record uses. No saved booklet means the sheet says so.
   */
  const clientId = sendableClient?.id ?? null;
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/clients/${clientId}/booklet`);
        if (cancelled) return;
        if (!response.ok) {
          setBookletResult({ clientId, booklet: null, failed: true });
          return;
        }
        const payload = (await response.json()) as { booklet: SavedBookletView | null };
        if (cancelled) return;
        setBookletResult({ clientId, booklet: payload.booklet ?? null, failed: false });
      } catch {
        if (!cancelled) setBookletResult({ clientId, booklet: null, failed: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  /* Derived, not stored: a result that belongs to a different client is a
     result for a recipient the CAM has since changed, so it reads as loading
     rather than briefly showing the previous client's booklet. Deriving it
     also keeps the effect above free of any synchronous setState, which the
     React Compiler rejects as a cascading render. */
  const booklet = bookletResult?.clientId === clientId ? bookletResult.booklet : null;
  const bookletState: "idle" | "loading" | "loaded" | "failed" = !clientId
    ? "idle"
    : bookletResult?.clientId !== clientId
      ? "loading"
      : bookletResult.failed
        ? "failed"
        : "loaded";
  // The list is a lookup, not an autocomplete of itself: once what is typed is
  // already a whole address there is nothing left to pick.
  const showMatches =
    !savedTo &&
    matches.length > 0 &&
    recipientQuery.trim().length >= 2 &&
    !matches.some((match) => match.contact.email === recipientQuery.trim());

  // Typed a whole address, but it resolves to nobody in the register — offer
  // to add them rather than letting the draft go to a stranger.
  const showAddToDatabase =
    !savedTo && EMAIL_PATTERN.test(recipientQuery.trim()) && matches.length === 0;

  /**
   * Why Send is unavailable, or null when it is available. Phrased as the next
   * thing to do rather than as a rule that was broken — a disabled button that
   * does not say what it wants is the reason this one sat inert for so long.
   *
   * The order matters: the earliest missing thing is the one worth naming.
   */
  const sendBlockedReason =
    isSending
      ? "Sending…"
      : !addressable
        ? "No clients with outreach on them yet — new outreach starts from a client's record."
        : !savedTo?.trim()
          ? "Save a recipient first."
          : !sendableClient
            ? "That address does not belong to a client in the database, so there is nothing to send against. Start from the client's record."
            : !subject.trim()
              ? "Add a subject."
              : body.trim().length === 0
                ? "Add email content."
                : null;
  // Once the review panel is up, the commit lives there — this control has
  // nothing left to do until the panel is dismissed.
  const cannotSend = sendBlockedReason !== null || reviewDraft !== null;

  // A recipient, subject or body counts as a draft worth asking about.
  hasDraftContentRef.current = Boolean(
    savedTo || subject.trim() || body.trim() || stagedFiles.length > 0,
  );

  // Escape backs out of a context sheet first, and only then closes the draft.
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (isCloseDialogOpen) setIsCloseDialogOpen(false);
      else if (isScheduleDialogOpen) {
        // "done" swallows Escape — the send is already committed.
        if (scheduleStep !== "done") {
          setIsScheduleDialogOpen(false);
          setScheduleStep("pick");
          setPendingWhen(null);
          setCustomWhen(null);
        }
      } else if (isScheduleMenuOpen) setIsScheduleMenuOpen(false);
      else if (panel) setPanel(null);
      else if (hasDraftContentRef.current) setIsCloseDialogOpen(true);
      else {
        resetDraft();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, panel, isScheduleMenuOpen, isScheduleDialogOpen, isCloseDialogOpen, scheduleStep]);

  useEffect(() => {
    const timers = savedTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  if (!isOpen) return null;

  function resetDraft() {
    setSavedTo(null);
    setReviewDraft(null);
    setGeneratedDraft(null);
    setPendingScheduleIso(null);
    setBookletResult(null);
    setSendError(null);
    setShowSavedFlash(false);
    setSubject("");
    setBody("");
    setAiOptions(DEFAULT_AI_OPTIONS);
    setIsWritingManually(false);
    setErrors({});
    setPanel(null);
    setIsScheduleMenuOpen(false);
    setIsScheduleDialogOpen(false);
    setIsCloseDialogOpen(false);
    setShowAiOptions(false);
    setDrillSetting(null);
    setCustomWhen(null);
    setScheduleStep("pick");
    setPendingWhen(null);
    setStagedFiles([]);
    setAttachError(null);
    setIsKebabOpen(false);
    setIsLabelPickerOpen(false);
    setLocallyAssignedTags([]);
    setSpellCheckOn(true);
  }

  /** Adds picked files to the staging list, refusing any the client-side
      checks reject — the same size/type gate the client record's picker uses
      (validateAttachmentFile) plus the running combined-size cap. The real
      enforcement is still the bucket + attach_file_to_draft; this only keeps
      an obviously-bad file from being carried all the way to Send. */
  function stageFiles(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    setAttachError(null);
    let runningCount = stagedFiles.length;
    let runningBytes = stagedFiles.reduce((sum, file) => sum + file.size, 0);
    const accepted: File[] = [];
    for (const file of Array.from(picked)) {
      const fileError = validateAttachmentFile(file);
      if (fileError) {
        setAttachError(fileError);
        continue;
      }
      const setError = validateDraftAttachmentSet(
        { count: runningCount, totalSizeBytes: runningBytes },
        { sizeBytes: file.size },
      );
      if (setError) {
        setAttachError(setError);
        continue;
      }
      accepted.push(file);
      runningCount += 1;
      runningBytes += file.size;
    }
    if (accepted.length > 0) setStagedFiles((prev) => [...prev, ...accepted]);
  }

  function removeStagedFile(index: number) {
    setStagedFiles((prev) => prev.filter((_, position) => position !== index));
    setAttachError(null);
  }

  /**
   * Uploads every staged file to the client's attachment store and links it to
   * the just-created draft. Returns an error string to abort the send, or null
   * on success. Called from handleSend once a draft id exists — there is
   * nothing to attach a file to before then.
   */
  async function uploadStagedFiles(
    organisationId: string,
    draftId: string,
  ): Promise<string | null> {
    if (stagedFiles.length === 0) return null;
    const supabase = createBrowserSupabase();
    // Work off a local queue and drop each file from the staging list the
    // moment it is safely on the draft. A retry after a mid-way failure then
    // only re-processes what is left — the ones already uploaded are not
    // uploaded again.
    const queue = [...stagedFiles];
    while (queue.length > 0) {
      const file = queue[0];
      const storagePath = buildAttachmentStoragePath(
        organisationId,
        file.name,
        crypto.randomUUID(),
      );
      const { error: uploadError } = await supabase.storage
        .from("client-attachments")
        .upload(storagePath, file, { contentType: file.type || undefined });
      if (uploadError) {
        return attachmentUploadFailureMessage(uploadError);
      }

      const recordResponse = await fetch(
        `/api/clients/${organisationId}/attachments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            storagePath,
            contentType: file.type || undefined,
            sizeBytes: file.size,
          }),
        },
      );
      const recordBody = (await recordResponse.json().catch(() => null)) as
        | { id?: string; error?: string }
        | null;
      if (!recordResponse.ok || !recordBody?.id) {
        return recordBody?.error ?? `“${file.name}” could not be attached.`;
      }

      const attachResult = await attachDraftFile({
        organisationId,
        messageId: draftId,
        attachmentId: recordBody.id,
      });
      if (!attachResult.ok) {
        return attachResult.message;
      }

      queue.shift();
      setStagedFiles((prev) => prev.filter((staged) => staged !== file));
    }
    return null;
  }

  /** Closes the schedule dialog and rewinds it to its first step, so it never
      reopens mid-flow. Blocked once the send is committed ("done"). */
  function closeScheduleDialog() {
    if (scheduleStep === "done") return;
    setIsScheduleDialogOpen(false);
    setScheduleStep("pick");
    setPendingWhen(null);
    setCustomWhen(null);
  }

  /** A time was picked: hold it and ask for confirmation rather than sending
      straight away. A draft missing a recipient or subject can't be scheduled,
      so that is caught here before the confirm step is shown. */
  function beginSchedule(when: Date) {
    if (Number.isNaN(when.getTime())) return;
    const nextErrors: { to?: string; subject?: string } = {};
    if (!savedTo?.trim()) nextErrors.to = "Save a recipient first.";
    if (!subject.trim()) nextErrors.subject = "Add a subject.";
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      closeScheduleDialog();
      return;
    }
    setPendingWhen(when);
    setScheduleStep("confirm");
  }

  /** "I understand" on the confirm step: show the acknowledgement, then hand
      off to the normal send path with the scheduled time. */
  function confirmSchedule() {
    if (!pendingWhen) return;
    setScheduleStep("done");
    savedTimers.current.push(
      setTimeout(() => void handleSend(pendingWhen.toISOString()), 1200),
    );
  }

  /** The X (and Escape with no sheet open) never autosaves silently: with a
      draft on the page it asks save-as-draft or discard. An empty compose
      closes cleanly; a minimized window closes without the sheet.
      "Save as draft" keeps the state so the next open resumes where it left. */
  function requestClose() {
    if (isMinimized) {
      onClose();
      return;
    }
    if (!hasDraftContentRef.current) {
      resetDraft();
      onClose();
      return;
    }
    setIsCloseDialogOpen(true);
  }

  /** Every "use AI to draft" affordance lands here: it returns to the AI
      options menu (never auto-drafting). Generation only ever happens from
      the menu's own Generate button. */
  function openAiPicker() {
    setShowAiOptions(true);
    setIsWritingManually(false);
    setDrillSetting(null);
  }

  /** The droplet's tap. The capsule merges back on its own (the field blurs
      inside the gooey input), so the navy swap waits for that to finish. */
  function handleSaveRecipient(email: string) {
    setErrors((prev) => ({ ...prev, to: undefined }));
    savedTimers.current.push(
      setTimeout(() => {
        setSavedTo(email);
        setShowSavedFlash(true);
        savedTimers.current.push(setTimeout(() => setShowSavedFlash(false), 1000));
      }, GOOEY_MERGE_MS),
    );
  }

  /**
   * Hands the composed draft to the shared review panel.
   *
   * This window used to be inert on purpose: recipient lookup read the design
   * fill, so a typed address resolved to no organisation, and wiring Send
   * would have produced a window that said "Sent" and wrote nothing. It
   * searches the real clients the inbox loaded now (see `directory`), which is
   * what makes the approved path reachable from here at all.
   *
   * What it does NOT do is send. `POST /outreach-drafts/blank` creates the
   * `outreach_messages` row — re-running `client:contact`, the F018 ownership
   * check and the suppression check, so a client this CAM may not contact is
   * refused here, before anything is written — and then EmailReviewPanel takes
   * over: the approval gate, the send, the schedule, the discard. That panel is
   * the only component allowed to render the gate (F250,
   * human-send-control.test.ts), so this window mounts it rather than
   * restating its controls, exactly as the client record's composer does.
   *
   * A scheduled send arrives here the same way: the time is carried into the
   * panel's own schedule control rather than sent from this window.
   */
  async function handleSend(scheduledFor?: string) {
    const recipient = savedTo ?? "";
    const nextErrors: { to?: string; subject?: string } = {};
    if (!recipient.trim()) nextErrors.to = "Save a recipient first.";
    if (!subject.trim()) nextErrors.subject = "Add a subject.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setIsScheduleMenuOpen(false);
      setIsScheduleDialogOpen(false);
      return;
    }
    if (!sendableClient) return;

    setIsScheduleMenuOpen(false);
    setSendError(null);
    setIsSending(true);
    // Carried into the review panel, which is where a schedule is actually
    // committed. Set before the await so the panel mounts already knowing.
    setPendingScheduleIso(scheduledFor ?? null);

    try {
      // A draft generated in this window already IS an outreach_messages row;
      // asking for a blank one would strand it and review the wrong record.
      let draftId = generatedDraft?.id ?? null;
      let recipientOnFile = generatedDraft?.recipientOnFile ?? null;

      if (!draftId) {
        const response = await fetch(
          `/api/clients/${sendableClient.id}/outreach-drafts/blank`,
          { method: "POST" },
        );
        const draft = (await response.json().catch(() => null)) as
          | { id?: string; recipientOnFile?: string | null; error?: string }
          | null;
        if (!response.ok || !draft?.id) {
          // Shown verbatim: these messages name the owner, the suppression
          // reason or the permission that is missing, and each asks the CAM for
          // something different.
          setSendError(
            draft?.error ?? "The email could not be prepared. Nothing was sent.",
          );
          setPendingScheduleIso(null);
          return;
        }
        draftId = draft.id;
        recipientOnFile = draft.recipientOnFile ?? null;
      }

      // Staged files become real only now, once there is a draft to hang them
      // on. A failure here stops before the review panel: the draft exists but
      // is unsent, and the CAM is told which file did not make it.
      const attachFailure = await uploadStagedFiles(sendableClient.id, draftId);
      if (attachFailure) {
        setSendError(attachFailure);
        setPendingScheduleIso(null);
        setGeneratedDraft({ id: draftId, recipientOnFile });
        return;
      }

      setReviewDraft({
        id: draftId,
        subject,
        body: composeBodyToHtml(body),
        recipientOnFile,
        savedRecipient: recipient,
      });
    } catch {
      setSendError(
        "The network dropped before the draft was created. Nothing was sent.",
      );
      setPendingScheduleIso(null);
    } finally {
      setIsSending(false);
    }
  }

  /**
   * Generates the Stage 1 draft — the real one.
   *
   * This used to be a 900ms `setTimeout` that pasted a constant
   * (`AI_DRAFT_BODY`) into the body with the recipient's first name swapped
   * into the greeting. Every dial in the settings menu above was decorative:
   * length, register, opening and closing changed nothing about the text that
   * appeared. It now posts them to `/outreach-drafts/stage-one`, the same
   * route the client record's Introductory email card calls, so the draft is
   * generated from the client's own saved booklet and profile under the same
   * rate limit, the same suppression and ownership checks, and the same F112
   * audit row.
   *
   * The route CREATES an outreach_messages row and returns its id, so that id
   * is kept: `handleSend` reuses it rather than posting for a second blank
   * draft, and passing it back as `draftId` makes a second click a
   * regeneration of the same row (F111 AC2) instead of a pile of orphans.
   */
  async function handleAiDraft() {
    if (!sendableClient) {
      setSendError(
        "Pick a client from the database first — the draft is generated from their booklet and profile.",
      );
      return;
    }
    setIsAiGenerating(true);
    setSendError(null);
    // A generated draft returns to the review editor — the menu was only
    // needed to pick the settings.
    setShowAiOptions(false);
    try {
      const outcome = await draftStream.start({
        organisationId: sendableClient.id,
        ...(generatedDraft ? { draftId: generatedDraft.id } : {}),
        length: aiOptions.length,
        register: aiOptions.register,
        opening: aiOptions.opening,
        closing: aiOptions.closing,
      });
      if (!outcome.ok) {
        if (outcome.error === "cancelled") {
          setIsAiGenerating(false);
          return;
        }
        // A 409 means the row this window was tracking is no longer a draft
        // (sent or removed elsewhere) — drop it so a retry starts a fresh one
        // rather than regenerating something that cannot be regenerated.
        if (outcome.status === 409) setGeneratedDraft(null);
        setSendError(outcome.error);
        setIsAiGenerating(false);
        return;
      }
      // The editor takes this in commitStagedGenerated, after the reveal below
      // has played out — handing over mid-reveal would cut the text off.
      const payload = outcome.result;
      setStagedGenerated({
        id: payload.id,
        subject: payload.subject,
        body: payload.body,
        recipientOnFile: payload.recipientOnFile ?? null,
      });
    } catch {
      setSendError("Could not reach the server. The draft was not generated.");
      setIsAiGenerating(false);
    }
  }

  // The five settings as drill data + typed setters. The open page (activeDrill)
  // renders from this list; values travel as strings so the page stays generic.
  const settingDrills: AiSettingDrill[] = [
    {
      key: "length",
      title: "Email length",
      options: EMAIL_LENGTHS.map((value) => ({ value, label: EMAIL_LENGTH_LABELS[value] })),
      selected: aiOptions.length,
      onSelect: (value) => setAiOptions((prev) => ({ ...prev, length: value as EmailLength })),
    },
    {
      key: "register",
      title: "Email register",
      options: EMAIL_REGISTERS.map((value) => ({ value, label: EMAIL_REGISTER_LABELS[value] })),
      selected: aiOptions.register,
      onSelect: (value) => setAiOptions((prev) => ({ ...prev, register: value as EmailRegister })),
    },
    {
      key: "opening",
      title: "Opening approach",
      options: OPENING_APPROACHES.map((value) => ({ value, label: OPENING_APPROACH_LABELS[value] })),
      selected: aiOptions.opening,
      onSelect: (value) => setAiOptions((prev) => ({ ...prev, opening: value as OpeningApproach })),
    },
    {
      key: "closing",
      title: "Closing approach",
      options: CLOSING_APPROACHES.map((value) => ({ value, label: CLOSING_APPROACH_LABELS[value] })),
      selected: aiOptions.closing,
      onSelect: (value) => setAiOptions((prev) => ({ ...prev, closing: value as ClosingApproach })),
    },
  ];
  const activeDrill =
    drillSetting !== null && drillSetting !== "context"
      ? (settingDrills.find((drill) => drill.key === drillSetting) ?? null)
      : null;

  // The settings list itself. A chip on each row keeps the current choice in
  // sight without opening the drill; the context row tracks the recipient.
  const categoryRows: Array<{
    key: string;
    label: string;
    chip?: string;
    chipClassName?: string;
  }> = [
    { key: "length", label: "Email length", chip: EMAIL_LENGTH_LABELS[aiOptions.length] },
    { key: "register", label: "Email register", chip: EMAIL_REGISTER_LABELS[aiOptions.register] },
    { key: "opening", label: "Opening approach", chip: OPENING_APPROACH_LABELS[aiOptions.opening] },
    { key: "closing", label: "Closing approach", chip: CLOSING_APPROACH_LABELS[aiOptions.closing] },
    {
      key: "context",
      label: "Email context",
      chip: client ? client.orgName : "Add a recipient",
      // No recipient yet — the pill turns red so the missing context is
      // unmistakable rather than reading as a neutral current value.
      chipClassName: client ? undefined : "bg-red-600/88 text-white",
    },
  ];

  const iconButton =
    "p-2 rounded-full text-slate-500 hover:bg-slate-900/5 hover:text-slate-800 transition-colors cursor-pointer";
  const contextPill =
    "flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition-colors";

  return (
    <div
      role="dialog"
      aria-label="New message"
      className={`fixed z-50 flex flex-col overflow-hidden transition-all duration-200 ${
        isExpanded
          ? "inset-8 rounded-2xl"
          : isMinimized
            ? "bottom-0 right-8 w-80 h-11 rounded-t-2xl"
            : "bottom-0 right-8 w-[600px] h-[640px] rounded-t-2xl"
      }`}
      style={{
        // The open search bar's light glass (SEARCH_GLASS_OPEN_LIGHT), held a
        // little short of opaque so the frost behind it actually reads, over
        // the same inner lip the bar wears.
        backgroundColor: "rgba(255, 255, 255, 0.82)",
        boxShadow: `${LIP}, 0 -2px 40px rgba(15, 23, 42, 0.18)`,
      }}
    >
      {/* The frost lives on its own childless leaf, never on the container that
          holds the content — exactly the reason `BrandSearchBar` splits it out.
          `backdrop-filter` is defeated by any `filter` anywhere in its own
          subtree, and this panel's subtree contains liquid-gooey, which paints
          its capsule through an SVG filter. A leaf has no descendants, so it
          cannot be poisoned. */}
      <div
        className="pointer-events-none absolute inset-0 z-0 rounded-[inherit] backdrop-blur-[20px]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 z-30 rounded-[inherit] ring-1 ring-slate-900/10 ring-inset"
        aria-hidden="true"
      />

      {/* Compose Header */}
      <div className="relative z-10 flex items-center justify-between border-b border-slate-900/8 px-4 py-2.5 select-none">
        <span className="text-sm font-body font-medium text-slate-700 truncate pr-2">
          {subject.trim() || "New message"}
        </span>
        <div className="flex items-center gap-1 text-slate-500 shrink-0">
          <button
            type="button"
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1 rounded hover:bg-slate-900/8 hover:text-slate-900 cursor-pointer"
            title={isMinimized ? "Restore" : "Minimize"}
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          {!isMinimized && (
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 rounded hover:bg-slate-900/8 hover:text-slate-900 cursor-pointer"
              title={isExpanded ? "Exit full screen" : "Full screen"}
            >
              {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          )}
          <button
            type="button"
            onClick={requestClose}
            className="p-1 rounded hover:bg-slate-900/8 hover:text-slate-900 cursor-pointer"
            title="Save as draft or discard"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Body Area (hidden when minimized) */}
      {!isMinimized && (
        <div className="relative z-10 flex-1 flex flex-col px-4 pt-1 pb-3 overflow-hidden">
          {/* Recipient — a gooey capsule that separates into field + droplet on
              tap, then merges back and turns lead once the address is saved. */}
          <div className="flex items-center pb-1 min-h-[58px]">
            <span className="text-sm font-body text-slate-500 w-10 shrink-0">To</span>
            <div className="flex-1 min-w-0 flex items-center gap-3">
              {savedTo ? (
                <motion.button
                  type="button"
                  key="saved-recipient"
                  onClick={() => {
                    setSavedTo(null);
                    setShowSavedFlash(false);
                  }}
                  title="Change recipient"
                  initial={{ backgroundColor: "#ffffff", color: "#0f172a" }}
                  animate={{ backgroundColor: "#23407a", color: "#ffffff" }}
                  transition={{ duration: 0.45, ease: [0.3, 1.05, 0.4, 1] }}
                  className="max-w-full truncate rounded-full px-5 py-2.5 text-sm font-medium shadow-sm cursor-pointer"
                >
                  {savedTo}
                </motion.button>
              ) : (
                <div
                  className="relative"
                  onFocusCapture={() => setIsRecipientFocused(true)}
                  // A tap on a match steals focus from the field, so the list
                  // has to survive a blur that lands inside its own subtree.
                  onBlurCapture={(event) => {
                    if (
                      event.relatedTarget instanceof Node &&
                      event.currentTarget.contains(event.relatedTarget)
                    ) {
                      return;
                    }
                    setIsRecipientFocused(false);
                  }}
                  onKeyDown={(event) => {
                    if (!showMatches) return;
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setHighlightIndex((i) => (i + 1) % matches.length);
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setHighlightIndex((i) => (i - 1 + matches.length) % matches.length);
                    } else if (event.key === "Enter") {
                      // Enter takes the highlighted match unless what is typed
                      // is already a complete address of its own.
                      if (!EMAIL_PATTERN.test(recipientQuery.trim())) {
                        event.preventDefault();
                        event.stopPropagation();
                        handleSaveRecipient(matches[highlightIndex].contact.email);
                      }
                    }
                  }}
                >
                  <GooeyEmailInput
                    variant="light"
                    size="sm"
                    align="start"
                    // Bump the field's own type up from the sm preset's 12px and
                    // put it on the body face, to match the rest of the modal.
                    className="[&_input]:font-body [&_input]:!text-[15px] [&_input]:!font-normal"
                    gap={54}
                    duration={960}
                    fieldWidth={300}
                    inputType="text"
                    inputRef={recipientInputRef}
                    value={recipientQuery}
                    onValueChange={(next) => {
                      setRecipientQuery(next);
                      setHighlightIndex(0);
                    }}
                    placeholder="Search a client or type an email…"
                    restPlaceholder="Add recipient"
                    fieldLabel="Recipient — client name or email"
                    submitLabel="Save recipient"
                    successPlaceholder=""
                    // A company name is a legal thing to type; the droplet
                    // resolves it to the top match, so only text that matches
                    // nothing and is not an address is rejected.
                    validate={(candidate) => {
                      const value = candidate.trim();
                      if (EMAIL_PATTERN.test(value)) return null;
                      if (searchRecipients(value, 1, addressable ?? fillDirectory).length > 0) return null;
                      return "No client matches that — type a full email address.";
                    }}
                    onSubmit={(value) => {
                      const typed = value.trim();
                      if (EMAIL_PATTERN.test(typed)) {
                        handleSaveRecipient(typed);
                        return;
                      }
                      const best = searchRecipients(typed, 1, addressable ?? fillDirectory)[0];
                      if (best) handleSaveRecipient(best.contact.email);
                    }}
                  />

                  <AnimatePresence>
                    {isRecipientFocused && showMatches && (
                      <motion.ul
                        key="recipient-matches"
                        role="listbox"
                        aria-label="Matching clients"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.16, ease: "easeOut" }}
                        className="absolute left-3 top-full z-40 w-[340px] overflow-hidden rounded-lg border border-slate-900/10 bg-white py-1 shadow-[0_18px_40px_-18px_rgba(15,23,42,0.4)]"
                      >
                        {matches.map((match, index) => {
                          const name = contactDisplayName(match);
                          return (
                            <li key={match.contact.id}>
                              <button
                                type="button"
                                role="option"
                                aria-selected={index === highlightIndex}
                                onMouseEnter={() => setHighlightIndex(index)}
                                onClick={() => handleSaveRecipient(match.contact.email)}
                                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left cursor-pointer ${
                                  index === highlightIndex ? "bg-lead/8" : ""
                                }`}
                              >
                                <OrgAvatar
                                  orgName={match.thread.orgName}
                                  color={getSectorColor(match.thread.sector)}
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-center gap-1.5">
                                    <span className="truncate font-body text-[13px] font-medium text-slate-900">
                                      <HighlightedText
                                        text={match.thread.orgName}
                                        query={recipientQuery}
                                        matchedClassName="font-bold"
                                      />
                                    </span>
                                    {match.contact.isPrimary && (
                                      <span className="shrink-0 rounded-full bg-lead/10 px-1.5 text-[9px] font-bold uppercase tracking-wide text-lead">
                                        Primary
                                      </span>
                                    )}
                                  </span>
                                  <span className="mt-0.5 block truncate font-body text-[11px] font-medium text-slate-500">
                                    <HighlightedText
                                      text={match.contact.email}
                                      query={recipientQuery}
                                      matchedClassName="font-bold text-slate-900"
                                    />
                                    {name && (
                                      <>
                                        <span className="mx-1 text-slate-400">·</span>
                                        <HighlightedText
                                          text={name}
                                          query={recipientQuery}
                                          matchedClassName="font-bold text-slate-900"
                                        />
                                      </>
                                    )}
                                  </span>
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </motion.ul>
                    )}

                    {isRecipientFocused && showAddToDatabase && (
                      <motion.div
                        key="add-to-database"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.16, ease: "easeOut" }}
                        className="absolute left-3 top-full z-40 w-[340px] rounded-lg border border-slate-900/10 bg-white p-3.5 shadow-[0_18px_40px_-18px_rgba(15,23,42,0.4)]"
                      >
                        {/* This panel used to offer an "Add to database"
                            button that wrote nothing: it showed "Added to your
                            database" for 900ms and then set the typed string
                            as the recipient, leaving a CAM believing a contact
                            row existed when none did. Creating a contact is a
                            real operation with real rules — dedup against the
                            organisation, `is_primary` handling, and F247's ban
                            on storing personal addresses — none of which a
                            compose window can decide. So it says what is true
                            and points at the screen that can do it. */}
                        <span className="flex items-start gap-2">
                          <UserPlus className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                          <span className="font-body text-[12px] leading-snug text-slate-600">
                            <span className="font-semibold text-slate-900">
                              {recipientQuery.trim()}
                            </span>{" "}
                            isn&rsquo;t on any client record you can reach, so there is
                            nothing to send this against. Add them as a contact on the
                            client&rsquo;s record first &mdash; outreach is always
                            tracked against an organisation.
                          </span>
                        </span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              <AnimatePresence>
                {showSavedFlash && (
                  <motion.span
                    key="saved-flash"
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 6 }}
                    transition={{ duration: 0.2 }}
                    className="flex items-center gap-1 text-xs font-semibold text-emerald-600 shrink-0"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Saved
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </div>
          {errors.to && <p className="text-[11px] text-red-600 pl-12 pt-1">{errors.to}</p>}

          {/* Subject Input */}
          <div className="flex items-center border-b border-slate-900/8 py-2">
            <input
              type="text"
              aria-label="Subject"
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                if (errors.subject) setErrors((prev) => ({ ...prev, subject: undefined }));
              }}
              placeholder="Subject"
              className="w-full text-sm font-body text-slate-800 placeholder:text-slate-500 placeholder:font-body border-0 bg-transparent focus:outline-none focus:ring-0 p-0"
            />
          </div>
          {errors.subject && (
            <p className="text-[11px] text-red-600 pt-1">{errors.subject}</p>
          )}

          {/* Body — AI-first: an empty draft opens on the AI picker rather than
              a bare textarea, so the CAM decides how the AI should write before
              the draft exists. The picker asks for the same five settings the
              client record's outreach tab offers (see compose-button.tsx);
              "Draft manually" swaps to the plain composer, which still keeps
              one-tap AI drafting. */}
          <div className="relative flex-1 min-h-0 pt-3 flex flex-col overflow-hidden">
            {isAiGenerating ? (
              <div className="pt-1" aria-label="Drafting">
                <AiThinkingState
                  stage={draftStream.displayStage}
                  startedAt={draftStream.startedAt}
                  heading="Drafting"
                />
                {draftStream.displayStage === "done" && (
                  <StreamingDraftText
                    subject={draftStream.subject}
                    body={draftStream.body}
                    streaming={draftStream.status === "streaming"}
                    onRevealComplete={commitStagedGenerated}
                  />
                )}
              </div>
            ) : isWritingManually || (body.length > 0 && !showAiOptions) ? (
              <>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write your message"
                  spellCheck={spellCheckOn}
                  autoCapitalize="sentences"
                  className="w-full h-full text-[13px] text-slate-800 placeholder:text-slate-400 border-0 bg-transparent focus:outline-none focus:ring-0 resize-none p-0 leading-6 font-sans"
                />
                {body.length === 0 && (
                  <button
                    type="button"
                    onClick={openAiPicker}
                    onMouseEnter={() => setDraftPillHover(true)}
                    onMouseLeave={() => setDraftPillHover(false)}
                    className="absolute left-0 top-11 flex items-center gap-1.5 rounded-full border border-slate-900/10 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-900/20 hover:text-slate-900 hover:shadow-sm transition-all cursor-pointer"
                  >
                    <LoaderPinwheel animate={draftPillHover} size={14} className="text-lead" />
                    Use AI to draft
                  </button>
                )}
              </>
            ) : (
              <div className="relative flex-1 min-h-0 mb-2 overflow-hidden rounded-2xl border border-slate-900/8 bg-slate-50/70">
                <AnimatePresence>
                    {drillSetting === null ? (
                      <AiCategoryPage
                        key="ai-categories"
                        rows={categoryRows}
                        onOpen={(key) =>
                          setDrillSetting(key === "context" ? "context" : (key as AiSettingKey))
                        }
                      />
                    ) : drillSetting === "context" ? (
                      <AiContextPage
                        key="ai-context"
                        hasClient={client !== null}
                        onOpenBooklet={() => {
                          setDrillSetting(null);
                          setPanel("booklet");
                        }}
                        onOpenProfile={() => {
                          setDrillSetting(null);
                          setPanel("profile");
                        }}
                        onBack={() => setDrillSetting(null)}
                        onAddRecipient={() => {
                          // Back to the settings list, and the To capsule
                          // expands with the caret ready — saving a recipient
                          // is what unlocks this very page.
                          setDrillSetting(null);
                          recipientInputRef.current?.focus();
                        }}
                      />
                    ) : activeDrill ? (
                      <AiOptionPage
                        key={activeDrill.key}
                        title={activeDrill.title}
                        options={activeDrill.options}
                        selected={activeDrill.selected}
                        onSelect={activeDrill.onSelect}
                        onBack={() => setDrillSetting(null)}
                      />
                    ) : null}
                  </AnimatePresence>

                  {/* The two actions float over the list's bottom edge, never
                      in a bar of their own beneath it. */}
                  <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={handleAiDraft}
                      disabled={!client}
                      onMouseEnter={() => setGenerateHover(true)}
                      onMouseLeave={() => setGenerateHover(false)}
                      title={
                        client
                          ? "Generate the first draft from the settings above"
                          : "Save a recipient first — the AI drafts from their booklet and profile"
                      }
                      className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg bg-lead px-4 py-2 text-[12px] font-bold text-white shadow-[0_12px_28px_-12px_rgba(35,64,122,0.75)] transition-colors hover:bg-[#1b3160] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <LoaderPinwheel animate={generateHover} size={14} aria-hidden="true" />
                      Generate draft
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsWritingManually(true)}
                      className="pointer-events-auto inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-white/80 px-3 py-2 text-[12px] font-semibold text-slate-700 shadow-[0_8px_20px_-10px_rgba(15,23,42,0.4)] backdrop-blur-sm transition-colors hover:bg-white hover:text-slate-900"
                    >
                      <PenLine aria-hidden="true" className="h-3.5 w-3.5" />
                      Draft manually
                    </button>
                  </div>
                </div>
            )}
          </div>

          {/* Whatever creating the draft refused with, verbatim: it names the
              owner, the suppression reason or the permission that is missing,
              and each one asks for something different from the CAM. */}
          {sendError && (
            <p className="mt-2 text-[11px] font-semibold text-red-600" role="alert">
              {sendError}
            </p>
          )}

          {/* Files chosen but not yet uploaded — they ride along when Send
              creates the draft (handleSend → uploadStagedFiles). */}
          {stagedFiles.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {stagedFiles.map((file, index) => (
                <li
                  key={`${file.name}-${index}`}
                  className="flex items-center gap-1.5 rounded-full border border-slate-900/10 bg-white/70 px-2.5 py-1 text-[11px] text-slate-700"
                >
                  <FileText aria-hidden="true" className="h-3 w-3 shrink-0 text-slate-400" />
                  <span className="max-w-[12rem] truncate">{file.name}</span>
                  <span className="text-slate-400">{formatFileSize(file.size)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => removeStagedFile(index)}
                    className="text-slate-400 hover:text-red-600 cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {attachError && (
            <p className="mt-2 text-[11px] font-semibold text-red-600" role="alert">
              {attachError}
            </p>
          )}

          {/* The shared review panel, over the composed draft. It owns the
              approval gate and every commit — send, schedule, save, discard —
              so this window has one send path and it is the same one the
              client record uses (F250). */}
          {reviewDraft && sendableClient && (
            <div className="mt-3 rounded-panel border border-rule bg-white p-3">
              <EmailReviewPanel
                description="Sending as the branch mailbox. The recipient, subject and body below are exactly what will go out."
                draft={reviewDraft}
                heading={pendingScheduleIso ? "Review before scheduling" : "Review before sending"}
                initialScheduledAt={pendingScheduleIso}
                idPrefix="inbox-compose-review"
                onCommitted={(result) => {
                  onSend({
                    to: reviewDraft.savedRecipient ?? savedTo ?? "",
                    subject,
                    body,
                    scheduledFor: result.scheduledFor,
                  });
                  resetDraft();
                  onClose();
                }}
                onDraftCleared={() => {
                  setReviewDraft(null);
                  setPendingScheduleIso(null);
                }}
                organisationId={sendableClient.id}
              />
            </div>
          )}

          {/* Bottom Action Bar */}
          <div className="flex items-center justify-between gap-2 border-t border-slate-900/8 pt-3 mt-auto">
            <div className="flex items-center gap-1 shrink-0">
              {/* Split control: the send half and the schedule caret read as one
                  lead slab, parted by a hairline rather than a gap.

                  Both halves were inert until this window could resolve a
                  typed address to a real client. It searches the inbox's real
                  threads now (see the `directory` prop), so Send runs the
                  approved path — blank draft, then the same server action the
                  client record calls, with its ownership, suppression, rate
                  limit, audit entry and status transition. What stays disabled
                  is a send that could not be honest: a recipient matching no
                  client in the database, or an unreviewed draft. */}
              <div className="relative flex items-stretch shrink-0">
                <SendButton
                  disabled={cannotSend}
                  label={reviewDraft ? "Reviewing…" : "Review"}
                  onClick={() => void handleSend()}
                  pending={isSending}
                  pendingLabel="Preparing…"
                  title={sendBlockedReason ?? "Review this email, then send it"}
                  tone="lead"
                  radius="lg"
                  className="!h-9 rounded-r-none pr-3 pl-4 text-[13px]"
                />
                {/* Inset grey groove — reads as a seam between the two halves
                    rather than a gap. Held short of the top and bottom edges. */}
                <span
                  aria-hidden="true"
                  className="my-1.5 w-px bg-slate-900/20"
                />
                <Hint label="More send options">
                  {/* The caret mirrors Send's own gate: a schedule needs a real
                      client behind the recipient, and once the review panel is
                      open the panel's own schedule control takes over. The
                      picked time travels with handleSend into that panel, so it
                      is chosen once, not twice. */}
                  <button
                    type="button"
                    onClick={() => setIsScheduleMenuOpen((open) => !open)}
                    disabled={cannotSend}
                    aria-haspopup="menu"
                    aria-expanded={isScheduleMenuOpen}
                    className="flex h-9 w-8 items-center justify-center rounded-r-lg bg-lead text-white ring-1 ring-white/20 shadow-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] transition-colors hover:bg-[#1b3160] disabled:pointer-events-none disabled:opacity-50 cursor-pointer"
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform duration-200 ${
                        isScheduleMenuOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                </Hint>

                <AnimatePresence>
                  {isScheduleMenuOpen && (
                    <motion.div
                      role="menu"
                      initial={{ opacity: 0, y: 6, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 6, scale: 0.97 }}
                      transition={{ duration: 0.16, ease: "easeOut" }}
                      className="absolute bottom-full left-0 z-40 mb-2 w-44 origin-bottom-left rounded-lg border border-slate-900/10 bg-white p-1 shadow-[0_12px_32px_-12px_rgba(15,23,42,0.35)]"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setIsScheduleMenuOpen(false);
                          setIsScheduleDialogOpen(true);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-body font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
                      >
                        <CalendarClock className="h-4 w-4 text-slate-500" />
                        Schedule send
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <Hint label="Draft with AI">
                <button
                  type="button"
                  onClick={openAiPicker}
                  disabled={isAiGenerating}
                  onMouseEnter={() => setAiToolbarHover(true)}
                  onMouseLeave={() => setAiToolbarHover(false)}
                  className={`${iconButton} disabled:opacity-50 disabled:cursor-default`}
                >
                  {isAiGenerating ? (
                    <Loader2 className="h-4 w-4 animate-spin text-lead" />
                  ) : (
                    <LoaderPinwheel animate={aiToolbarHover} size={16} />
                  )}
                </button>
              </Hint>

              {/* Attach files. The picker only stages them here — nothing is
                  uploaded until Send has a draft to link them to (handleSend →
                  uploadStagedFiles). */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ALLOWED_ATTACHMENT_MIME_TYPES.join(",")}
                className="sr-only"
                tabIndex={-1}
                onChange={(event) => {
                  stageFiles(event.target.files);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              />
              <Hint label="Attach files">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={iconButton}
                  aria-label="Attach files"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
              </Hint>

              {/* More options — the ⋮ menu. "Add label" jumps to the tag
                  picker (mounted below); "Spell check" flips the body's
                  squiggles for a draft full of names and acronyms. */}
              <div className="relative">
                <Hint label="More options">
                  <button
                    type="button"
                    onClick={() => setIsKebabOpen((open) => !open)}
                    aria-haspopup="menu"
                    aria-expanded={isKebabOpen}
                    aria-label="More options"
                    className={iconButton}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </Hint>

                <AnimatePresence>
                  {isKebabOpen && (
                    <motion.div
                      role="menu"
                      initial={{ opacity: 0, y: 6, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 6, scale: 0.97 }}
                      transition={{ duration: 0.16, ease: "easeOut" }}
                      className="absolute bottom-full left-0 z-40 mb-2 w-52 origin-bottom-left rounded-lg border border-slate-900/10 bg-white p-1 shadow-[0_12px_32px_-12px_rgba(15,23,42,0.35)]"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!sendableClient}
                        onClick={() => {
                          setIsKebabOpen(false);
                          setIsLabelPickerOpen(true);
                        }}
                        title={
                          sendableClient
                            ? "Add a label to this client"
                            : "Save a recipient first — labels are set on the client"
                        }
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-body font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent cursor-pointer"
                      >
                        <Tag className="h-4 w-4 text-slate-500" />
                        Add label
                      </button>
                      <button
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={spellCheckOn}
                        onClick={() => setSpellCheckOn((on) => !on)}
                        className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm font-body font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <SpellCheck2 className="h-4 w-4 text-slate-500" />
                          Spell check
                        </span>
                        {spellCheckOn && <Check className="h-4 w-4 text-lime-700" />}
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* The label picker, opening upward out of the ⋮ (the modal
                    clips anything that tries to open downward). Mounted only
                    with a real client behind it. */}
                <AnimatePresence>
                  {isLabelPickerOpen && sendableClient && (
                    <ComposeLabelMenu
                      organisationId={sendableClient.id}
                      assignedTags={assignedTags}
                      assignableTags={assignableTags}
                      onAssigned={(added) =>
                        setLocallyAssignedTags((prev) => {
                          const byId = new Map(prev.map((tag) => [tag.id, tag]));
                          for (const tag of added) byId.set(tag.id, tag);
                          return [...byId.values()];
                        })
                      }
                      onClose={() => setIsLabelPickerOpen(false)}
                    />
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Client context — dead until an address resolves to a record. */}
            <div className="flex items-center gap-1 min-w-0">
              <ContextButton
                icon={BookOpen}
                label="Booklet"
                disabled={!client}
                onClick={() => setPanel("booklet")}
                className={contextPill}
              />
              <ContextButton
                icon={Building2}
                label="Profile"
                disabled={!client}
                onClick={() => setPanel("profile")}
                className={contextPill}
              />

              <Hint label="Discard draft">
                <button
                  type="button"
                  onClick={() => {
                    resetDraft();
                    onClose();
                  }}
                  className="p-2 rounded-full text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </Hint>
            </div>
          </div>
        </div>
      )}

      {/* Schedule send — Gmail's shape: three presets, then a pick-your-own row.
          Scoped to the compose panel rather than the page, so the inbox behind
          it stays readable while a time is chosen. */}
      <AnimatePresence>
        {!isMinimized && isScheduleDialogOpen && (
          <motion.div
            key="schedule-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-40 flex items-center justify-center rounded-[inherit] bg-slate-900/25 p-5"
            onClick={closeScheduleDialog}
          >
            <motion.div
              role="dialog"
              aria-label="Schedule send"
              initial={{ opacity: 0, y: 10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.97 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-[340px] overflow-hidden rounded-xl bg-white shadow-[0_24px_60px_-20px_rgba(15,23,42,0.5)]"
            >
              <div className="flex items-center justify-between border-b border-slate-900/8 px-4 py-3">
                <span className="text-[13px] font-body font-medium text-slate-900">
                  {scheduleStep === "pick"
                    ? "Schedule send"
                    : scheduleStep === "confirm"
                      ? "Confirm scheduled send"
                      : "Send scheduled"}
                </span>
                {scheduleStep !== "done" && (
                  <button
                    type="button"
                    onClick={closeScheduleDialog}
                    className="p-1 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                    title="Close"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {scheduleStep === "pick" && (
                <>
                  <ul className="py-1">
                    {suggestions.map((suggestion) => (
                      <li key={suggestion.id}>
                        <button
                          type="button"
                          onClick={() => beginSchedule(suggestion.when)}
                          className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50 cursor-pointer"
                        >
                          <span className="text-[13px] text-slate-800">{suggestion.label}</span>
                          <span className="text-[11px] text-slate-500 shrink-0">
                            {formatScheduleTime(suggestion.when)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>

                  <div className="border-t border-slate-900/8 px-4 py-3">
                    {customWhen === null ? (
                      <button
                        type="button"
                        onClick={() =>
                          setCustomWhen(
                            toLocalInputValue(
                              new Date(Date.now() + 60 * 60 * 1000),
                            ),
                          )
                        }
                        className="flex items-center gap-2 text-[12px] font-semibold text-lead hover:underline cursor-pointer"
                      >
                        <CalendarClock className="h-3.5 w-3.5" />
                        Pick date &amp; time
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          type="datetime-local"
                          value={customWhen}
                          min={toLocalInputValue(new Date())}
                          onChange={(event) => setCustomWhen(event.target.value)}
                          aria-label="Send date and time"
                          className="flex-1 min-w-0 rounded-md border border-slate-200 px-2 py-1.5 text-[12px] text-slate-800 focus:border-lead focus:outline-none"
                        />
                        <button
                          type="button"
                          disabled={!customWhen}
                          onClick={() => beginSchedule(new Date(customWhen))}
                          className="shrink-0 rounded-md bg-lead px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#1b3160] disabled:opacity-50 cursor-pointer"
                        >
                          Schedule
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}

              {scheduleStep === "confirm" && pendingWhen && (
                <div className="px-4 py-4">
                  <p className="text-[13px] leading-[1.6] text-slate-700">
                    Confirm you want to schedule this send. Once scheduled you
                    won&rsquo;t be able to edit the message &mdash; it goes out on
                    its own.
                  </p>
                  <p className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-slate-900">
                    <CalendarClock className="h-3.5 w-3.5 text-lead" />
                    {formatScheduleLong(pendingWhen)}
                  </p>
                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setScheduleStep("pick");
                        setPendingWhen(null);
                      }}
                      className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                    >
                      Keep editing
                    </button>
                    <button
                      type="button"
                      onClick={confirmSchedule}
                      className="rounded-md bg-lead px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#1b3160] cursor-pointer"
                    >
                      I understand, schedule it
                    </button>
                  </div>
                </div>
              )}

              {/* Not "Scheduled" — nothing is scheduled at this point.
                  This step used to claim it was, while the chosen time was
                  being dropped on the floor and an ordinary review panel
                  opened underneath. The time is real and carried through now,
                  but the commit still belongs to the review panel's approval
                  gate, so this says what actually happens next. */}
              {scheduleStep === "done" && pendingWhen && (
                <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-lead-wash">
                    <CalendarClock className="h-5 w-5 text-lead" />
                  </span>
                  <p className="text-[13px] font-semibold text-slate-900">
                    Ready to schedule for {formatScheduleLong(pendingWhen)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Review the message below and tick the approval box, then
                    press Schedule send. Nothing is queued until you do.
                  </p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Save-or-discard — the X never closes on a draft silently. With any
          content on the page it asks: keep it for later, or throw it away. */}
      <AnimatePresence>
        {!isMinimized && isCloseDialogOpen && (
          <motion.div
            key="close-dialog-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-40 flex items-center justify-center rounded-[inherit] bg-slate-900/25 p-5"
            onClick={() => setIsCloseDialogOpen(false)}
          >
            <motion.div
              role="dialog"
              aria-label="Save or discard draft"
              initial={{ opacity: 0, y: 10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.97 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-[320px] overflow-hidden rounded-xl bg-white shadow-[0_24px_60px_-20px_rgba(15,23,42,0.5)]"
            >
              <div className="flex items-center justify-between border-b border-slate-900/8 px-4 py-3">
                <span className="text-[13px] font-bold text-slate-900">Save this message?</span>
                <button
                  type="button"
                  onClick={() => setIsCloseDialogOpen(false)}
                  className="p-1 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                  title="Keep writing"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <p className="px-4 py-3 text-[12px] leading-[1.5] text-slate-500">
                Save it as a draft to finish later, or discard it for good.
              </p>

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-900/8 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setIsCloseDialogOpen(false)}
                  className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer transition-colors"
                >
                  Keep writing
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetDraft();
                    setIsCloseDialogOpen(false);
                    onClose();
                  }}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-[12px] font-semibold text-red-600 hover:bg-red-50 cursor-pointer transition-colors"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsCloseDialogOpen(false);
                    onClose();
                  }}
                  className="rounded-full bg-lead px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-[#1b3160] cursor-pointer"
                >
                  Save as draft
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Client booklet / profile — a pop-up of their own, separate from the
          Draft-with-AI picker, so the settings underneath are never lost. */}
      <AnimatePresence>
        {!isMinimized && panel && client && (
          <motion.div
            key="context-popup-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-50 flex items-center justify-center rounded-[inherit] bg-slate-900/30 p-6"
            onClick={() => setPanel(null)}
          >
            <motion.div
              role="dialog"
              aria-label={
                panel === "booklet"
                  ? `Client booklet for ${client.orgName}`
                  : `Client profile for ${client.orgName}`
              }
              initial={{ opacity: 0, y: 14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.97 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              onClick={(event) => event.stopPropagation()}
              className="flex max-h-full w-full max-w-[420px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_28px_70px_-24px_rgba(15,23,42,0.6)]"
            >
              <div className="flex items-center justify-between gap-3 border-b border-slate-900/8 px-4 py-3">
                <span className="min-w-0 truncate text-[13px] font-bold text-slate-900">
                  {panel === "booklet"
                    ? `Client booklet · ${client.orgName}`
                    : `Client profile · ${client.orgName}`}
                </span>
                <button
                  type="button"
                  onClick={() => setPanel(null)}
                  className="shrink-0 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                  title="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-3">
                {panel === "booklet" &&
                  (booklet ? (
                    <BookletView text={booklet.text} generatedAt={booklet.generatedAt} />
                  ) : bookletState === "loading" ? (
                    <p className="flex items-center gap-2 text-[12px] text-slate-500">
                      <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                      Loading this client&rsquo;s booklet&hellip;
                    </p>
                  ) : bookletState === "failed" ? (
                    <p className="text-[12px] text-slate-500">
                      The booklet could not be loaded. Open the client&rsquo;s record to read it.
                    </p>
                  ) : !sendableClient ? (
                    <p className="text-[12px] text-slate-500">
                      Booklets are held per client record, so there is none behind this
                      recipient.
                    </p>
                  ) : (
                    <p className="text-[12px] text-slate-500">
                      No booklet saved for this client yet. Generate one from their record.
                    </p>
                  ))}
                {panel === "profile" && <ProfileView client={client} />}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A client can hold at most this many tags — mirrors MAX_TAGS_PER_CLIENT in
    @/lib/tags/assign-tag-core. The server is the real gate; this only stops
    the menu offering a ninth. */
const MAX_LABELS_PER_CLIENT = 8;

/**
 * The compose window's "Add label" panel. Labels are tags (F188-F194): this
 * assigns an existing one to the recipient's client, or creates and assigns a
 * new one, through the same server actions the client record uses. Removing a
 * label is deliberately not offered here — that belongs on the client record.
 *
 * Opens upward (`bottom-full`) because the compose modal clips anything that
 * tries to open past its bottom edge.
 */
function ComposeLabelMenu({
  organisationId,
  assignedTags,
  assignableTags,
  onAssigned,
  onClose,
}: {
  organisationId: string;
  assignedTags: InboxThreadTag[];
  assignableTags: InboxThreadTag[];
  onAssigned: (added: InboxThreadTag[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Click outside the panel closes it — the ⋮ menu it opened from is already
  // gone, so there is nothing else to dismiss it.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [onClose]);

  const needle = query.trim().toLowerCase();
  const results = useMemo(
    () =>
      (needle
        ? assignableTags.filter((tag) => tag.name.toLowerCase().includes(needle))
        : assignableTags
      )
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [assignableTags, needle],
  );
  const exactExists = useMemo(
    () =>
      [...assignedTags, ...assignableTags].some(
        (tag) => tag.name.toLowerCase() === needle,
      ),
    [assignedTags, assignableTags, needle],
  );
  const atCap = assignedTags.length >= MAX_LABELS_PER_CLIENT;

  async function assignExisting(tag: InboxThreadTag) {
    if (busy || atCap) return;
    setBusy(true);
    setError(null);
    const result = await assignTagsBatchAction(organisationId, [tag.id]);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onAssigned([tag]);
    setQuery("");
  }

  async function createAndAssign() {
    const name = query.trim();
    if (busy || atCap || !name) return;
    setBusy(true);
    setError(null);
    const result = await createAndAssignTagAction(organisationId, name, null);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onAssigned([
      { id: result.tag.id, name: result.tag.name, colour: result.tag.colour ?? null },
    ]);
    setQuery("");
  }

  return (
    <motion.div
      ref={panelRef}
      role="dialog"
      aria-label="Add a label"
      initial={{ opacity: 0, y: 6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.97 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className="absolute bottom-full left-0 z-40 mb-2 w-64 origin-bottom-left rounded-lg border border-slate-900/10 bg-white p-2 shadow-[0_12px_32px_-12px_rgba(15,23,42,0.35)]"
    >
      {assignedTags.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1 px-1">
          {assignedTags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                backgroundColor: `color-mix(in srgb, ${tag.colour ?? "var(--lead)"} 14%, transparent)`,
                color: tag.colour ?? "var(--lead)",
              }}
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}

      <input
        autoFocus
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
          if (event.key === "Enter" && needle && !exactExists) {
            event.preventDefault();
            void createAndAssign();
          }
        }}
        placeholder="Search or create a label"
        aria-label="Search or create a label"
        autoComplete="off"
        className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-[12px] text-slate-800 placeholder:text-slate-400 focus:border-lead focus:outline-none"
      />

      {atCap && (
        <p className="mt-1.5 px-1 text-[11px] text-slate-500">
          This client already has {MAX_LABELS_PER_CLIENT} labels — the most allowed.
        </p>
      )}

      <ul className="mt-1.5 max-h-44 overflow-y-auto">
        {results.map((tag) => (
          <li key={tag.id}>
            <button
              type="button"
              disabled={busy || atCap}
              onClick={() => void assignExisting(tag)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: tag.colour ?? "var(--lead)" }}
              />
              <span className="truncate">{tag.name}</span>
            </button>
          </li>
        ))}

        {needle && !exactExists && (
          <li>
            <button
              type="button"
              disabled={busy || atCap}
              onClick={() => void createAndAssign()}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] font-medium text-lead hover:bg-lead/8 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              <Tag className="h-3.5 w-3.5 shrink-0" />
              Create &ldquo;{query.trim()}&rdquo;
            </button>
          </li>
        )}

        {results.length === 0 && (!needle || exactExists) && (
          <li className="px-2 py-3 text-center text-[11px] text-slate-400">
            {exactExists ? "Already on this client." : "No more labels to add."}
          </li>
        )}
      </ul>

      {error && (
        <p role="alert" className="mt-1.5 px-1 text-[11px] font-semibold text-red-600">
          {error}
        </p>
      )}
    </motion.div>
  );
}

function ContextButton({
  icon: Icon,
  label,
  disabled,
  onClick,
  className,
}: {
  icon: LucideIcon;
  label: string;
  disabled: boolean;
  onClick: () => void;
  className: string;
}) {
  return (
    <Hint
      label={
        disabled
          ? "Save a recipient to load their record"
          : `View ${label.toLowerCase()}`
      }
    >
      {/* `aria-disabled` rather than the `disabled` attribute — a truly disabled
          button swallows the hover events the tooltip needs, and the point of
          the disabled state here is to *explain itself*. */}
      <button
        type="button"
        onClick={disabled ? undefined : onClick}
        aria-disabled={disabled || undefined}
        className={`${className} ${
          disabled
            ? "text-slate-300 cursor-not-allowed"
            : "text-slate-600 hover:bg-lead/8 hover:text-lead cursor-pointer"
        }`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span>{label}</span>
      </button>
    </Hint>
  );
}

/** The booklet is stored as markdown-ish text; this renders the subset the
    generator actually emits — `##` / `###` headings, `-` bullets, paragraphs. */
function BookletView({ text, generatedAt }: { text: string; generatedAt: string }) {
  return (
    <div>
      <p className="text-[10px] text-slate-400">Generated {formatDate(generatedAt)}</p>
      <div className="mt-2 space-y-2">
        {text.split("\n").map((line, index) => {
          const trimmed = line.trim();
          if (!trimmed) return null;
          if (trimmed.startsWith("### ")) {
            return (
              <h4 key={index} className="pt-1.5 text-[11px] font-bold uppercase tracking-wide text-lead">
                {trimmed.slice(4)}
              </h4>
            );
          }
          if (trimmed.startsWith("## ")) {
            return (
              <h3 key={index} className="text-sm font-bold text-slate-900">
                {trimmed.slice(3)}
              </h3>
            );
          }
          if (trimmed.startsWith("- ")) {
            return (
              <p key={index} className="flex gap-2 text-[12px] leading-5 text-slate-700">
                <span className="text-slate-400">•</span>
                <span>{trimmed.slice(2)}</span>
              </p>
            );
          }
          return (
            <p key={index} className="text-[12px] leading-5 text-slate-700">
              {trimmed.replaceAll("**", "")}
            </p>
          );
        })}
      </div>
    </div>
  );
}

function ProfileView({ client }: { client: AddressableClient }) {
  const rows: Array<{ icon: LucideIcon; label: string; value: string }> = [
    { icon: Building2, label: "Type", value: client.orgType },
    { icon: MapPin, label: "Location", value: `${client.city}, ${client.country}` },
    { icon: Mail, label: "Contact", value: `${client.primaryContact.name} — ${client.primaryContact.email}` },
  ];
  if (client.primaryContact.phone) {
    rows.push({ icon: Phone, label: "Phone", value: client.primaryContact.phone });
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-bold text-slate-900">{client.orgName}</p>
        <p className="text-[11px] text-slate-500">{client.sector}</p>
      </div>
      <dl className="space-y-2">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <div key={row.label} className="flex items-start gap-2">
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
              <div className="min-w-0">
                <dt className="text-[10px] uppercase tracking-wide text-slate-400">{row.label}</dt>
                <dd className="text-[12px] text-slate-700">{row.value}</dd>
              </div>
            </div>
          );
        })}
      </dl>
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <p className="text-[10px] uppercase tracking-wide text-slate-400">Owner</p>
        <p className="text-[12px] text-slate-700">{client.camOwner.name}</p>
      </div>
    </div>
  );
}
