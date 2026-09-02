"use client";

import * as React from "react";
import {
  motion,
  AnimatePresence,
  useAnimate,
  useMotionValue,
  useMotionValueEvent,
} from "motion/react";
import { Trash2, Check, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type DeleteButtonSize = "xs" | "sm" | "md" | "lg";
export type DeleteButtonVariant = "solid" | "subtle" | "outline" | "dark";

export interface DeleteButtonProps {
  /** Initial button label text. Defaults to "Delete" */
  label?: React.ReactNode;
  /** Confirmation button label text when active. Defaults to "Confirm" */
  confirmLabel?: React.ReactNode;
  /** Label shown while async deletion is executing. Defaults to "Deleting…" */
  deletingLabel?: React.ReactNode;
  /** Duration in milliseconds to display the 'Deleting…' state before the snap triggers. Defaults to 650 */
  deletingDuration?: number;
  /** Callback fired when confirmation is triggered */
  onConfirm?: () => void | Promise<void>;
  /** Callback fired when user cancels via the X button or Escape key */
  onCancel?: () => void;
  /** Callback fired when the button enters confirmation mode */
  onStartConfirm?: () => void;
  /** Button visual style variant. Defaults to "solid" (rich red) */
  variant?: DeleteButtonVariant;
  /** Size scale. Defaults to "md" */
  size?: DeleteButtonSize;
  /** Whether to trigger the Thanos snap particle dissolve effect on confirm. Defaults to true */
  snapOnConfirm?: boolean;
  /** Whether the button should remain completely vanished (hidden) after the snap completes. Defaults to true */
  vanishOnComplete?: boolean;
  /** Whether the control is disabled */
  disabled?: boolean;
  /** External loading override */
  loading?: boolean;
  /** Optional timeout in milliseconds to automatically revert to idle if not confirmed (e.g. 5000). Defaults to 0 (no timeout) */
  autoResetTimeout?: number;
  /** Custom CSS classes for the outer wrapper container */
  className?: string;
  /** Custom CSS classes for the primary delete/confirm button */
  buttonClassName?: string;
  /** Custom CSS classes for the cancel X button */
  cancelButtonClassName?: string;
  /** Accessible label for the main button */
  "aria-label"?: string;
  /** Accessible label for the cancel button */
  cancelAriaLabel?: string;
}

export interface DeleteButtonRef {
  reset: () => void;
}

const DURATION_SECONDS = 0.65;
const MAX_DISPLACEMENT = 300;
const OPACITY_CHANGE_START = 0.45;
const SNAP_TRANSITION = {
  duration: DURATION_SECONDS,
  ease: (time: number) => 1 - Math.pow(1 - time, 3),
};

const sizeConfig = {
  xs: {
    button: "h-7 px-2.5 text-xs gap-1.5",
    iconSize: 13,
    cancelBtn: "h-7 w-7",
    gap: "gap-1.5",
  },
  sm: {
    button: "h-8 px-3 text-xs font-medium gap-1.5",
    iconSize: 14,
    cancelBtn: "h-8 w-8",
    gap: "gap-1.5",
  },
  md: {
    button: "h-9 px-3.5 text-sm font-medium gap-2",
    iconSize: 16,
    cancelBtn: "h-9 w-9",
    gap: "gap-2",
  },
  lg: {
    button: "h-10 px-4 text-sm font-semibold gap-2.5",
    iconSize: 18,
    cancelBtn: "h-10 w-10",
    gap: "gap-2.5",
  },
};

const variantStyles: Record<
  DeleteButtonVariant,
  { idle: string; confirming: string; deleting: string; cancel: string }
> = {
  solid: {
    idle: "bg-red-600 hover:bg-red-700 active:bg-red-800 text-white shadow-xs shadow-red-500/20 border border-red-700/30",
    confirming:
      "bg-red-600 hover:bg-red-700 active:bg-red-800 text-white shadow-xs shadow-red-600/30 ring-2 ring-red-500/20 border border-red-700/40",
    deleting:
      "bg-red-700 text-white shadow-xs border border-red-800/50",
    cancel:
      "bg-transparent text-neutral-600 hover:text-neutral-950 hover:bg-neutral-100/80 active:bg-neutral-200/80 border border-neutral-300 dark:border-neutral-700 dark:text-neutral-300 dark:hover:text-white dark:hover:bg-neutral-800",
  },
  subtle: {
    idle: "bg-red-50 hover:bg-red-100 active:bg-red-200 text-red-700 border border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900/50",
    confirming:
      "bg-red-600 hover:bg-red-700 active:bg-red-800 text-white shadow-xs border border-red-700/40",
    deleting:
      "bg-red-700 text-white shadow-xs border border-red-800/50",
    cancel:
      "bg-transparent text-neutral-600 hover:text-neutral-950 hover:bg-neutral-100/80 active:bg-neutral-200/80 border border-neutral-300 dark:border-neutral-700 dark:text-neutral-300 dark:hover:text-white dark:hover:bg-neutral-800",
  },
  outline: {
    idle: "bg-transparent hover:bg-red-50 active:bg-red-100 text-red-600 border border-red-400 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/30",
    confirming:
      "bg-red-600 hover:bg-red-700 active:bg-red-800 text-white shadow-xs border border-red-700/40",
    deleting:
      "bg-red-700 text-white shadow-xs border border-red-800/50",
    cancel:
      "bg-transparent text-neutral-600 hover:text-neutral-950 hover:bg-neutral-100/80 active:bg-neutral-200/80 border border-neutral-300 dark:border-neutral-700 dark:text-neutral-300 dark:hover:text-white dark:hover:bg-neutral-800",
  },
  dark: {
    idle: "bg-red-950/80 hover:bg-red-900/90 active:bg-red-900 text-red-200 border border-red-800/60 shadow-sm",
    confirming:
      "bg-red-600 hover:bg-red-700 active:bg-red-800 text-white shadow-md shadow-red-950/40 border border-red-500/50",
    deleting:
      "bg-red-900 text-white shadow-sm border border-red-700/60",
    cancel:
      "bg-transparent text-neutral-400 hover:text-white hover:bg-white/10 active:bg-white/15 border border-white/20",
  },
};

/**
 * High-precision DeleteConfirmButton with Thanos Snap particle dissolve effect.
 *
 * Sequence:
 * 1. Starts in idle "Delete" state with trash can icon.
 * 2. When clicked, transitions to "Confirm" + tick mark, and a separate "X" button appears beside it.
 * 3. Clicking "X" cancels and smoothly reverts to "Delete".
 * 4. Clicking "Confirm":
 *    a. Displays "Deleting…" state with loader for ~0.6s.
 *    b. The Thanos snap particle dissolve triggers.
 *    c. After the snap completes, the button remains completely vanished (nothing shows after).
 */
export const DeleteButton = React.forwardRef<
  HTMLButtonElement,
  DeleteButtonProps
>(function DeleteButton(
  {
    label = "Delete",
    confirmLabel = "Confirm",
    deletingLabel = "Deleting…",
    deletingDuration = 650,
    onConfirm,
    onCancel,
    onStartConfirm,
    variant = "solid",
    size = "md",
    snapOnConfirm = true,
    vanishOnComplete = true,
    disabled = false,
    loading: externalLoading = false,
    autoResetTimeout = 0,
    className,
    buttonClassName,
    cancelButtonClassName,
    "aria-label": ariaLabelProp,
    cancelAriaLabel = "Cancel deletion",
  },
  ref
) {
  const reactId = React.useId();
  const filterId = React.useMemo(
    () => `btn-dissolve-filter-${reactId.replace(/[^a-zA-Z0-9-_]/g, "")}`,
    [reactId]
  );

  const [status, setStatus] = React.useState<
    "idle" | "confirming" | "deleting" | "snapping" | "vanished"
  >("idle");
  const [internalLoading, setInternalLoading] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Thanos Snap Animation state & hooks
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const displacementMapRef = React.useRef<SVGFEDisplacementMapElement>(null);
  const dissolveTargetRef = React.useRef<HTMLDivElement>(null);
  const displacement = useMotionValue(0);

  useMotionValueEvent(displacement, "change", (latest) => {
    displacementMapRef.current?.setAttribute("scale", latest.toString());
  });

  const isExecuting =
    externalLoading ||
    internalLoading ||
    status === "deleting" ||
    status === "snapping";
  const isConfirming = status === "confirming";
  const isDeleting = status === "deleting";
  const isVanished = status === "vanished";

  const currentSize = sizeConfig[size] || sizeConfig.md;
  const currentVariant = variantStyles[variant] || variantStyles.solid;

  const clearTimer = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  React.useEffect(() => {
    if (isConfirming && autoResetTimeout > 0) {
      clearTimer();
      timerRef.current = setTimeout(() => {
        setStatus("idle");
        onCancel?.();
      }, autoResetTimeout);
    }
  }, [isConfirming, autoResetTimeout, clearTimer, onCancel]);

  React.useEffect(() => {
    if (!isConfirming) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        clearTimer();
        setStatus("idle");
        onCancel?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isConfirming, clearTimer, onCancel]);

  const runThanosSnap = async () => {
    if (!dissolveTargetRef.current) return;

    await Promise.all([
      animate(
        dissolveTargetRef.current,
        { scale: 1.2, opacity: [1, 1, 0] },
        { ...SNAP_TRANSITION, times: [0, OPACITY_CHANGE_START, 1] }
      ),
      animate(displacement, MAX_DISPLACEMENT, SNAP_TRANSITION),
    ]);
  };

  const handlePrimaryClick = async (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation();

    if (disabled || isExecuting || isVanished) return;

    if (!isConfirming) {
      setStatus("confirming");
      onStartConfirm?.();
      return;
    }

    // User confirmed deletion
    clearTimer();

    if (snapOnConfirm) {
      try {
        setInternalLoading(true);
        // Step 1: Show "Deleting…" text for the configured duration (e.g. ~600ms)
        setStatus("deleting");
        if (deletingDuration > 0) {
          await new Promise((resolve) => setTimeout(resolve, deletingDuration));
        }

        // Step 2: Trigger the Thanos snap dissolve
        setStatus("snapping");
        await Promise.all([
          runThanosSnap(),
          onConfirm ? Promise.resolve(onConfirm()) : Promise.resolve(),
        ]);

        // Step 3: Once snap completes, nothing shows after
        if (vanishOnComplete) {
          setStatus("vanished");
        } else {
          setStatus("idle");
        }
        setInternalLoading(false);
      } catch (err) {
        setStatus("idle");
        setInternalLoading(false);
        throw err;
      }
    } else {
      if (onConfirm) {
        try {
          setInternalLoading(true);
          setStatus("deleting");
          await Promise.resolve(onConfirm());
          if (vanishOnComplete) {
            setStatus("vanished");
          } else {
            setStatus("idle");
          }
          setInternalLoading(false);
        } catch (err) {
          setStatus("idle");
          setInternalLoading(false);
          throw err;
        }
      } else {
        setStatus(vanishOnComplete ? "vanished" : "idle");
      }
    }
  };

  const handleCancelClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (disabled || isExecuting) return;
    clearTimer();
    setStatus("idle");
    onCancel?.();
  };

  const buttonStyleClasses = isDeleting
    ? currentVariant.deleting
    : isConfirming
    ? currentVariant.confirming
    : currentVariant.idle;

  if (isVanished) {
    return null;
  }

  return (
    <div ref={scope} className="inline-block">
      <div
        ref={dissolveTargetRef}
        style={{ filter: `url(#${filterId})` }}
        className="will-change-transform"
      >
        <motion.div
          layout
          transition={{
            duration: 0.2,
            ease: [0.16, 1, 0.3, 1],
          }}
          className={cn(
            "inline-flex items-center select-none",
            currentSize.gap,
            className
          )}
        >
          {/* Primary Action Button (Delete / Confirm / Deleting) */}
          <motion.button
            ref={ref}
            type="button"
            layout
            onClick={handlePrimaryClick}
            disabled={disabled || isExecuting}
            aria-label={
              ariaLabelProp ||
              (isConfirming
                ? "Confirm deletion"
                : isExecuting
                ? "Deleting item"
                : "Delete item")
            }
            aria-expanded={isConfirming}
            aria-live="polite"
            whileTap={disabled || isExecuting ? undefined : { scale: 0.97 }}
            transition={{
              duration: 0.2,
              ease: [0.16, 1, 0.3, 1],
            }}
            className={cn(
              "relative inline-flex items-center justify-center font-medium tracking-tight transition-colors duration-200 cursor-pointer overflow-hidden rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
              currentSize.button,
              buttonStyleClasses,
              buttonClassName
            )}
          >
            {/* Dynamic Icon Morphing: Trash -> Tick -> Spinner */}
            <span className="relative flex items-center justify-center shrink-0">
              <AnimatePresence mode="popLayout" initial={false}>
                {isDeleting ? (
                  <motion.span
                    key="loading-icon"
                    initial={{ opacity: 0, rotate: -45, scale: 0.7 }}
                    animate={{ opacity: 1, rotate: 0, scale: 1 }}
                    exit={{ opacity: 0, rotate: 45, scale: 0.7 }}
                    transition={{ duration: 0.14, ease: "easeOut" }}
                    className="flex items-center justify-center"
                  >
                    <Loader2
                      size={currentSize.iconSize}
                      className="animate-spin"
                      aria-hidden="true"
                    />
                  </motion.span>
                ) : isConfirming || status === "snapping" ? (
                  <motion.span
                    key="confirm-tick-icon"
                    initial={{ opacity: 0, scale: 0.6, rotate: -20 }}
                    animate={{ opacity: 1, scale: 1, rotate: 0 }}
                    exit={{ opacity: 0, scale: 0.6, rotate: 20 }}
                    transition={{
                      duration: 0.14,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    className="flex items-center justify-center"
                  >
                    <Check
                      size={currentSize.iconSize}
                      strokeWidth={2.5}
                      aria-hidden="true"
                    />
                  </motion.span>
                ) : (
                  <motion.span
                    key="delete-trash-icon"
                    initial={{ opacity: 0, scale: 0.6, rotate: 20 }}
                    animate={{ opacity: 1, scale: 1, rotate: 0 }}
                    exit={{ opacity: 0, scale: 0.6, rotate: -20 }}
                    transition={{
                      duration: 0.14,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    className="flex items-center justify-center"
                  >
                    <Trash2
                      size={currentSize.iconSize}
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  </motion.span>
                )}
              </AnimatePresence>
            </span>

            {/* Dynamic Text Transition: Delete -> Confirm -> Deleting */}
            <motion.span
              layout="size"
              transition={{
                duration: 0.2,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="relative flex items-center justify-center overflow-hidden"
            >
              <AnimatePresence mode="popLayout" initial={false}>
                {isDeleting ? (
                  <motion.span
                    key="deleting-text"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.14, ease: "easeOut" }}
                    className="whitespace-nowrap font-medium"
                  >
                    {deletingLabel}
                  </motion.span>
                ) : isConfirming || status === "snapping" ? (
                  <motion.span
                    key="confirming-text"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{
                      duration: 0.14,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    className="whitespace-nowrap font-semibold"
                  >
                    {confirmLabel}
                  </motion.span>
                ) : (
                  <motion.span
                    key="idle-text"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{
                      duration: 0.14,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    className="whitespace-nowrap"
                  >
                    {label}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.span>
          </motion.button>

          {/* Secondary Cancel "X" Button (Appears beside Confirm button, closes smoothly when cancelled) */}
          <AnimatePresence>
            {isConfirming && !isExecuting && (
              <motion.button
                key="cancel-x-button"
                layout
                type="button"
                initial={{ opacity: 0, scale: 0.6, width: 0 }}
                animate={{ opacity: 1, scale: 1, width: "auto" }}
                exit={{ opacity: 0, scale: 0.6, width: 0 }}
                transition={{
                  duration: 0.18,
                  ease: [0.16, 1, 0.3, 1],
                }}
                whileTap={{ scale: 0.92 }}
                onClick={handleCancelClick}
                disabled={disabled || isExecuting}
                aria-label={cancelAriaLabel}
                title="Cancel"
                className={cn(
                  "relative inline-flex items-center justify-center shrink-0 cursor-pointer overflow-hidden rounded-sm transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
                  currentSize.cancelBtn,
                  currentVariant.cancel,
                  cancelButtonClassName
                )}
              >
                <X
                  size={currentSize.iconSize}
                  strokeWidth={2.2}
                  aria-hidden="true"
                />
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* SVG Dissolve Filter Definition */}
      <svg width="0" height="0" className="absolute -z-10 pointer-events-none opacity-0">
        <defs>
          <filter
            id={filterId}
            x="-300%"
            y="-300%"
            width="600%"
            height="600%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.015"
              numOctaves="1"
              result="bigNoise"
            />
            <feComponentTransfer in="bigNoise" result="bigNoiseAdjusted">
              <feFuncR type="linear" slope="0.5" intercept="-0.2" />
              <feFuncG type="linear" slope="3" intercept="-0.6" />
            </feComponentTransfer>
            <feTurbulence
              type="fractalNoise"
              baseFrequency="1"
              numOctaves="2"
              result="fineNoise"
            />
            <feMerge result="combinedNoise">
              <feMergeNode in="bigNoiseAdjusted" />
              <feMergeNode in="fineNoise" />
            </feMerge>
            <feDisplacementMap
              ref={displacementMapRef}
              in="SourceGraphic"
              in2="combinedNoise"
              scale="0"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>
    </div>
  );
});

DeleteButton.displayName = "DeleteButton";

/** Alias export for flexibility */
export const DeleteConfirmButton = DeleteButton;
export type DeleteConfirmButtonProps = DeleteButtonProps;
