"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useId,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { motion, type Transition } from "motion/react";

/**
 * A trigger that morphs into its own popover, via a shared motion `layoutId`.
 *
 * The thing this primitive has to get right — and originally got wrong — is that
 * **opening must not move the page**. The first version rendered the content
 * `relative`, i.e. in normal flow, so opening swapped a 36px-tall trigger for a
 * 200px-tall panel: the card holding it grew by ~164px and every section below
 * it jumped down. A popover that reflows the document is not a popover.
 *
 * So the flow box is held still. While open, the trigger is replaced by an inert
 * spacer of exactly the size — and baseline — the trigger last measured, and the
 * content is absolutely positioned over it. The shared `layoutId` still animates
 * the real morph (trigger rect → content rect) because Motion projects between
 * the two boxes regardless of how either is positioned — only the spacer, which
 * deliberately carries no `layoutId`, stays behind in the layout. Two elements
 * sharing one `layoutId` at the same time would fight over the projection, which
 * is also why neither side is wrapped in `AnimatePresence`: it would keep the
 * outgoing element — and its claim on the id — alive past the handoff.
 */

interface TriggerSize {
  width: number;
  height: number;
}

interface MorphingPopoverContextType {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  uniqueId: string;
  transition?: Transition;
  triggerSize: TriggerSize | null;
  reportTriggerSize: (size: TriggerSize) => void;
}

const MorphingPopoverContext = createContext<
  MorphingPopoverContextType | undefined
>(undefined);

export function useMorphingPopover() {
  const context = useContext(MorphingPopoverContext);
  if (!context) {
    throw new Error("useMorphingPopover must be used within a MorphingPopover");
  }
  return context;
}

export interface MorphingPopoverProps {
  children: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  transition?: Transition;
  className?: string;
}

export function MorphingPopover({
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  transition = {
    type: "spring",
    bounce: 0.05,
    duration: 0.3,
  },
  className = "",
}: MorphingPopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const [triggerSize, setTriggerSize] = useState<TriggerSize | null>(null);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;
  const uniqueId = useId();

  const setIsOpen = (nextOpen: boolean) => {
    if (!isControlled) {
      setUncontrolledOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  /**
   * Ignore no-op reports: the trigger measures on every layout pass, and
   * setting identical state each time would spin.
   */
  const reportTriggerSize = useCallback((size: TriggerSize) => {
    setTriggerSize((current) =>
      current &&
      Math.abs(current.width - size.width) < 0.5 &&
      Math.abs(current.height - size.height) < 0.5
        ? current
        : size,
    );
  }, []);

  return (
    <MorphingPopoverContext.Provider
      value={{
        isOpen,
        setIsOpen,
        uniqueId,
        transition,
        triggerSize,
        reportTriggerSize,
      }}
    >
      <div className={`relative inline-block ${className}`}>
        {children}
      </div>
    </MorphingPopoverContext.Provider>
  );
}

export interface MorphingPopoverTriggerProps {
  children: React.ReactNode;
  className?: string;
}

export function MorphingPopoverTrigger({
  children,
  className = "",
}: MorphingPopoverTriggerProps) {
  const { isOpen, setIsOpen, uniqueId, transition, triggerSize, reportTriggerSize } =
    useMorphingPopover();
  const buttonRef = useRef<HTMLButtonElement>(null);

  /**
   * Measure the trigger — including through font loads and container resizes —
   * so the spacer that holds its place is the right size before it is needed.
   *
   * `offsetWidth`/`offsetHeight`, not `getBoundingClientRect()`: the rect is
   * post-transform, and Motion animates this element by transform. The observer
   * fires all through the closing morph, so the rect reports the panel's size
   * on the way back — the spacer then stood in at 20rem × the list's height the
   * *next* time it opened, and the heading row grew around the title. The offset
   * properties report the untransformed layout box, which is the only size the
   * spacer ever wants.
   */
  useLayoutEffect(() => {
    const node = buttonRef.current;
    if (!node) return;

    const measure = () => {
      const width = node.offsetWidth;
      const height = node.offsetHeight;
      if (width > 0 || height > 0) {
        reportTriggerSize({ width, height });
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [isOpen, reportTriggerSize]);

  /*
    Two things this has to keep still, both of which it got wrong before:

    - **The box.** While open the trigger is gone, so an inert spacer of the
      size it last measured stands in for it. Without that the header row
      collapses around the absent button.
    - **The baseline.** A bare sized <div> has no line box, so the browser falls
      back to its bottom margin edge, the row re-aligns around a lower baseline,
      and empty space opens above the card's title. The spacer therefore wears
      the trigger's own classes and carries a zero-width space: same box, same
      baseline. SectionCard's heading row no longer aligns on the baseline —
      it is `items-center`, and `items-start` on a numbered card — but the
      spacer is cheap and still correct against any row that does.

    No `AnimatePresence` on either side of the morph. It keeps the outgoing
    element mounted for a beat, which put a real trigger and its spacer in the
    row together — and, when the trigger was absolutely positioned to dodge
    that, left it resting against the wrong box on the way back. Unmounting the
    trigger and mounting the content in the same commit is what Motion wants for
    a `layoutId` handoff anyway: exactly one element owns the id at a time.
  */
  return (
    <>
      {!isOpen && (
        <motion.button
          ref={buttonRef}
          layoutId={`popover-container-${uniqueId}`}
          type="button"
          onClick={() => setIsOpen(true)}
          className={className}
          transition={transition}
        >
          {children}
        </motion.button>
      )}
      {isOpen && triggerSize && (
        <span
          aria-hidden="true"
          className={`pointer-events-none invisible ${className}`}
          style={{ width: triggerSize.width, height: triggerSize.height }}
        >
          {"\u200b"}
        </span>
      )}
    </>
  );
}

export interface MorphingPopoverContentProps {
  children: React.ReactNode;
  className?: string;
  /**
   * Which edge of the trigger the panel grows from. `start` (default) pins its
   * left edge and expands right; `end` pins its right edge and expands left —
   * what you want when the trigger sits at the right of a card header and the
   * panel is wider than it is.
   *
   * `auto` grows right, into the page gutter, and slides itself back left by
   * however much it would otherwise overhang the window. Which position is
   * right depends on the viewport, not on the markup: the same trigger at the
   * right of a narrow column has ~300px of gutter beside it on a wide monitor
   * and ~40px on a laptop, and a breakpoint cannot know the panel's own width.
   */
  align?: "start" | "end" | "auto";
  /**
   * `auto` only: how far left of the trigger to start, in px. A panel much
   * wider than its trigger reads better overlapping the card it came out of
   * than hanging entirely off the side of it. Given up first when the window
   * is tight — the viewport clamp wins over the aesthetic offset.
   */
  nudge?: number;
}

/** Breathing room kept between the panel and the window edge, in px. */
const VIEWPORT_MARGIN = 16;

export function MorphingPopoverContent({
  children,
  className = "",
  align = "start",
  nudge = 0,
}: MorphingPopoverContentProps) {
  const { isOpen, setIsOpen, uniqueId, transition } = useMorphingPopover();
  const ref = useRef<HTMLDivElement>(null);

  /**
   * `auto` is resolved by writing `left` on the node rather than by
   * re-rendering: the answer comes from the DOM (the panel's own width against
   * the space beside the trigger), and routing a measurement back through state
   * would paint one frame in the position it is about to leave.
   *
   * It slides rather than flips. Flipping to the trigger's other edge was the
   * first attempt and it is the wrong shape of answer twice over: the panel
   * jumps to the far side of the button on a viewport a few px too narrow, and
   * on a screen too narrow for *either* side it still overhangs. A single
   * clamped offset — start where you want to be, then come back exactly as far
   * as the window demands, and no further — is continuous in the viewport width
   * and cannot leave the screen.
   */
  useLayoutEffect(() => {
    if (align !== "auto" || !isOpen) return;

    const place = () => {
      const node = ref.current;
      const anchor = node?.parentElement;
      if (!node || !anchor) return;

      const anchorLeft = anchor.getBoundingClientRect().left;
      const width = node.offsetWidth;
      let left = -nudge;

      const overhang = anchorLeft + left + width + VIEWPORT_MARGIN - window.innerWidth;
      if (overhang > 0) left -= overhang;
      // Never past the left edge either: on a window narrower than the panel,
      // overflowing right is the lesser evil — the list scrolls, the search
      // field does not, and it is the field's left edge you type into.
      if (anchorLeft + left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN - anchorLeft;

      node.style.left = `${left}px`;
      node.style.right = "auto";
    };

    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [align, isOpen, nudge]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, setIsOpen]);

  return (
    <>
      {isOpen && (
        <motion.div
          ref={ref}
          layoutId={`popover-container-${uniqueId}`}
          className={`absolute top-0 z-50 overflow-hidden ${
            align === "end" ? "right-0" : "left-0"
          } ${className}`}
          transition={transition}
        >
          {children}
        </motion.div>
      )}
    </>
  );
}
