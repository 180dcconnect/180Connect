"use client";

import React, {
  createContext,
  useContext,
  useId,
  useState,
  useEffect,
  useRef,
} from "react";
import { AnimatePresence, motion, type Transition } from "motion/react";

interface MorphingPopoverContextType {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  uniqueId: string;
  transition?: Transition;
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
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;
  const uniqueId = useId();

  const setIsOpen = (nextOpen: boolean) => {
    if (!isControlled) {
      setUncontrolledOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  return (
    <MorphingPopoverContext.Provider
      value={{ isOpen, setIsOpen, uniqueId, transition }}
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
  const { isOpen, setIsOpen, uniqueId, transition } = useMorphingPopover();

  return (
    <AnimatePresence mode="wait">
      {!isOpen && (
        <motion.button
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
  );
}

export interface MorphingPopoverContentProps {
  children: React.ReactNode;
  className?: string;
}

export function MorphingPopoverContent({
  children,
  className = "",
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
          className={`relative z-50 overflow-hidden ${className}`}
          transition={transition}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
