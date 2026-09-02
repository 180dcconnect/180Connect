"use client";

import { useId, useMemo, useRef, useState, useTransition } from "react";
import { motion } from "motion/react";
import { ArrowLeft, Check, Loader2, Plus, Search, Sparkles, X } from "lucide-react";

import {
  MorphingPopover,
  MorphingPopoverTrigger,
  MorphingPopoverContent,
} from "@/components/core/morphing-popover";
import { assignTagAction } from "@/lib/tags/assign-tag-action";
import { createAndAssignTagAction } from "@/lib/tags/tag-actions";
import { isTagColour, TAG_COLOURS, tagPillStyle } from "@/lib/tags/tag-colours";

import type { AvailableTag } from "./tags-section";

/**
 * F191/F194 — assign an existing tag or create a new color-coded tag for this client,
 * styled with the 180Connect brand search bar language and rich palette badges.
 */
export function AddTagPopover({
  organisationId,
  assignableTags,
  assignedTags,
  onAssigned,
  onTagCreated,
  open,
  onOpenChange,
}: {
  organisationId: string;
  assignableTags: AvailableTag[];
  assignedTags: AvailableTag[];
  onAssigned: (tag: AvailableTag) => void;
  onTagCreated?: (tag: AvailableTag) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const uniqueId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [selectedColour, setSelectedColour] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyTagId, setBusyTagId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [pending, startTransition] = useTransition();

  const assignedTagIds = useMemo(
    () => new Set(assignedTags.map((tag) => tag.id)),
    [assignedTags],
  );

  const allTags = useMemo(
    () =>
      [...assignableTags, ...assignedTags].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [assignableTags, assignedTags],
  );

  const availableCount = allTags.length;
  const trimmedSearch = search.trim();

  const results = useMemo(() => {
    const needle = trimmedSearch.toLowerCase();
    if (!needle) return allTags;
    return allTags.filter((tag) => tag.name.toLowerCase().includes(needle));
  }, [allTags, trimmedSearch]);

  const exactMatch = useMemo(
    () =>
      trimmedSearch.length > 0 &&
      allTags.some((t) => t.name.toLowerCase() === trimmedSearch.toLowerCase()),
    [allTags, trimmedSearch],
  );

  function close() {
    setSearch("");
    setSelectedColour(null);
    setError(null);
    onOpenChange(false);
  }

  function assign(tag: AvailableTag) {
    if (busyTagId || isCreating) return;
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
        setSearch("");
        inputRef.current?.focus();
      } catch {
        setError("Could not reach the server. Check your connection and try again.");
      } finally {
        setBusyTagId(null);
      }
    });
  }

  async function handleCreateTag() {
    if (!trimmedSearch || isCreating || busyTagId) return;
    setIsCreating(true);
    setError(null);
    try {
      const result = await createAndAssignTagAction(
        organisationId,
        trimmedSearch,
        selectedColour,
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onTagCreated?.(result.tag);
      onAssigned(result.tag);
      setSearch("");
      setSelectedColour(null);
      inputRef.current?.focus();
    } catch {
      setError("Could not create tag. Please try again.");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <MorphingPopover
      transition={{ type: "spring", bounce: 0.20, duration: 0.75 }}
      open={open}
      onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : close())}
    >
      <MorphingPopoverTrigger className="inline-flex h-8.5 cursor-pointer items-center gap-1.5 rounded-full border border-[#d5e2fa] bg-[#f0f5ff] px-3.5 text-xs font-semibold tracking-[-0.02em] text-[#23407a] transition-colors hover:border-[#b8cbed] hover:bg-[#e3e9f5] focus-visible:ring-2 focus-visible:ring-lead-mid focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none">
        <Plus aria-hidden="true" className="size-3.5 shrink-0 text-[#23407a]" />
        <motion.span layoutId={`tag-popover-label-${uniqueId}`}>Add tag</motion.span>
      </MorphingPopoverTrigger>

      <MorphingPopoverContent
        align="auto"
        nudge={96}
        className="overflow-hidden rounded-2xl border border-rule/90 bg-white/95 shadow-[0_20px_45px_-20px_rgba(12,16,20,0.35)] backdrop-blur-[36px] backdrop-saturate-150"
      >
        <div className="flex w-[min(22rem,calc(100vw-2rem))] min-w-[19rem] flex-col">
          {/* Header Search Bar with Brand Language */}
          <div className="p-3 border-b border-rule/70 bg-paper/40">
            <div className="relative flex items-center gap-2 rounded-full border border-rule/80 bg-white px-3 py-2 shadow-xs transition-all focus-within:border-lead-mid focus-within:ring-2 focus-within:ring-lead-mid/20">
              <Search aria-hidden="true" className="size-4 shrink-0 text-faint" />
              <label className="sr-only" htmlFor={`tag-search-${organisationId}`}>
                Search tags
              </label>
              
              <input
                ref={inputRef}
                id={`tag-search-${organisationId}`}
                autoFocus
                value={search}
                placeholder="Search or add tags…"
                onChange={(event) => {
                  setSearch(event.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (!exactMatch && trimmedSearch.length > 0) {
                      handleCreateTag();
                    }
                  }
                }}
                className="w-full bg-transparent text-xs font-medium text-ink placeholder:text-faint/80 outline-none"
                autoComplete="off"
              />

              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="flex size-5 cursor-pointer items-center justify-center rounded-full text-dim hover:bg-paper-sunk hover:text-ink"
                >
                  <X size={12} />
                </button>
              )}

              <button
                type="button"
                onClick={close}
                aria-label="Close the tag picker"
                className="flex size-6 cursor-pointer items-center justify-center rounded-full text-dim transition-colors hover:bg-paper-sunk hover:text-ink focus-visible:ring-2 focus-visible:ring-lead-mid focus-visible:outline-none"
              >
                <ArrowLeft aria-hidden="true" size={13} />
              </button>
            </div>
          </div>

          {/* Tag List Section */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.22, delay: 0.14 }}
            className="max-h-72 overflow-y-auto p-2"
          >
            {results.length === 0 && exactMatch ? null : (
              <ul className="space-y-1">
                {results.map((tag) => {
                  const swatch = isTagColour(tag.colour) ? tag.colour : null;
                  const pillStyle = tagPillStyle(tag.colour);
                  const assigned = assignedTagIds.has(tag.id);
                  const busy = busyTagId === tag.id;

                  return (
                    <li key={tag.id}>
                      <button
                        type="button"
                        onClick={() => !assigned && assign(tag)}
                        disabled={pending || assigned || isCreating}
                        aria-pressed={assigned}
                        className={`group flex w-full cursor-pointer items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-xs transition-all ${
                          assigned
                            ? "bg-paper/60 opacity-80 cursor-default"
                            : "hover:bg-paper-sunk/80 active:scale-[0.99]"
                        }`}
                      >
                        {/* Colored Tag Pill / Badge */}
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            style={pillStyle ?? undefined}
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tracking-[-0.01em] transition-transform ${
                              pillStyle
                                ? "border border-black/5"
                                : "bg-brand/12 text-brand-hover border border-brand/20"
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className="size-2 shrink-0 rounded-full shadow-xs"
                              style={{ backgroundColor: swatch ?? "var(--brand)" }}
                            />
                            <span className="truncate">{tag.name}</span>
                          </span>
                        </div>

                        {/* Status Icon */}
                        <div className="flex items-center gap-1.5 pl-2">
                          {busy && (
                            <Loader2 className="size-3.5 animate-spin text-faint" />
                          )}
                          {assigned && !busy && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-go">
                              <Check aria-hidden="true" className="size-3.5 stroke-[2.5]" />
                              <span>Added</span>
                            </span>
                          )}
                          {!assigned && !busy && (
                            <span className="opacity-0 group-hover:opacity-100 text-[11px] font-medium text-lead-mid transition-opacity">
                              + Add
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Create Tag Option when no exact match exists */}
            {trimmedSearch.length > 0 && !exactMatch && (
              <div className="mt-2 rounded-xl border border-rule/80 bg-paper/50 p-3">
                <div className="flex items-center justify-between gap-2 pb-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Sparkles className="size-3.5 text-lead-mid shrink-0" />
                    <span className="text-xs font-semibold text-ink truncate">
                      Create &ldquo;{trimmedSearch}&rdquo;
                    </span>
                  </div>

                  {/* Live Tag Preview */}
                  <span
                    style={
                      selectedColour
                        ? tagPillStyle(selectedColour) ?? undefined
                        : undefined
                    }
                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      selectedColour
                        ? "border border-black/5"
                        : "bg-brand/12 text-brand-hover border border-brand/20"
                    }`}
                  >
                    <span
                      className="size-1.5 rounded-full"
                      style={{ backgroundColor: selectedColour ?? "var(--brand)" }}
                    />
                    <span className="truncate">{trimmedSearch}</span>
                  </span>
                </div>

                {/* Color Palette Swatches */}
                <div className="mt-2">
                  <span className="block text-[10.5px] font-semibold uppercase tracking-wider text-faint mb-1.5">
                    Choose Tag Color
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* Default (No Colour) */}
                    <button
                      type="button"
                      onClick={() => setSelectedColour(null)}
                      title="Default brand color"
                      className={`relative flex size-6 cursor-pointer items-center justify-center rounded-full border border-rule bg-white transition-transform hover:scale-110 ${
                        selectedColour === null ? "ring-2 ring-lead-mid ring-offset-1" : ""
                      }`}
                    >
                      <span className="size-2.5 rounded-full bg-brand" />
                    </button>

                    {/* Palette Swatches */}
                    {TAG_COLOURS.map((c) => {
                      const isSelected = selectedColour === c.hex;
                      return (
                        <button
                          key={c.hex}
                          type="button"
                          onClick={() => setSelectedColour(c.hex)}
                          title={c.name}
                          style={{ backgroundColor: c.hex }}
                          className={`relative flex size-6 cursor-pointer items-center justify-center rounded-full shadow-xs transition-transform hover:scale-110 ${
                            isSelected ? "ring-2 ring-lead-mid ring-offset-1" : ""
                          }`}
                        >
                          {isSelected && (
                            <Check className="size-3 stroke-[3] text-white" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Create & Assign Button */}
                <button
                  type="button"
                  onClick={handleCreateTag}
                  disabled={isCreating || pending}
                  className="mt-3 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-lead px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-lead-dark disabled:opacity-50"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      <span>Creating…</span>
                    </>
                  ) : (
                    <>
                      <Plus className="size-3.5 stroke-[2.5]" />
                      <span>Create & Add Tag</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {results.length === 0 && trimmedSearch.length === 0 && (
              <div className="px-3.5 py-4 text-center text-xs text-faint">
                {availableCount === 0 ? "No tags created yet. Type above to create one." : "No tags available."}
              </div>
            )}
          </motion.div>

          {/* Error Message */}
          {error && (
            <p
              aria-live="polite"
              role="alert"
              className="border-t border-rule bg-red-50/50 px-3.5 py-2 text-[11px] font-semibold text-stop"
            >
              {error}
            </p>
          )}
        </div>
      </MorphingPopoverContent>
    </MorphingPopover>
  );
}
