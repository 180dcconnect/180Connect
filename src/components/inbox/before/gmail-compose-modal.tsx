"use client";

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import {
  X,
  Minus,
  Maximize2,
  Minimize2,
  Paperclip,
  PenLine,
  Trash2,
  Sparkles,
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
} from "lucide-react";
import { GooeyEmailInput } from "@/components/ui/gooey-email-input";
import { SendButton } from "@/components/ui/send-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/animate-ui/components/radix/tooltip";
import { EASE, stagger } from "@/components/brand/motion";
import { LIP } from "@/components/brand/tokens";
import {
  MOCK_INBOX_THREADS,
  getMockBooklet,
  getMockContacts,
  searchRecipients,
  type MockThread,
  type RecipientMatch,
} from "@/lib/inbox-mock-data";
import {
  EMAIL_LENGTHS,
  EMAIL_TONES,
  EMAIL_VOICES,
  OPENING_APPROACHES,
  CLOSING_APPROACHES,
  type EmailLength,
  type EmailTone,
  type EmailVoice,
  type OpeningApproach,
  type ClosingApproach,
} from "@/lib/outreach/stage-one-prompt";
import { getSectorColor } from "./gmail-sidebar";

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
};

/** Which context sheet is covering the draft, if any. */
type ContextPanel = "booklet" | "profile" | null;

const AI_DRAFT_BODY = `Dear Partner,

I hope this email finds you well.

I am writing from 180 Degrees Consulting regarding our upcoming semester pro-bono consulting projects. Our team provides end-to-end strategic consulting across operational scaling, fundraising analytics, and volunteer coordination at zero cost to registered charities.

Would you have 15 minutes next week for a brief introductory call to discuss your current strategic priorities?

Warm regards,
Ada Lovelace
Client Account Manager | 180 Degrees Consulting`;

/** The things the AI needs to write the email — the same five dials the client
    record's outreach tab offers for its Stage 1 email, plus the booklet and
    profile it reads as context (see src/app/clients/[id]/compose-button.tsx).
    Kept as one record so a selection is never left half-updated. */
type AiOptions = {
  length: EmailLength;
  tone: EmailTone;
  voice: EmailVoice;
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
                  row.chipClassName ?? "bg-lime-100 text-lime-800"
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
}: {
  hasClient: boolean;
  onOpenBooklet: () => void;
  onOpenProfile: () => void;
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
            className="px-3 py-2 font-body text-[15px] text-slate-500"
          >
            Save a recipient above to unlock their booklet and profile.
          </motion.li>
        )}
      </motion.ul>
    </motion.div>
  );
}


const DEFAULT_AI_OPTIONS: AiOptions = {
  length: "standard",
  tone: "balanced",
  voice: "180dc",
  opening: "mission_led",
  closing: "soft_cta",
};

const EMAIL_LENGTH_LABELS: Record<EmailLength, string> = {
  short: "Short",
  standard: "Standard",
  detailed: "Detailed",
};

const EMAIL_TONE_LABELS: Record<EmailTone, string> = {
  balanced: "Balanced",
  warm: "Warm",
  formal: "Formal",
  concise: "Concise",
};

const EMAIL_VOICE_LABELS: Record<EmailVoice, string> = {
  "180dc": "180DC Sheffield",
  consultative: "Consultative",
  plain_language: "Plain language",
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

/** The three presets Gmail offers before "Pick date & time": the next two
    slots tomorrow, then the following Monday morning. */
function scheduleSuggestions(now: Date = new Date()): Array<{
  id: string;
  label: string;
  when: Date;
}> {
  const at = (daysAhead: number, hour: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() + daysAhead);
    date.setHours(hour, 0, 0, 0);
    return date;
  };

  // Days until the next Monday that is not today.
  const toMonday = ((8 - now.getDay()) % 7) || 7;

  return [
    { id: "tomorrow-am", label: "Tomorrow morning", when: at(1, 8) },
    { id: "tomorrow-pm", label: "Tomorrow afternoon", when: at(1, 13) },
    { id: "monday-am", label: "Monday morning", when: at(toMonday, 8) },
  ];
}

function formatScheduleTime(date: Date): string {
  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** `datetime-local` wants wall-clock text, not an ISO instant. */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The organisation behind an address — any of its contacts, not just the
    primary, since a company carries several (CONTACTS is one-to-many). */
function resolveThread(email: string): MockThread | null {
  const needle = email.trim().toLowerCase();
  if (!needle) return null;
  return (
    MOCK_INBOX_THREADS.find((thread) =>
      getMockContacts(thread).some((contact) => contact.email.toLowerCase() === needle),
    ) ?? null
  );
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  // AI-first compose: an empty draft opens on the AI picker below, which asks
  // for the outreach tab's Stage 1 settings; writing by hand is the explicit
  // "Draft manually" escape from that picker.
  const [aiOptions, setAiOptions] = useState<AiOptions>(DEFAULT_AI_OPTIONS);
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
  const [isCloseDialogOpen, setIsCloseDialogOpen] = useState(false);
  const savedTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Live draft state for the X / Escape handler, which is registered once per
  // open: kept on a ref so a keystroke doesn't tear down and re-add the window
  // listener, but closing still asks whenever anything is on the page.
  const hasDraftContentRef = useRef(false);

  // The client behind the recipient. Until an address is saved there is no
  // record to show, so the context buttons have nothing to open.
  const client = useMemo(() => resolveThread(savedTo ?? ""), [savedTo]);
  const booklet = useMemo(() => (client ? getMockBooklet(client) : null), [client]);
  const suggestions = useMemo(
    () => (isScheduleDialogOpen ? scheduleSuggestions() : []),
    [isScheduleDialogOpen],
  );
  const matches = useMemo(() => searchRecipients(recipientQuery), [recipientQuery]);
  // The list is a lookup, not an autocomplete of itself: once what is typed is
  // already a whole address there is nothing left to pick.
  const showMatches =
    !savedTo &&
    matches.length > 0 &&
    recipientQuery.trim().length >= 2 &&
    !matches.some((match) => match.contact.email === recipientQuery.trim());

  // A recipient, subject or body counts as a draft worth asking about.
  hasDraftContentRef.current = Boolean(savedTo || subject.trim() || body.trim());

  // Escape backs out of a context sheet first, and only then closes the draft.
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (isCloseDialogOpen) setIsCloseDialogOpen(false);
      else if (isScheduleDialogOpen) setIsScheduleDialogOpen(false);
      else if (isScheduleMenuOpen) setIsScheduleMenuOpen(false);
      else if (panel) setPanel(null);
      else if (hasDraftContentRef.current) setIsCloseDialogOpen(true);
      else {
        resetDraft();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, panel, isScheduleMenuOpen, isScheduleDialogOpen, isCloseDialogOpen]);

  useEffect(() => {
    const timers = savedTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  if (!isOpen) return null;

  function resetDraft() {
    setSavedTo(null);
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

  function handleSend(scheduledFor?: string) {
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

    setIsSending(true);
    savedTimers.current.push(
      setTimeout(() => {
        onSend({ to: recipient, subject, body, scheduledFor });
        setIsSending(false);
        resetDraft();
        onClose();
      }, 700),
    );
  }

  function handleAiDraft() {
    setIsAiGenerating(true);
    // A generated draft returns to the review editor — the menu was only
    // needed to pick the settings.
    setShowAiOptions(false);
    savedTimers.current.push(
      setTimeout(() => {
        // Personalise the greeting when the recipient resolves to a client;
        // without one the draft falls back to the generic partner opening.
        const first = client?.primaryContact.name.trim().split(/\s+/)[0];
        setBody(first ? AI_DRAFT_BODY.replace("Dear Partner,", `Dear ${first},`) : AI_DRAFT_BODY);
        if (!subject) {
          setSubject("Pro-Bono Strategic Consulting Support — 180 Degrees Consulting");
          setErrors((prev) => ({ ...prev, subject: undefined }));
        }
        setIsAiGenerating(false);
      }, 900),
    );
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
      key: "tone",
      title: "Email tone",
      options: EMAIL_TONES.map((value) => ({ value, label: EMAIL_TONE_LABELS[value] })),
      selected: aiOptions.tone,
      onSelect: (value) => setAiOptions((prev) => ({ ...prev, tone: value as EmailTone })),
    },
    {
      key: "voice",
      title: "Email voice",
      options: EMAIL_VOICES.map((value) => ({ value, label: EMAIL_VOICE_LABELS[value] })),
      selected: aiOptions.voice,
      onSelect: (value) => setAiOptions((prev) => ({ ...prev, voice: value as EmailVoice })),
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
    { key: "tone", label: "Email tone", chip: EMAIL_TONE_LABELS[aiOptions.tone] },
    { key: "voice", label: "Email voice", chip: EMAIL_VOICE_LABELS[aiOptions.voice] },
    { key: "opening", label: "Opening approach", chip: OPENING_APPROACH_LABELS[aiOptions.opening] },
    { key: "closing", label: "Closing approach", chip: CLOSING_APPROACH_LABELS[aiOptions.closing] },
    {
      key: "context",
      label: "Email context",
      chip: client ? client.orgName : "Add a recipient",
      // No recipient yet — the pill turns red so the missing context is
      // unmistakable rather than reading as a neutral current value.
      chipClassName: client ? undefined : "bg-red-600/95 text-white",
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
            : "bottom-0 right-8 w-[600px] h-[560px] rounded-t-2xl"
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
                      if (searchRecipients(value, 1).length > 0) return null;
                      return "No client matches that — type a full email address.";
                    }}
                    onSubmit={(value) => {
                      const typed = value.trim();
                      if (EMAIL_PATTERN.test(typed)) {
                        handleSaveRecipient(typed);
                        return;
                      }
                      const best = searchRecipients(typed, 1)[0];
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
          <div className="relative flex-1 min-h-[140px] pt-3 overflow-y-auto">
            {isAiGenerating ? (
              <div className="space-y-3 pt-1" aria-label="Drafting">
                {[92, 78, 96, 64, 84, 40].map((width, index) => (
                  <div
                    key={index}
                    className="h-2.5 rounded-full bg-slate-900/8 animate-pulse"
                    style={{ width: `${width}%`, animationDelay: `${index * 90}ms` }}
                  />
                ))}
              </div>
            ) : isWritingManually || (body.length > 0 && !showAiOptions) ? (
              <>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write your message"
                  spellCheck
                  autoCapitalize="sentences"
                  className="w-full h-full text-[13px] text-slate-800 placeholder:text-slate-400 border-0 bg-transparent focus:outline-none focus:ring-0 resize-none p-0 leading-6 font-sans"
                />
                {body.length === 0 && (
                  <button
                    type="button"
                    onClick={openAiPicker}
                    className="absolute left-0 top-11 flex items-center gap-1.5 rounded-full border border-slate-900/10 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-900/20 hover:text-slate-900 hover:shadow-sm transition-all cursor-pointer"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-lead" />
                    Use AI to draft
                  </button>
                )}
              </>
            ) : (
              <div className="flex w-full flex-col overflow-hidden rounded-2xl border border-slate-900/8 bg-white">
                <div className="flex shrink-0 items-start justify-between gap-3 px-4 pt-3 pb-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
                      <Sparkles aria-hidden="true" className="h-4 w-4 shrink-0 text-lead" />
                      Draft with AI
                    </p>
                    <p className="mt-0.5 text-[11px] leading-[1.45] text-slate-500">
                      {client
                        ? `Writes from ${client.orgName}'s booklet and profile — pick a setting to set it.`
                        : "Choose a recipient — the AI drafts from their booklet and profile."}
                    </p>
                  </div>
                </div>

                {/* Drill — tap a setting and it opens its own page (options,
                    search, then back), exactly like the search bar's filters. */}
                <div className="relative mx-2 h-[280px] overflow-hidden rounded-2xl border border-slate-900/8 bg-slate-50/70">
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
                      title={
                        client
                          ? "Generate the first draft from the settings above"
                          : "Save a recipient first — the AI drafts from their booklet and profile"
                      }
                      className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-lead px-4 py-2 text-[12px] font-bold text-white shadow-[0_12px_28px_-12px_rgba(35,64,122,0.75)] transition-colors hover:bg-[#1b3160] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
                      Generate draft
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsWritingManually(true)}
                      className="pointer-events-auto inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-white/80 px-3 py-2 text-[12px] font-semibold text-slate-700 shadow-[0_8px_20px_-10px_rgba(15,23,42,0.4)] backdrop-blur-sm transition-colors hover:bg-white hover:text-slate-900"
                    >
                      <PenLine aria-hidden="true" className="h-3.5 w-3.5" />
                      Draft manually
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Action Bar */}
          <div className="flex items-center justify-between gap-2 border-t border-slate-900/8 pt-3 mt-auto">
            <div className="flex items-center gap-1 shrink-0">
              {/* Split control: the send half and the schedule caret read as one
                  lead slab, parted by a hairline rather than a gap. */}
              <div className="relative flex items-stretch shrink-0">
                <SendButton
                  onClick={() => handleSend()}
                  pending={isSending}
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
                  <button
                    type="button"
                    onClick={() => setIsScheduleMenuOpen((open) => !open)}
                    disabled={isSending}
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

              <Hint label="Attach files">
                <button type="button" className={iconButton}>
                  <Paperclip className="h-4 w-4" />
                </button>
              </Hint>

              <Hint label="Draft with AI">
                <button
                  type="button"
                  onClick={openAiPicker}
                  disabled={isAiGenerating}
                  className={`${iconButton} disabled:opacity-50 disabled:cursor-default`}
                >
                  {isAiGenerating ? (
                    <Loader2 className="h-4 w-4 animate-spin text-lead" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                </button>
              </Hint>
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
            onClick={() => setIsScheduleDialogOpen(false)}
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
                <span className="text-[13px] font-body font-medium text-slate-900">Schedule send</span>
                <button
                  type="button"
                  onClick={() => setIsScheduleDialogOpen(false)}
                  className="p-1 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                  title="Close"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <ul className="py-1">
                {suggestions.map((suggestion) => (
                  <li key={suggestion.id}>
                    <button
                      type="button"
                      onClick={() => handleSend(suggestion.when.toISOString())}
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
                      onClick={() => {
                        const when = new Date(customWhen);
                        if (Number.isNaN(when.getTime())) return;
                        handleSend(when.toISOString());
                      }}
                      className="shrink-0 rounded-md bg-lead px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#1b3160] disabled:opacity-50 cursor-pointer"
                    >
                      Schedule
                    </button>
                  </div>
                )}
              </div>
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
                  ) : (
                    <p className="text-[12px] text-slate-500">
                      No booklet saved for this client yet.
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

function ProfileView({ client }: { client: MockThread }) {
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
