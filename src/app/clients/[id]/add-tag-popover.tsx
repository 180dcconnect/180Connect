"use client";

import { useId, useMemo, useRef, useState, useTransition } from "react";
import { motion } from "motion/react";
import { ArrowLeftIcon, Check, Search } from "lucide-react";

import {
  MorphingPopover,
  MorphingPopoverTrigger,
  MorphingPopoverContent,
} from "@/components/core/morphing-popover";
import { assignTagAction } from "@/lib/tags/assign-tag-action";
import { isTagColour } from "@/lib/tags/tag-colours";

import type { AvailableTag } from "./tags-section";

/**
 * F191 — assign a tag to this client, as a type-to-search picker rather than a
 * `<select>` and an "+ Assign tag" button.
 *
 * The select was wrong twice over: it made you scroll a native dropdown to find
 * a tag by name in a list that only grows, and it sat permanently under the
 * chips, so the card carried a form whether or not anyone was tagging anything.
 *
 * It borrows AddNoteForm's `MorphingPopover`: the trigger *is* the panel, and it
 * grows into it. Two properties of that primitive matter here — the trigger's
 * flow box is frozen at its measured size while open, and the panel is
 * absolutely positioned at `z-50` over it, so opening the picker never resizes
 * or reflows the Tags card. (The card lifts its own stacking context while open; see
 * `tags-card.tsx`.)
 *
 * It opens rightwards (`align="auto"`), into the page gutter beside the narrow
 * column the Tags card sits in, so the card's own chips stay uncovered and
 * readable while you pick. On a viewport with no room there, the primitive
 * flips it back over the card rather than letting it run off the screen.
 *
 * The panel stays open after an assignment. Tagging is a batch action — you
 * rarely add exactly one — so the tag you just applied turns ticked in place,
 * the left pane and the card's chips update, and the search box keeps focus for
 * the next one.
 */
export function AddTagPopover({
  organisationId,
  assignableTags,
  assignedTags,
  onAssigned,
  open,
  onOpenChange,
}: {
  organisationId: string;
  /** Tags not already on this client — the parent owns that subtraction. */
  assignableTags: AvailableTag[];
  assignedTags: AvailableTag[];
  onAssigned: (tag: AvailableTag) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const uniqueId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyTagId, setBusyTagId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const assignedTagIds = useMemo(
    () => new Set(assignedTags.map((tag) => tag.id)),
    [assignedTags],
  );

  /**
   * One list of every tag, in name order, rather than assignable-then-assigned:
   * you search by name, so a tag has to sit where its name puts it whether or
   * not it is already on the client. The assigned ones stay in the list — shown
   * ticked and inert — because their absence is what makes a search for a tag
   * you already applied read as "that tag does not exist".
   */
  const allTags = useMemo(
    () =>
      [...assignableTags, ...assignedTags].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [assignableTags, assignedTags],
  );

  const availableCount = allTags.length;

  const results = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return allTags;
    return allTags.filter((tag) => tag.name.toLowerCase().includes(needle));
  }, [allTags, search]);

  function close() {
    setSearch("");
    setError(null);
    onOpenChange(false);
  }

  function assign(tag: AvailableTag) {
    if (busyTagId) return;
    setBusyTagId(tag.id);
    setError(null);
    startTransition(async () => {
      try {
        const result = await assignTagAction(organisationId, tag.id);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        if (result.result.failed.length > 0) {
          setError(result.result.failed[0].message);
          return;
        }
        onAssigned(tag);
        // Cleared rather than kept: the term was there to find one tag, and
        // that tag is now ticked — the next one is a fresh search.
        setSearch("");
        inputRef.current?.focus();
      } catch {
        setError("Could not reach the server. Check your connection and try again.");
      } finally {
        setBusyTagId(null);
      }
    });
  }

  return (
    <MorphingPopover
      // Slower and softer than the primitive's default: this panel travels a
      // long way (a pill at the card's edge → a 20rem sheet in the gutter), and
      // at 0.3s that read as a pop rather than a morph. A touch of bounce keeps
      // the settle from looking mechanical.
      transition={{ type: "spring", bounce: 0.20, duration: 0.75 }}
      open={open}
      onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : close())}
    >
      <MorphingPopoverTrigger className="inline-flex h-8.5 cursor-pointer items-center gap-1.5 rounded-full border border-[#d5e2fa] bg-[#f0f5ff] px-4 text-xs font-semibold tracking-[-0.02em] text-[#23407a] transition-colors hover:border-[#b8cbed] hover:bg-[#e3e9f5] focus-visible:ring-2 focus-visible:ring-lead-mid focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none">
        <motion.span layoutId={`tag-popover-label-${uniqueId}`}>Add tag</motion.span>
      </MorphingPopoverTrigger>

      <MorphingPopoverContent
        align="auto"
        // `nudge`: growing right off the trigger put almost the whole panel in
        // the gutter, hanging off the card. Starting 6rem left of it overlaps
        // the card's right edge instead, so it still reads as having come out of
        // the button — and the primitive gives that offset up before it lets the
        // panel leave the screen.
        nudge={96}
        className="rounded-panel border border-rule bg-white/55 shadow-[0_18px_40px_-24px_rgba(12,16,20,0.35)] backdrop-blur-[36px] backdrop-saturate-150"
      >
        <div className="flex w-[min(20rem,calc(100vw-2rem))] min-w-[17rem] flex-col">
          <div className="relative flex items-center gap-2 border-b border-rule px-3 py-2.5">
            <Search aria-hidden="true" className="size-3.5 shrink-0 text-faint" />
            <label className="sr-only" htmlFor={`tag-search-${organisationId}`}>
              Search tags
            </label>
            {/* Carries the trigger's layoutId so the button's label morphs into
                the search field's placeholder rather than cross-fading. */}
            <motion.span
              layoutId={`tag-popover-label-${uniqueId}`}
              aria-hidden="true"
              style={{ opacity: search ? 0 : 1 }}
              className="pointer-events-none absolute top-1/2 left-8 -translate-y-1/2 text-xs font-semibold tracking-[-0.02em] text-faint select-none"
            >
              Add tag
            </motion.span>
            <input
              ref={inputRef}
              id={`tag-search-${organisationId}`}
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full bg-transparent text-xs font-medium text-ink outline-none"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={close}
              aria-label="Close the tag picker"
              className="flex cursor-pointer items-center rounded-full p-1 text-dim transition-colors hover:bg-paper-sunk hover:text-ink focus-visible:ring-2 focus-visible:ring-lead-mid focus-visible:outline-none"
            >
              <ArrowLeftIcon aria-hidden="true" size={14} />
            </button>
          </div>

          {/* Fades in behind the box's growth rather than with it: the list is
              full-height from the first frame, so without this it reads as text
              being squashed by the panel instead of revealed by it. */}
          <motion.ul
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.22, delay: 0.14 }}
            className="max-h-72 overflow-y-auto py-1.5"
          >
            {results.length === 0 ? (
              <li className="px-3.5 py-2.5 text-xs leading-[1.6] text-dim">
                {availableCount === 0 ? "No tags exist yet." : "No tag matches that."}
              </li>
            ) : (
              results.map((tag) => {
                const swatch = isTagColour(tag.colour) ? tag.colour : null;
                const assigned = assignedTagIds.has(tag.id);
                const busy = busyTagId === tag.id;
                return (
                  <li key={tag.id}>
                    <button
                      type="button"
                      onClick={() => !assigned && assign(tag)}
                      disabled={pending || assigned}
                      aria-pressed={assigned}
                      className="flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2 text-left text-xs transition-colors hover:bg-paper focus-visible:bg-paper focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <span
                        aria-hidden="true"
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: swatch ?? "var(--faint)" }}
                      />
                      <span
                        className="min-w-0 flex-1 truncate font-medium"
                        style={swatch ? { color: swatch } : undefined}
                      >
                        {tag.name}
                      </span>
                      {(busy || assigned) && (
                        <Check
                          aria-hidden="true"
                          className={`size-3.5 shrink-0 ${busy ? "text-faint" : "text-go"}`}
                        />
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </motion.ul>

          {error && (
            <p
              aria-live="polite"
              role="alert"
              className="border-t border-rule px-3.5 py-2 text-[11px] font-semibold text-stop"
            >
              {error}
            </p>
          )}
        </div>
      </MorphingPopoverContent>
    </MorphingPopover>
  );
}
