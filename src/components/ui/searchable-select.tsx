"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

/**
 * A one-choice picker with a search box inside it.
 *
 * ── Why not the native `<select>` ──
 *
 * A native select cannot be searched past its first letter, and it cannot show
 * a category above its options without `<optgroup>`'s fixed styling. The sector
 * list is 22 options under 6 headings — long enough that scrolling it is a
 * chore and short enough that typing three letters should end the job. This is
 * the listbox pattern from WAI-ARIA (a combobox that opens a listbox), built
 * here rather than pulled in: the project already carries a Radix select for
 * plain choices, and nothing in it searches.
 *
 * ── What it guarantees ──
 *
 *   * Keyboard first: ↑/↓ move, Enter picks, Escape closes and hands focus
 *     back to the trigger, Tab leaves. The active option is announced through
 *     `aria-activedescendant`, so the search field keeps focus while the
 *     listbox moves under it.
 *   * A value outside the option list still shows. Records hold values from
 *     before a list existed; the trigger reads what is actually on the record,
 *     and `unlistedLabel` says so without hiding it.
 *   * Choosing is the only thing it does. No free text, so a wrong answer is
 *     impossible rather than rejected — the rule the admin screens are held to
 *     (AGENTS.md, "Prefer a choice over free text").
 */

export type SearchableOption = {
  value: string;
  label: string;
  /** Extra words this option should be findable by, never rendered. */
  keywords?: readonly string[];
};

export type SearchableOptionGroup = {
  label: string;
  options: readonly SearchableOption[];
};

export function SearchableSelect({
  id,
  value,
  onChange,
  groups,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyMessage = "Nothing matches that.",
  unlistedLabel,
  allowCustom = false,
  customGroupLabel = "Not in the list",
  extraGroups,
  onQueryChange,
  searchHint,
  disabled = false,
  ariaLabel,
  className = "",
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  groups: readonly SearchableOptionGroup[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  /** Suffix for a value that is not in `groups` — e.g. "not in the standard list". */
  unlistedLabel?: string;
  /**
   * Offers what the searcher typed as a last row when nothing matches it.
   *
   * Off by default, because a closed list is what makes a wrong answer
   * impossible. Turn it on only where the list is genuinely a *good* list
   * rather than a complete one — the local-authority places are 174 councils
   * and a client can sit in a town that is not one of them.
   */
  allowCustom?: boolean;
  customGroupLabel?: string;
  /**
   * Options worked out from the search text itself, offered above the list.
   *
   * The picker does not know where they come from — the place picker fills
   * this by asking what council a typed postcode is in. They are not filtered
   * again here: whoever produced them already answered the query.
   */
  extraGroups?: readonly SearchableOptionGroup[];
  /** Told what is being searched for, so a consumer can go and find more. */
  onQueryChange?: (query: string) => void;
  /** A line under the search box — what else can be typed, or what is loading. */
  searchHint?: React.ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // The highlight is held as a VALUE, not an index: the list moves under it as
  // the query narrows, and an index would point at a different option — or off
  // the end — the moment a letter is typed. Deriving the index each render is
  // also what keeps this free of the setState-in-effect the React Compiler
  // rules out.
  const [activeValue, setActiveValue] = useState<string | null>(null);

  // Whether a close should hand focus back to the trigger (Escape, or picking
  // an option) rather than leave it where the pointer left it. State, not a
  // ref, and acted on in the effect below: a `close` that touches a ref at all
  // is a function the refs lint will not let us hand to an onClick.
  const [focusTriggerOnClose, setFocusTriggerOnClose] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const reactId = useId();
  const listboxId = `${id}-listbox`;
  const optionId = (index: number) => `${id}-option-${index}-${reactId}`;

  const allOptions = useMemo(
    () => groups.flatMap((group) => group.options),
    [groups],
  );

  const selected = allOptions.find((option) => option.value === value) ?? null;
  const hasUnlistedValue = Boolean(value) && !selected;

  // Matching is on the visible label plus any keywords, so "homeless" finds
  // "Housing & Homelessness" and a category name finds everything under it.
  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((group) => ({
        label: group.label,
        options: group.options.filter((option) => {
          if (group.label.toLowerCase().includes(needle)) return true;
          if (option.label.toLowerCase().includes(needle)) return true;
          return (option.keywords ?? []).some((word) => word.toLowerCase().includes(needle));
        }),
      }))
      .filter((group) => group.options.length > 0);
  }, [groups, query]);

  /**
   * What the searcher typed, offered as its own row when the list has nothing
   * like it. Rendered as an option rather than a separate button so the arrow
   * keys and Enter reach it the same way they reach everything else.
   */
  const customOption = useMemo(() => {
    if (!allowCustom) return null;
    const typed = query.trim();
    if (!typed) return null;
    const alreadyListed = allOptions.some(
      (option) => option.label.toLowerCase() === typed.toLowerCase(),
    );
    return alreadyListed ? null : { value: typed, label: `Use “${typed}”` };
  }, [allowCustom, allOptions, query]);

  /** Groups as rendered: what the query found elsewhere, the list, then the typed row. */
  const renderedGroups = useMemo(() => {
    const groupsToRender = [...(extraGroups ?? []), ...filteredGroups];
    return customOption
      ? [...groupsToRender, { label: customGroupLabel, options: [customOption] }]
      : groupsToRender;
  }, [extraGroups, filteredGroups, customOption, customGroupLabel]);

  /** The filtered options in render order — what the arrow keys walk. */
  const visibleOptions = useMemo(
    () => renderedGroups.flatMap((group) => group.options),
    [renderedGroups],
  );

  // Where the highlight actually is, now that the list has been filtered. A
  // highlight whose option has just been typed out of view falls back to the
  // first match, which is what a search box should do.
  const activeIndex = Math.max(
    visibleOptions.findIndex((option) => option.value === activeValue),
    0,
  );

  // Focus follows the list: into the search box on opening, back to the trigger
  // on a close that asked for it. No state is set here — see activeValue above.
  useEffect(() => {
    if (open) {
      searchRef.current?.focus();
      return;
    }
    if (focusTriggerOnClose) triggerRef.current?.focus();
  }, [open, focusTriggerOnClose]);

  // Keep the highlighted row in view when the arrows walk past the fold.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    node?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  // A click anywhere else closes it. Pointerdown, not click, so the close beats
  // whatever the pointer landed on.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  /** Opening lands the highlight on the current value, never on whatever is first. */
  const openList = () => {
    setActiveValue(value || allOptions[0]?.value || null);
    setQuery("");
    onQueryChange?.("");
    setOpen(true);
  };

  // useCallback, not a plain function: the click handlers below hand this to
  // React, and the refs lint reads a bare closure over `triggerRef` as a ref
  // touched during render.
  const close = useCallback(
    (returnFocus: boolean) => {
      setFocusTriggerOnClose(returnFocus);
      setOpen(false);
      setQuery("");
      onQueryChange?.("");
    },
    [onQueryChange],
  );

  /** Moves the highlight by walking the filtered list from where it sits now. */
  const moveActive = (nextIndex: number) => {
    if (visibleOptions.length === 0) return;
    const wrapped = (nextIndex + visibleOptions.length) % visibleOptions.length;
    setActiveValue(visibleOptions[wrapped]!.value);
  };

  const choose = useCallback(
    (option: SearchableOption) => {
      onChange(option.value);
      close(true);
    },
    [onChange, close],
  );

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(activeIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveActive(visibleOptions.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = visibleOptions[activeIndex];
      if (option) choose(option);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  const triggerLabel = selected
    ? selected.label
    : hasUnlistedValue
      ? unlistedLabel
        ? `${value} (${unlistedLabel})`
        : value
      : placeholder;

  // Walked alongside the render so each option knows its own place in the
  // flattened order the arrow keys use.
  let flatIndex = -1;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openList();
          }
        }}
        className="flex h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-inset border border-rule bg-white px-3 text-left text-sm outline-none focus-visible:border-lead focus-visible:ring-2 focus-visible:ring-lead/20 disabled:pointer-events-none disabled:opacity-50"
      >
        <span className={`truncate ${value ? "text-ink" : "text-faint"}`}>{triggerLabel}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-dim" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-inset border border-rule bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-rule-soft px-3">
            <Search aria-hidden="true" className="size-3.5 shrink-0 text-faint" />
            <input
              ref={searchRef}
              type="text"
              role="combobox"
              aria-expanded
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={
                visibleOptions.length > 0 ? optionId(activeIndex) : undefined
              }
              aria-label={searchPlaceholder}
              placeholder={searchPlaceholder}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                onQueryChange?.(event.target.value);
              }}
              onKeyDown={onSearchKeyDown}
              className="h-9 w-full bg-transparent text-sm text-ink outline-none placeholder:text-faint"
            />
          </div>

          {searchHint && (
            <p className="border-b border-rule-soft px-3 py-1.5 text-[12px] leading-[1.45] text-dim">
              {searchHint}
            </p>
          )}

          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel ?? placeholder}
            className="max-h-64 overflow-y-auto py-1"
          >
            {visibleOptions.length === 0 ? (
              <p className="px-3 py-3 text-[13px] text-dim">{emptyMessage}</p>
            ) : (
              renderedGroups.map((group) => (
                <div key={group.label} role="group" aria-label={group.label}>
                  <p className="px-3 pt-2 pb-1 text-[11.5px] font-semibold tracking-[0.02em] text-faint">
                    {group.label}
                  </p>
                  {group.options.map((option) => {
                    flatIndex += 1;
                    const index = flatIndex;
                    const isActive = index === activeIndex;
                    const isSelected = option.value === value;
                    return (
                      <div
                        key={option.value}
                        id={optionId(index)}
                        role="option"
                        aria-selected={isSelected}
                        data-active={isActive || undefined}
                        onPointerEnter={() => setActiveValue(option.value)}
                        onClick={() => choose(option)}
                        className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm ${
                          isActive ? "bg-paper text-ink" : "text-ink"
                        }`}
                      >
                        <span className="truncate">{option.label}</span>
                        {isSelected && (
                          <Check aria-hidden="true" className="size-3.5 shrink-0 text-lead" />
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {hasUnlistedValue && (
            <p className="border-t border-rule-soft px-3 py-2 text-[12.5px] leading-[1.5] text-dim">
              This record currently holds <span className="font-medium text-ink">{value}</span>
              {unlistedLabel ? `, which is ${unlistedLabel}.` : "."} Choosing above replaces it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default SearchableSelect;
