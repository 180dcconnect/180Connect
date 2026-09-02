"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MorphingPopover,
  MorphingPopoverTrigger,
  MorphingPopoverContent,
} from "@/components/core/morphing-popover";
import { motion } from "motion/react";
import { ArrowLeftIcon } from "lucide-react";
import { OriginButton } from "@/components/ui/origin-button";

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

  const saving = busy || isRefreshing;
  const isBlank = content.trim().length === 0;

  const closeMenu = () => {
    setContent("");
    setError(null);
    setIsOpen(false);
  };

  async function save() {
    if (isBlank) {
      setError("Write something before saving.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/clients/${organisationId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, replyEventId }),
      });
      if (response.ok) {
        setContent("");
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
              className="min-h-[7.5rem] w-full flex-1 resize-none rounded-t-2xl bg-transparent px-4 py-3 text-sm leading-[1.7] text-ink outline-none"
              autoFocus
              disabled={saving}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <div className="flex items-center justify-between gap-3 border-t border-rule py-2.5 pr-3 pl-2">
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
