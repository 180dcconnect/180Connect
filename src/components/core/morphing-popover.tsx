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
import { AnimatePresence, motion, type Transition } from "motion/react";

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
 * spacer of exactly the size the trigger last measured, and the content is
 * absolutely positioned over it. The shared `layoutId` still animates the real
 * morph (trigger rect → content rect) because Motion projects between the two
 * boxes regardless of how either is positioned — only the spacer, which
 * deliberately carries no `layoutId`, stays behind in the layout. Two elements
 * sharing one `layoutId` at the same time would fight over the projection.
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
      <div className={`relative inline-block ${className}`}>{children}</div>
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
   * Measure while closed — including through font loads and container resizes —
   * so the spacer that stands in for the trigger is already the right size by
   * the time it is needed.
   */
  useLayoutEffect(() => {
    const node = buttonRef.current;
    if (!node) return;

    const measure = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        reportTriggerSize({ width: rect.width, height: rect.height });
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [isOpen, reportTriggerSize]);

  return (
    <>
      <AnimatePresence mode="wait">
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
      </AnimatePresence>
      {isOpen && triggerSize && (
        <div
          aria-hidden="true"
          className="pointer-events-none"
          style={{ width: triggerSize.width, height: triggerSize.height }}
        />
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
   */
  align?: "start" | "end";
}

export function MorphingPopoverContent({
  children,
  className = "",
  align = "start",
}: MorphingPopoverContentProps) {
  const { isOpen, setIsOpen, uniqueId, transition } = useMorphingPopover();
  const ref = useRef<HTMLDivElement>(null);

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
    <AnimatePresence mode="wait">
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
    </AnimatePresence>
  );
}
