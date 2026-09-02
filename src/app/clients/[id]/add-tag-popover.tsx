"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Plus, Search } from "lucide-react";

import {
  MorphingPopover,
  MorphingPopoverTrigger,
  MorphingPopoverContent,
} from "@/components/core/morphing-popover";
import { OriginButton } from "@/components/ui/origin-button";
import { assignTagsBatchAction, createTagAction } from "@/lib/tags/tag-actions";
import { isTagColour, TAG_COLOURS } from "@/lib/tags/tag-colours";

import type { AvailableTag } from "./tags-section";

/**
 * F191/F192 — the tag picker, rebuilt (Sept 2026).
 *
 * The behaviour was right and the surface was not, so only the surface changed:
 * search, multi-select, create-with-a-colour, one batched save.
 *
 * What the old one did wrong, in the order it cost the most:
 *
 * - **Boxes inside boxes.** A bordered, shadowed input sat inside a tinted
 *   header band inside a bordered, blurred, `rounded-2xl` panel — three edges
 *   before any content. The search line is now flush against the panel: an icon,
 *   a caret, and one hairline under it.
 * - **Pills inside a list of pills.** Every row rendered the tag as a tinted
 *   capsule, so a list of eight tags was eight capsules with eight borders and
 *   no shared left edge to read down. A row is a dot, a name, and its state —
 *   the colour still reads, the column scans.
 * - **Selection said twice.** Chosen tags appeared as tokens in the input *and*
 *   as "Selected" on their row, which meant a tag could scroll out of view in
 *   one place while sitting in the other. The row is the only place now, and
 *   the footer counts.
 * - **Four ways out.** Back arrow, clear-search ×, Cancel, and click-outside.
 *   Escape and click-outside already close this (morphing-popover binds both)
 *   and the morph plays in reverse when they do, so the chrome is gone.
 * - **Off-language chrome.** Glass blur, `rounded-2xl`, a Sparkles glyph, an
 *   uppercase "CHOOSE COLOR" label, and a `hover:bg-lead-dark` that names a
 *   token which does not exist (so the primary button had no hover at all). It
 *   is the filed-record language now: `--rule` hairlines, `radius-panel`, ink
 *   buttons, `--lead` for state only.
 *
 * One thing was added rather than restyled: ↑/↓ move through the list and Enter
 * takes the highlighted row, because a search field you cannot leave without
 * the mouse is not a picker.
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
  const listRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [selectedTags, setSelectedTags] = useState<AvailableTag[]>([]);
  const [creating, setCreating] = useState(false);
  const [newTagColour, setNewTagColour] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [activeRaw, setActive] = useState(0);
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

  /** The create row is the last stop in the same ring as the tag rows. */
  const canCreate = trimmedSearch.length > 0 && !exactMatch;
  const optionCount = results.length + (canCreate ? 1 : 0);
  const createIndex = canCreate ? results.length : -1;
  // The list re-filters under the cursor as you type, and every site that
  // changes `search` puts the highlight back on the first row — but a tag
  // removed by a Realtime update elsewhere can still shorten the list under a
  // held index, so the render clamps rather than trusting the state.
  const active = Math.min(activeRaw, Math.max(optionCount - 1, 0));

  // Keeps a keyboard-moved highlight inside the scroll box. `nearest` so paging
  // down does not re-centre the whole list on every step.
  useEffect(() => {
    const node = listRef.current?.querySelector('[data-active="true"]');
    node?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function close() {
    setSearch("");
    setSelectedTags([]);
    setCreating(false);
    setNewTagColour(null);
    setError(null);
    setActive(0);
    onOpenChange(false);
  }

  function toggleTag(tag: AvailableTag) {
    if (assignedTagIds.has(tag.id)) return; // Already on this client.
    setError(null);
    setSelectedTags((prev) =>
      prev.some((t) => t.id === tag.id)
        ? prev.filter((t) => t.id !== tag.id)
        : [...prev, tag],
    );
    setSearch("");
    setActive(0);
    inputRef.current?.focus();
  }

  function openCreate() {
    setCreating(true);
    setActive(createIndex >= 0 ? createIndex : 0);
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
      // A tag created here is a tag you meant to apply — it joins the selection
      // rather than making you find it again in the list you just left.
      setSelectedTags((prev) =>
        prev.some((t) => t.id === result.tag.id) ? prev : [...prev, result.tag],
      );
      setSearch("");
      setActive(0);
      setCreating(false);
      setNewTagColour(null);
      inputRef.current?.focus();
    } catch {
      setError("Could not create tag. Check your connection and try again.");
    } finally {
      setIsCreating(false);
    }
  }

  function handleSave() {
    if (selectedTags.length === 0 || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await assignTagsBatchAction(
          organisationId,
          selectedTags.map((t) => t.id),
        );
        if (!result.ok) {
          setError(result.message);
          return;
        }
        onBatchAssigned?.(selectedTags);
        close();
      } catch {
        setError("Could not save tags. Check your connection and try again.");
      }
    });
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (optionCount === 0) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + optionCount) % optionCount);
      return;
    }
    if (event.key === "Enter") {
      if (optionCount === 0) return;
      event.preventDefault();
      if (active === createIndex) {
        // First Enter opens the colour choice, second commits — the colour is
        // the only decision creating a tag involves, and skipping past it
        // silently is how every tag ends up default-coloured.
        if (creating) handleCreateTag();
        else openCreate();
        return;
      }
      const tag = results[active];
      if (tag) toggleTag(tag);
      return;
    }
    if (event.key === "Backspace" && search === "" && selectedTags.length > 0) {
      setSelectedTags((prev) => prev.slice(0, -1));
    }
  }

  const selectedCount = selectedTags.length;

  return (
    <MorphingPopover
      transition={{ type: "spring", bounce: 0.2, duration: 0.75 }}
      open={open}
      onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : close())}
    >
      <MorphingPopoverTrigger className="inline-flex h-8.5 cursor-pointer items-center gap-1.5 rounded-full border border-lead/15 bg-lead-wash px-3.5 text-xs font-semibold tracking-[-0.02em] text-lead transition-colors hover:border-lead/30 hover:bg-lead-wash/70 focus-visible:ring-2 focus-visible:ring-lead-mid focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none">
        <Plus aria-hidden="true" className="size-3.5 shrink-0" />
        <motion.span layoutId={`tag-popover-label-${uniqueId}`}>
          Add tag
        </motion.span>
      </MorphingPopoverTrigger>

      <MorphingPopoverContent
        align="end"
        className="rounded-panel border border-rule bg-white shadow-[0_18px_40px_-18px_rgba(20,26,34,0.32)]"
      >
        <div className="flex w-[min(21rem,calc(100vw-2rem))] flex-col">
          {/* The search line is the panel's top edge — no band, no inner box.
              A field inside a popover the user just opened on purpose does not
              need a border to say it is a field. */}
          <div className="flex items-center gap-2.5 px-3.5 py-3">
            <Search aria-hidden="true" className="size-4 shrink-0 text-faint" />
            <input
              ref={inputRef}
              id={`tag-search-${organisationId}`}
              autoFocus
              value={search}
              placeholder="Search or create a tag"
              onChange={(event) => {
                setSearch(event.target.value);
                // Typing re-orders the list, so the highlight goes back to the
                // top rather than staying on whatever row inherited the index.
                setActive(0);
                setCreating(false);
                if (error) setError(null);
              }}
              onKeyDown={onInputKeyDown}
              autoComplete="off"
              aria-label="Search tags"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
            />
            {selectedCount > 0 && (
              <span className="shrink-0 text-[11px] font-semibold text-lead tabular-nums">
                {selectedCount}
              </span>
            )}
          </div>

          <div
            ref={listRef}
            className="max-h-[15.5rem] overflow-y-auto border-t border-rule-soft py-1"
          >
            {results.map((tag, index) => {
              const swatch = isTagColour(tag.colour) ? tag.colour : null;
              const isAssigned = assignedTagIds.has(tag.id);
              const isSelected = selectedTagIds.has(tag.id);
              const isActive = index === active;

              return (
                <button
                  key={tag.id}
                  type="button"
                  data-active={isActive}
                  onClick={() => toggleTag(tag)}
                  onMouseMove={() => setActive(index)}
                  disabled={isAssigned}
                  aria-pressed={isSelected || isAssigned}
                  /* One hairline-free row shape for all three states, so the
                     list keeps a single left edge to read down: the dot, then
                     the name, then whatever the row has to say on the right. */
                  className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] transition-colors ${
                    isAssigned
                      ? "cursor-default text-faint"
                      : isActive
                        ? "cursor-pointer bg-paper text-ink"
                        : "cursor-pointer text-ink"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`size-2 shrink-0 rounded-full ${
                      isAssigned ? "opacity-45" : ""
                    }`}
                    style={{ backgroundColor: swatch ?? "var(--brand)" }}
                  />
                  <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                  {isAssigned ? (
                    <span className="shrink-0 text-[11px] text-faint">
                      On record
                    </span>
                  ) : isSelected ? (
                    <Check
                      aria-hidden="true"
                      className="size-4 shrink-0 stroke-[2.5] text-lead"
                    />
                  ) : null}
                </button>
              );
            })}

            {results.length === 0 && !canCreate && (
              <p className="px-3.5 py-6 text-center text-[12px] text-faint">
                {allTags.length === 0
                  ? "No tags exist yet. Type a name to create the first one."
                  : "No tags match."}
              </p>
            )}

            {canCreate && (
              <div
                className={
                  results.length > 0
                    ? "mt-1 border-t border-rule-soft pt-1"
                    : ""
                }
              >
                <button
                  type="button"
                  data-active={active === createIndex}
                  onClick={openCreate}
                  onMouseMove={() => setActive(createIndex)}
                  aria-expanded={creating}
                  className={`flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2 text-left text-[13px] transition-colors ${
                    active === createIndex ? "bg-paper" : ""
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: newTagColour ?? "var(--brand)" }}
                  />
                  <span className="min-w-0 flex-1 truncate text-dim">
                    Create{" "}
                    <span className="font-semibold text-ink">
                      {trimmedSearch}
                    </span>
                  </span>
                  {!creating && (
                    <Plus
                      aria-hidden="true"
                      className="size-3.5 shrink-0 text-faint"
                    />
                  )}
                </button>

                {/* The colour is the whole of "create a tag", so it opens in
                    place under the row instead of in a bordered drawer with its
                    own title, its own preview chip and its own Cancel. The dot
                    on the row above is the preview. */}
                <AnimatePresence initial={false}>
                  {creating && (
                    <motion.div
                      key="create"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="flex items-center gap-2 px-3.5 pt-1 pb-2.5">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                          <ColourSwatch
                            colour={null}
                            name="Default"
                            selected={newTagColour === null}
                            onSelect={() => setNewTagColour(null)}
                          />
                          {TAG_COLOURS.map((colour) => (
                            <ColourSwatch
                              key={colour.hex}
                              colour={colour.hex}
                              name={colour.name}
                              selected={newTagColour === colour.hex}
                              onSelect={() => setNewTagColour(colour.hex)}
                            />
                          ))}
                        </div>
                        <OriginButton
                          size="xs"
                          variant="ink"
                          loading={isCreating}
                          onClick={handleCreateTag}
                        >
                          {isCreating ? "Creating…" : "Create"}
                        </OriginButton>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>

          {error && (
            <p
              aria-live="polite"
              role="alert"
              className="border-t border-rule bg-stop-wash/60 px-3.5 py-2 text-[12px] font-semibold text-stop"
            >
              {error}
            </p>
          )}

          {/* The footer is the selection, so it exists only when there is one.
              An always-present bar reading "Select tags to assign" next to a
              disabled Save is two controls telling you that you have not done
              anything yet. Escape and click-outside cancel. */}
          <AnimatePresence initial={false}>
            {selectedCount > 0 && (
              <motion.div
                key="footer"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
                className="overflow-hidden border-t border-rule bg-paper/60"
              >
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTags([]);
                      inputRef.current?.focus();
                    }}
                    className="cursor-pointer text-[12px] text-dim transition-colors hover:text-ink"
                  >
                    Clear
                  </button>
                  <OriginButton
                    size="sm"
                    variant="ink"
                    loading={pending}
                    onClick={handleSave}
                  >
                    {pending
                      ? "Saving…"
                      : `Add ${selectedCount} ${selectedCount === 1 ? "tag" : "tags"}`}
                  </OriginButton>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </MorphingPopoverContent>
    </MorphingPopover>
  );
}

/**
 * One palette entry. The swatch is the colour itself at full strength — a ring
 * marks the choice rather than a tick inside a 24px circle, which at this size
 * was a white smudge on the darker half of the palette.
 */
function ColourSwatch({
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
      aria-label={`${name} tag colour`}
      aria-pressed={selected}
      title={name}
      style={{ backgroundColor: colour ?? "var(--brand)" }}
      className={`size-4.5 cursor-pointer rounded-full transition-transform hover:scale-110 focus-visible:outline-none ${
        selected
          ? "ring-2 ring-ink/70 ring-offset-2 ring-offset-white"
          : "ring-1 ring-black/10"
      }`}
    />
  );
}
