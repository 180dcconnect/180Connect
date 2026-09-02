"use client";

import { useId, useMemo, useRef, useState, useTransition } from "react";
import { motion } from "motion/react";
import { ArrowLeft, Check, ChevronDown, Loader2, Plus, Search, Sparkles, X } from "lucide-react";

import {
  MorphingPopover,
  MorphingPopoverTrigger,
  MorphingPopoverContent,
} from "@/components/core/morphing-popover";
import { assignTagsBatchAction, createTagAction } from "@/lib/tags/tag-actions";
import { isTagColour, TAG_COLOURS, tagPillStyle } from "@/lib/tags/tag-colours";

import type { AvailableTag } from "./tags-section";

/**
 * Multi-tag selector with tokenized chip input, bottom create-tag workflow,
 * full color swatches, and a dedicated batch Save button.
 */
export function AddTagPopover({
  organisationId,
  assignableTags,
  assignedTags,
  onBatchAssigned,
  onTagCreated,
  open,
  onOpenChange,
}: {
  organisationId: string;
  assignableTags: AvailableTag[];
  assignedTags: AvailableTag[];
  onBatchAssigned?: (tags: AvailableTag[]) => void;
  onTagCreated?: (tag: AvailableTag) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const uniqueId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [selectedTags, setSelectedTags] = useState<AvailableTag[]>([]);
  const [showCreateDrawer, setShowCreateDrawer] = useState(false);
  const [newTagColour, setNewTagColour] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [pending, startTransition] = useTransition();

  const assignedTagIds = useMemo(
    () => new Set(assignedTags.map((tag) => tag.id)),
    [assignedTags],
  );

  const selectedTagIds = useMemo(
    () => new Set(selectedTags.map((tag) => tag.id)),
    [selectedTags],
  );

  const allTags = useMemo(
    () =>
      [...assignableTags, ...assignedTags].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [assignableTags, assignedTags],
  );

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
    setSelectedTags([]);
    setShowCreateDrawer(false);
    setNewTagColour(null);
    setError(null);
    onOpenChange(false);
  }

  function toggleTag(tag: AvailableTag) {
    if (assignedTagIds.has(tag.id)) return; // Already on client
    setError(null);
    if (selectedTagIds.has(tag.id)) {
      setSelectedTags((prev) => prev.filter((t) => t.id !== tag.id));
    } else {
      setSelectedTags((prev) => [...prev, tag]);
    }
    setSearch("");
    inputRef.current?.focus();
  }

  function removeSelected(tagId: string) {
    setSelectedTags((prev) => prev.filter((t) => t.id !== tagId));
    inputRef.current?.focus();
  }

  async function handleCreateTag() {
    if (!trimmedSearch || isCreating) return;
    setIsCreating(true);
    setError(null);
    try {
      const result = await createTagAction(trimmedSearch, newTagColour);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onTagCreated?.(result.tag);
      // Immediately add the newly created tag to selected tokens in the input field!
      setSelectedTags((prev) =>
        prev.some((t) => t.id === result.tag.id) ? prev : [...prev, result.tag],
      );
      setSearch("");
      setShowCreateDrawer(false);
      setNewTagColour(null);
      inputRef.current?.focus();
    } catch {
      setError("Could not create tag. Please try again.");
    } finally {
      setIsCreating(false);
    }
  }

  function handleSave() {
    if (selectedTags.length === 0 || isSaving) return;
    setIsSaving(true);
    setError(null);
    startTransition(async () => {
      try {
        const tagIds = selectedTags.map((t) => t.id);
        const result = await assignTagsBatchAction(organisationId, tagIds);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        onBatchAssigned?.(selectedTags);
        close();
      } catch {
        setError("Could not save tags. Please check connection and try again.");
      } finally {
        setIsSaving(false);
      }
    });
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
        <div className="flex w-[min(23rem,calc(100vw-2rem))] min-w-[20rem] flex-col">
          {/* Header Input with Tokenized Chips on the Left */}
          <div className="p-3 border-b border-rule/70 bg-paper/40">
            <div className="relative flex flex-wrap items-center gap-1.5 min-h-[40px] rounded-xl border border-rule/80 bg-white px-2.5 py-1.5 shadow-xs transition-all focus-within:border-lead-mid focus-within:ring-2 focus-within:ring-lead-mid/20">
              <Search aria-hidden="true" className="size-3.5 shrink-0 text-faint mr-0.5" />
              
              {/* Selected Tag Tokens inside Input */}
              {selectedTags.map((tag) => {
                const swatch = isTagColour(tag.colour) ? tag.colour : null;
                const pillStyle = tagPillStyle(tag.colour);
                return (
                  <span
                    key={tag.id}
                    style={pillStyle ?? undefined}
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-[-0.01em] animate-in fade-in zoom-in-95 ${
                      pillStyle
                        ? "border border-black/5"
                        : "bg-brand/12 text-brand-hover border border-brand/20"
                    }`}
                  >
                    <span
                      className="size-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: swatch ?? "var(--brand)" }}
                    />
                    <span className="max-w-[110px] truncate">{tag.name}</span>
                    <button
                      type="button"
                      onClick={() => removeSelected(tag.id)}
                      aria-label={`Remove ${tag.name}`}
                      className="size-3.5 flex cursor-pointer items-center justify-center rounded-full hover:bg-black/10 transition-colors"
                    >
                      <X className="size-2.5 stroke-[2.5]" />
                    </button>
                  </span>
                );
              })}

              {/* Text Input to the Right of Selected Chips */}
              <input
                ref={inputRef}
                id={`tag-search-${organisationId}`}
                autoFocus
                value={search}
                placeholder={selectedTags.length === 0 ? "Search tags…" : "Add more…"}
                onChange={(event) => {
                  setSearch(event.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && search === "" && selectedTags.length > 0) {
                    removeSelected(selectedTags[selectedTags.length - 1].id);
                  }
                  if (e.key === "Enter" && !exactMatch && trimmedSearch.length > 0) {
                    e.preventDefault();
                    if (!showCreateDrawer) {
                      setShowCreateDrawer(true);
                    } else {
                      handleCreateTag();
                    }
                  }
                }}
                className="min-w-[80px] flex-1 bg-transparent text-xs font-medium text-ink placeholder:text-faint/80 outline-none"
                autoComplete="off"
              />

              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="flex size-4.5 cursor-pointer items-center justify-center rounded-full text-dim hover:bg-paper-sunk hover:text-ink"
                >
                  <X size={11} />
                </button>
              )}

              <button
                type="button"
                onClick={close}
                aria-label="Close tag picker"
                className="flex size-5.5 cursor-pointer items-center justify-center rounded-full text-dim transition-colors hover:bg-paper-sunk hover:text-ink"
              >
                <ArrowLeft aria-hidden="true" size={13} />
              </button>
            </div>
          </div>

          {/* Tag List Section */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.22, delay: 0.1 }}
            className="max-h-64 overflow-y-auto p-2"
          >
            <ul className="space-y-1">
              {results.map((tag) => {
                const swatch = isTagColour(tag.colour) ? tag.colour : null;
                const pillStyle = tagPillStyle(tag.colour);
                const isAssigned = assignedTagIds.has(tag.id);
                const isSelected = selectedTagIds.has(tag.id);

                return (
                  <li key={tag.id}>
                    <button
                      type="button"
                      onClick={() => toggleTag(tag)}
                      disabled={isAssigned || isSaving}
                      aria-pressed={isSelected || isAssigned}
                      className={`group flex w-full cursor-pointer items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-xs transition-all ${
                        isAssigned
                          ? "bg-paper/40 opacity-70 cursor-default"
                          : isSelected
                          ? "bg-lead/5 border border-lead-mid/20"
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

                      {/* Selection State Checkmark */}
                      <div className="flex items-center gap-1.5 pl-2">
                        {isAssigned && (
                          <span className="text-[11px] font-medium text-faint">
                            Added
                          </span>
                        )}
                        {!isAssigned && isSelected && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-lead">
                            <Check aria-hidden="true" className="size-3.5 stroke-[2.5]" />
                            <span>Selected</span>
                          </span>
                        )}
                        {!isAssigned && !isSelected && (
                          <span className="opacity-0 group-hover:opacity-100 text-[11px] font-medium text-lead-mid transition-opacity">
                            Select
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Bottom Create Tag Button when search term does not match exactly */}
            {trimmedSearch.length > 0 && !exactMatch && (
              <div className="mt-2 border-t border-rule/60 pt-2">
                {!showCreateDrawer ? (
                  <button
                    type="button"
                    onClick={() => setShowCreateDrawer(true)}
                    className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-dashed border-rule px-3 py-2 text-xs font-medium text-lead transition-colors hover:border-lead-mid/50 hover:bg-lead/5"
                  >
                    <div className="flex items-center gap-2">
                      <Plus className="size-3.5" />
                      <span>Create tag <strong>&ldquo;{trimmedSearch}&rdquo;</strong></span>
                    </div>
                    <ChevronDown className="size-3.5 text-faint" />
                  </button>
                ) : (
                  <div className="rounded-xl border border-lead-mid/30 bg-paper/70 p-3 animate-in fade-in slide-in-from-top-2">
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
                          newTagColour
                            ? tagPillStyle(newTagColour) ?? undefined
                            : undefined
                        }
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          newTagColour
                            ? "border border-black/5"
                            : "bg-brand/12 text-brand-hover border border-brand/20"
                        }`}
                      >
                        <span
                          className="size-1.5 rounded-full"
                          style={{ backgroundColor: newTagColour ?? "var(--brand)" }}
                        />
                        <span className="truncate">{trimmedSearch}</span>
                      </span>
                    </div>

                    {/* Color Palette Swatches */}
                    <div className="mt-2">
                      <span className="block text-[10.5px] font-semibold uppercase tracking-wider text-faint mb-1.5">
                        Choose Color
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {/* Default (No Colour) */}
                        <button
                          type="button"
                          onClick={() => setNewTagColour(null)}
                          title="Default brand color"
                          className={`relative flex size-6 cursor-pointer items-center justify-center rounded-full border border-rule bg-white transition-transform hover:scale-110 ${
                            newTagColour === null ? "ring-2 ring-lead-mid ring-offset-1" : ""
                          }`}
                        >
                          <span className="size-2.5 rounded-full bg-brand" />
                        </button>

                        {/* Palette Swatches */}
                        {TAG_COLOURS.map((c) => {
                          const isSelected = newTagColour === c.hex;
                          return (
                            <button
                              key={c.hex}
                              type="button"
                              onClick={() => setNewTagColour(c.hex)}
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

                    {/* Create & Select Action */}
                    <div className="mt-3 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowCreateDrawer(false)}
                        className="px-2.5 py-1 text-xs text-dim hover:text-ink"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleCreateTag}
                        disabled={isCreating}
                        className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-lead px-3 py-1 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-lead-dark disabled:opacity-50"
                      >
                        {isCreating ? (
                          <>
                            <Loader2 className="size-3 animate-spin" />
                            <span>Creating…</span>
                          </>
                        ) : (
                          <>
                            <Plus className="size-3 stroke-[2.5]" />
                            <span>Add to selection</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </motion.div>

          {/* Footer Action Bar with Save Button */}
          <div className="flex items-center justify-between border-t border-rule bg-paper/50 px-3.5 py-2.5">
            <span className="text-xs text-dim">
              {selectedTags.length > 0
                ? `${selectedTags.length} ${selectedTags.length === 1 ? "tag" : "tags"} selected`
                : "Select tags to assign"}
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={close}
                disabled={isSaving || pending}
                className="cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium text-dim hover:bg-paper-sunk hover:text-ink disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleSave}
                disabled={selectedTags.length === 0 || isSaving || pending}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-lead px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-lead-dark disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSaving || pending ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>Saving…</span>
                  </>
                ) : (
                  <>
                    <span>Save</span>
                  </>
                )}
              </button>
            </div>
          </div>

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
