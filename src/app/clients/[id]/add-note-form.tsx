"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MorphingPopover,
  MorphingPopoverTrigger,
  MorphingPopoverContent,
} from "@/components/core/morphing-popover";
import { motion } from "motion/react";
import { ArrowLeftIcon } from "lucide-react";
import { OriginButton } from "@/components/ui/origin-button";
import {
  applyMentionInsertion,
  filterMentionCandidates,
  limitMentionIdsByOccurrences,
  mentionQueryAtCursor,
  type MentionCandidate,
} from "@/lib/note-mentions";
import { getMentionDirectory } from "@/lib/mention-directory";

/**
 * F072 — posts to /api/clients/[id]/notes. Uses MorphingPopover so the trigger
 * seamlessly transforms into the note composer textarea.
 *
 * Two things this form got wrong when it was first pasted in from the component
 * demo, both fixed here:
 *
 * - It carried `dark:` variants (`dark:bg-zinc-800` and friends). This app has
 *   no dark mode, but Tailwind's stock `dark` variant keys off the *operating
 *   system* setting — so on a Mac in dark mode the trigger rendered near-black
 *   on the bone page while everything around it stayed light. `globals.css` now
 *   binds `dark:` to an explicit `.dark` ancestor, and the variants are gone
 *   from here as well.
 * - It was a bare `<button>` in `rounded-inset`, in an app where every other button
 *   is an `OriginButton` pill. The trigger now matches `OriginButton`'s
 *   `outline` variant at `sm`, and the save action *is* an `OriginButton`.
 *
 * It lives in the Notes card's heading `action` slot, so the composer opens
 * downward over the note list (`align="end"`) instead of above it.
 *
 * F485 (#485) — typing `@` offers active users from
 * /api/users/mention-candidates and posts each choice back as an id+name
 * pair (`mentionedUsers`), so each mentioned user gets their own
 * notification — including across a rename between composing and saving,
 * since the server binds with the submitted name.
 * Routing on chosen ids (not on parsing `@Name` out of the text) is what
 * keeps an email address or a bare `@` from notifying anyone. The stored
 * content keeps the plain `@Full Name` text, so the note still reads if a
 * mention cannot be resolved later.
 */
export function AddNoteForm({
  organisationId,
  replyEventId,
}: {
  organisationId: string;
  /**
   * F136: the note is about a specific reply, so the API links the two. The
   * composer is the same popover either way — dev's version of this rendered a
   * second, inline form with its own textarea and brand-token buttons, which
   * would have put two visually different note composers on one page.
   */
  replyEventId?: string;
}) {
  const uniqueId = useId();
  const router = useRouter();
  const [content, setContent] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isRefreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // F485 mention state. `directory` is fetched once, on the first `@`
  // trigger, so opening the composer costs nothing until mentions are used.
  // `inserted` remembers every id chosen in this draft mapped to the name
  // that was spliced in; save reconciles it against the text (a mention the
  // author typed over or deleted notifies nobody).
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const insertedRef = useRef(new Map<string, string>());
  const [cursor, setCursor] = useState(0);
  const [directory, setDirectory] = useState<MentionCandidate[] | null>(null);
  const [directoryFailed, setDirectoryFailed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  // Escape dismisses the listbox without closing the composer. The trigger
  // still matches, so the dismissed position is remembered until the draft
  // or the caret moves elsewhere.
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);

  const saving = busy || isRefreshing;
  const isBlank = content.trim().length === 0;

  const mentionTrigger = mentionQueryAtCursor(content, cursor);
  const suggestions =
    mentionTrigger && directory ? filterMentionCandidates(directory, mentionTrigger.query) : [];
  const listOpen =
    mentionTrigger !== null &&
    mentionTrigger.start !== dismissedStart &&
    !directoryFailed &&
    (directory === null || suggestions.length > 0);

  function ensureDirectory() {
    if (directory !== null || directoryFailed) return;
    // Shared session cache (mention-directory.ts): typing `@` in both note
    // composers still costs a single request, and only when mentions are used.
    void getMentionDirectory()
      .then((users) => setDirectory(users))
      .catch(() => setDirectoryFailed(true));
  }

  function syncCursor() {
    setCursor(textareaRef.current?.selectionStart ?? content.length);
  }

  function chooseSuggestion(candidate: MentionCandidate) {
    const next = applyMentionInsertion(content, cursor, candidate);
    insertedRef.current.set(candidate.id, candidate.fullName);
    setContent(next.value);
    setActiveIndex(0);
    setDismissedStart(null);
    // The caret must land after the inserted name once React has painted
    // the new value — setting it synchronously races the re-render.
    requestAnimationFrame(() => {
      textareaRef.current?.setSelectionRange(next.cursor, next.cursor);
      setCursor(next.cursor);
      textareaRef.current?.focus();
    });
  }

  function onTextareaKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!listOpen) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const items = directory === null ? [] : suggestions;
      if (items.length === 0) return;
      setActiveIndex((prev) =>
        event.key === "ArrowDown"
          ? (prev + 1) % items.length
          : (prev - 1 + items.length) % items.length,
      );
    } else if (event.key === "Enter" || event.key === "Tab") {
      const candidate = directory === null ? undefined : suggestions[activeIndex];
      if (candidate) {
        event.preventDefault();
        chooseSuggestion(candidate);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (mentionTrigger) setDismissedStart(mentionTrigger.start);
    }
  }

  const closeMenu = () => {
    setContent("");
    setError(null);
    setActiveIndex(0);
    setDismissedStart(null);
    insertedRef.current.clear();
    setIsOpen(false);
  };

  async function save() {
    if (isBlank) {
      setError("Write something before saving.");
      return;
    }

    // Only ids whose `@Name` is still mentioned in the draft are sent, capped
    // per name at its occurrence count — a mention typed over, deleted, or
    // extended into a different name takes its id with it. Insertion order
    // decides ties between teammates sharing a display name. Each id echoes
    // the name as inserted, so a rename before saving keeps the mention.
    const mentionedUsers = limitMentionIdsByOccurrences(
      content,
      [...insertedRef.current.entries()].map(([id, name]) => ({ id, name })),
    )
      .map((id) => ({ id, name: insertedRef.current.get(id) ?? "" }))
      .filter((user) => user.name !== "");

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/clients/${organisationId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, replyEventId, mentionedUsers }),
      });
      if (response.ok) {
        setContent("");
        insertedRef.current.clear();
        setIsOpen(false);
        startRefresh(() => router.refresh());
        return;
      }
      const body = await response.json();
      setError(body.error ?? "The note could not be saved.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  // Two composers can be on one page — the Notes card's and one under a reply —
  // so the field id has to name the reply as well as the client.
  const fieldId = replyEventId
    ? `add-note-${organisationId}-${replyEventId}`
    : `add-note-${organisationId}`;
  const triggerLabel = replyEventId ? "Note this reply" : "Add note";
  const listboxId = `${fieldId}-mentions`;

  return (
    <MorphingPopover
      transition={{
        type: "spring",
        bounce: 0.05,
        duration: 0.3,
      }}
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !saving) {
          closeMenu();
        } else {
          setIsOpen(nextOpen);
        }
      }}
    >
      <MorphingPopoverTrigger className="inline-flex h-8.5 cursor-pointer items-center rounded-full border border-rule bg-transparent px-4 text-xs font-semibold tracking-[-0.02em] text-ink transition-colors hover:border-faint hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead-mid focus-visible:ring-offset-2 focus-visible:ring-offset-background">
        <motion.span layoutId={`popover-label-${uniqueId}`}>{triggerLabel}</motion.span>
      </MorphingPopoverTrigger>

      <MorphingPopoverContent
        align="end"
        className="rounded-panel border border-rule bg-white shadow-[0_18px_40px_-24px_rgba(12,16,20,0.45)]"
      >
        <div className="flex w-[min(24rem,calc(100vw-3rem))] min-w-[17rem] flex-col">
          <form
            className="relative flex min-h-[10.5rem] flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label className="sr-only" htmlFor={fieldId}>
              {replyEventId ? "Add a note about this reply" : "Add a note"}
            </label>
            <motion.span
              layoutId={`popover-label-${uniqueId}`}
              aria-hidden="true"
              style={{ opacity: content ? 0 : 1 }}
              className="pointer-events-none absolute top-3 left-4 text-xs font-semibold tracking-[-0.02em] text-faint select-none"
            >
              {triggerLabel}
            </motion.span>
            <textarea
              id={fieldId}
              ref={textareaRef}
              className="min-h-[7.5rem] w-full flex-1 resize-none rounded-t-2xl bg-transparent px-4 py-3 text-sm leading-[1.7] text-ink outline-none"
              autoFocus
              disabled={saving}
              value={content}
              role="combobox"
              aria-expanded={listOpen}
              aria-controls={listOpen ? listboxId : undefined}
              aria-activedescendant={
                listOpen && directory !== null && suggestions[activeIndex]
                  ? `${listboxId}-${suggestions[activeIndex].id}`
                  : undefined
              }
              onChange={(e) => {
                setContent(e.target.value);
                setActiveIndex(0);
                setDismissedStart(null);
                setCursor(e.target.selectionStart ?? e.target.value.length);
                if (mentionQueryAtCursor(e.target.value, e.target.selectionStart ?? 0)) {
                  ensureDirectory();
                }
              }}
              onSelect={syncCursor}
              onKeyDown={onTextareaKeyDown}
            />
            {listOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                role="presentation"
                className="absolute top-3 left-4 z-10 w-64 max-w-[calc(100%-2rem)] overflow-hidden rounded-panel border border-rule bg-white p-1 shadow-[0_18px_40px_-18px_rgba(20,26,34,0.32)]"
              >
                {directory === null ? (
                  <p className="px-2.5 py-2 text-xs text-dim" role="status">
                    Finding teammates…
                  </p>
                ) : (
                  <ul
                    id={listboxId}
                    role="listbox"
                    aria-label="Mention a teammate"
                    className="max-h-36 overflow-y-auto"
                  >
                    {suggestions.map((candidate, index) => (
                      <li
                        key={candidate.id}
                        id={`${listboxId}-${candidate.id}`}
                        role="option"
                        aria-selected={index === activeIndex}
                      >
                        <button
                          type="button"
                          className={`flex w-full items-center gap-1.5 rounded-inset px-2.5 py-1.5 text-left text-sm transition-colors ${
                            index === activeIndex
                              ? "bg-paper font-semibold text-ink"
                              : "text-dim hover:bg-paper/70 hover:text-ink"
                          }`}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => chooseSuggestion(candidate)}
                          onMouseEnter={() => setActiveIndex(index)}
                        >
                          <span
                            aria-hidden="true"
                            className={`font-semibold ${index === activeIndex ? "text-lead-mid" : "text-faint"}`}
                          >
                            @
                          </span>
                          {candidate.fullName}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </motion.div>
            )}
            <div className="flex items-center justify-between gap-3 py-2.5 pr-3 pl-2">
              <button
                type="button"
                className="flex cursor-pointer items-center rounded-full p-1.5 text-dim transition-colors hover:bg-paper-sunk hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead-mid disabled:opacity-50"
                onClick={closeMenu}
                disabled={saving}
                aria-label="Discard this note"
              >
                <ArrowLeftIcon aria-hidden="true" size={16} />
              </button>
              <div className="flex min-w-0 items-center gap-3">
                {error && (
                  <p
                    aria-live="polite"
                    role="alert"
                    className="truncate text-[11px] font-semibold text-stop"
                  >
                    {error}
                  </p>
                )}
                <OriginButton
                  size="sm"
                  type="submit"
                  loading={saving}
                  disabled={isBlank}
                  aria-label="Save note"
                >
                  {saving ? "Saving…" : "Save note"}
                </OriginButton>
              </div>
            </div>
          </form>
        </div>
      </MorphingPopoverContent>
    </MorphingPopover>
  );
}

export default AddNoteForm;
