"use client";

import * as React from "react";
import {
  motion,
  AnimatePresence,
  useAnimate,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
} from "motion/react";
import { Check, X, Loader2 } from "lucide-react";
import { MessageSquareQuote } from "@/components/animate-ui/icons/message-square-quote";
import { AnimateIcon } from "@/components/animate-ui/icons/icon";
import { cn } from "@/lib/utils";
import { requestFeedbackRound } from "@/lib/feedback-actions";

export type RequestFeedbackButtonSize = "xs" | "sm" | "md" | "lg";
export type RequestFeedbackButtonVariant =
  | "lead"
  | "brand"
  | "solid"
  | "subtle"
  | "outline"
  | "dark";

export interface RequestFeedbackButtonProps {
  /** Initial button label text. Defaults to "Request feedback round" */
  label?: React.ReactNode;
  /** Confirmation button label text when active. Defaults to "Confirm" */
  confirmLabel?: React.ReactNode;
  /** Label shown while async request is executing. Defaults to "Requesting…" */
  requestingLabel?: React.ReactNode;
  /** Duration in milliseconds to display the 'Requesting…' state before the snap triggers. Defaults to 550 */
  requestingDuration?: number;
  /** Delay in milliseconds before the button reappears after the Thanos snap completes. Defaults to 1000 (1 second) */
  reappearDelay?: number;
  /** Callback fired when confirmation is triggered. Defaults to requestFeedbackRound() */
  onConfirm?: () => void | Promise<void>;
  /** Callback fired when user cancels via the X button or Escape key */
  onCancel?: () => void;
  /** Callback fired when the button enters confirmation mode */
  onStartConfirm?: () => void;
  /** Callback fired once the dissolve and reappearance cycle completes */
  onComplete?: () => void;
  /** Button visual style variant. Defaults to "lead" */
  variant?: RequestFeedbackButtonVariant;
  /** Size scale. Defaults to "md" */
  size?: RequestFeedbackButtonSize;
  /** Optional icon override for the resting state. Defaults to <MessageSquareQuote /> */
  icon?: React.ReactNode;
  /** Whether the button has fully rounded pill/capsule corners. Defaults to false (standard rounded-lg) */
  pill?: boolean;
  /** Whether the control is disabled */
  disabled?: boolean;
  /** External loading override */
  loading?: boolean;
  /** Optional timeout in milliseconds to automatically revert to idle if not confirmed. Defaults to 0 (no timeout) */
  autoResetTimeout?: number;
  /** Custom CSS classes for the outer wrapper container */
  className?: string;
  /** Custom CSS classes for the primary action button */
  buttonClassName?: string;
  /** Custom CSS classes for the cancel X button */
  cancelButtonClassName?: string;
  /** Accessible label for the main button */
  "aria-label"?: string;
  /** Accessible label for the cancel button */
  cancelAriaLabel?: string;
}

export interface RequestFeedbackButtonRef {
  reset: () => void;
}

const DURATION_SECONDS = 0.65;
const MAX_DISPLACEMENT = 300;
const OPACITY_CHANGE_START = 0.45;
const SNAP_TRANSITION = {
  duration: DURATION_SECONDS,
  ease: (time: number) => 1 - Math.pow(1 - time, 3),
};

const MORPH_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const MORPH_TRANSITION = { duration: 0.3, ease: MORPH_EASE };
const SWAP_TRANSITION = { duration: 0.22, ease: MORPH_EASE };

const sizeConfig = {
  xs: {
    button: "h-7 px-2.5 text-xs gap-1.5",
    iconSize: 13,
    cancelBtn: "h-7 min-w-[32px] px-2",
    gapPx: 6,
  },
  sm: {
    button: "h-8 px-3 text-xs font-medium gap-1.5",
    iconSize: 14,
    cancelBtn: "h-8 min-w-[38px] px-2.5",
    gapPx: 6,
  },
  md: {
    button: "h-9 px-4 text-xs sm:text-sm font-semibold gap-2",
    iconSize: 15,
    cancelBtn: "h-9 min-w-[40px] px-3",
    gapPx: 8,
  },
  lg: {
    button: "h-10 px-5 text-sm font-semibold gap-2.5",
    iconSize: 17,
    cancelBtn: "h-10 min-w-[44px] px-3.5",
    gapPx: 10,
  },
};

const variantStyles: Record<
  RequestFeedbackButtonVariant,
  { idle: string; confirming: string; requesting: string; cancel: string }
> = {
  lead: {
    idle: "bg-[#23407a] hover:bg-[#1c3362] active:bg-[#16294e] text-white shadow-xs shadow-[#23407a]/20 border border-[#23407a]/40",
    confirming:
      "bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white shadow-xs shadow-amber-600/30 ring-2 ring-amber-500/25 border border-amber-700/40",
    requesting: "bg-[#1c3362] text-white shadow-xs border border-[#16294e]/50",
    cancel:
      "bg-transparent text-neutral-600 hover:text-neutral-950 hover:bg-neutral-100/80 active:bg-neutral-200/80 border border-neutral-300",
  },
  brand: {
    idle: "bg-[#141a22] hover:bg-[#23407a] active:bg-[#102a4e] text-white shadow-xs border border-black/15",
    confirming:
      "bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white shadow-xs ring-2 ring-amber-500/25 border border-amber-600",
    requesting: "bg-[#141a22] text-white shadow-xs border border-black/20",
    cancel:
      "bg-transparent text-neutral-600 hover:text-neutral-950 hover:bg-neutral-100/80 active:bg-neutral-200/80 border border-neutral-300",
  },
  solid: {
    idle: "bg-[#102a4e] hover:bg-[#173a6a] active:bg-[#0c203c] text-white shadow-xs border border-black/15",
    confirming:
      "bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white shadow-xs shadow-amber-600/30 ring-2 ring-amber-500/25 border border-amber-700/40",
    requesting: "bg-[#173a6a] text-white shadow-xs border border-black/20",
    cancel:
      "bg-transparent text-neutral-600 hover:text-neutral-950 hover:bg-neutral-100/80 border border-neutral-300",
  },
  subtle: {
    idle: "bg-[#e3e9f5] hover:bg-[#d6e0f0] active:bg-[#c8d6eb] text-[#23407a] border border-[#23407a]/20",
    confirming:
      "bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white shadow-xs border border-amber-700/40",
    requesting: "bg-[#23407a] text-white shadow-xs border border-[#1c3362]",
    cancel:
      "bg-transparent text-neutral-600 hover:text-neutral-950 hover:bg-neutral-100/80 border border-neutral-300",
  },
  outline: {
    idle: "bg-transparent hover:bg-[#23407a]/5 active:bg-[#23407a]/10 text-[#23407a] border border-[#23407a]/35",
    confirming:
      "bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white shadow-xs border border-amber-700/40",
    requesting: "bg-[#23407a] text-white shadow-xs border border-[#1c3362]",
    cancel:
      "bg-transparent text-neutral-600 hover:text-neutral-950 hover:bg-neutral-100/80 border border-neutral-300",
  },
  dark: {
    idle: "bg-neutral-900 hover:bg-neutral-800 active:bg-black text-white border border-neutral-700 shadow-sm",
    confirming:
      "bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white shadow-md ring-2 ring-amber-500/30 border border-amber-500",
    requesting: "bg-neutral-800 text-white shadow-sm border border-neutral-700",
    cancel:
      "bg-transparent text-neutral-400 hover:text-white hover:bg-white/10 active:bg-white/15 border border-white/20",
  },
};

/**
 * RequestFeedbackButton with confirmation morph, Thanos Snap particle dissolve,
 * and a smooth, elegant reappearance animation after ~1 second.
 */
export const RequestFeedbackButton = React.forwardRef<
  HTMLButtonElement,
  RequestFeedbackButtonProps
>(function RequestFeedbackButton(
  {
    label = "Request feedback round",
    confirmLabel = "Confirm",
    requestingLabel = "Requesting…",
    requestingDuration = 550,
    reappearDelay = 1000,
    onConfirm,
    onCancel,
    onStartConfirm,
    onComplete,
    variant = "lead",
    size = "md",
    icon,
    pill = false,
    disabled = false,
    loading: externalLoading = false,
    autoResetTimeout = 0,
    className,
    buttonClassName,
    cancelButtonClassName,
    "aria-label": ariaLabelProp,
    cancelAriaLabel = "Cancel feedback request",
  },
  ref
) {
  const shouldReduceMotion = useReducedMotion();
  const reactId = React.useId();
  const filterId = React.useMemo(
    () => `btn-feedback-dissolve-${reactId.replace(/[^a-zA-Z0-9-_]/g, "")}`,
    [reactId]
  );

  const [status, setStatus] = React.useState<
    "idle" | "confirming" | "requesting" | "snapping" | "vanished" | "reappearing"
  >("idle");
  const [internalLoading, setInternalLoading] = React.useState(false);
  const [reappearKey, setReappearKey] = React.useState(0);
  const [recentlyRequested, setRecentlyRequested] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Thanos Snap particle dissolve hooks & animation scope
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
    status === "requesting" ||
    status === "snapping";
  const isConfirming = status === "confirming";
  const isRequesting = status === "requesting";
  const isSnapping = status === "snapping";
  const isVanished = status === "vanished";
  const isCommitted = isRequesting || isSnapping;

  const currentSize = sizeConfig[size] || sizeConfig.md;
  const currentVariant = variantStyles[variant] || variantStyles.lead;

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

  const resetSnapStyles = React.useCallback(() => {
    displacement.set(0);
    displacementMapRef.current?.setAttribute("scale", "0");
    if (dissolveTargetRef.current) {
      dissolveTargetRef.current.style.opacity = "1";
      dissolveTargetRef.current.style.transform = "none";
    }
  }, [displacement]);

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

    // User confirmed feedback request
    clearTimer();

    try {
      setInternalLoading(true);
      setStatus("requesting");

      const actionPromise = onConfirm
        ? Promise.resolve(onConfirm())
        : (async () => {
            const res = await requestFeedbackRound();
            if (!res.ok) throw new Error(res.message);
          })();

      const minDisplayPromise =
        requestingDuration > 0
          ? new Promise((resolve) => setTimeout(resolve, requestingDuration))
          : Promise.resolve();

      await Promise.all([actionPromise, minDisplayPromise]);

      // Trigger Thanos Snap particle dissolve
      setStatus("snapping");
      await runThanosSnap();

      // Step 1: Temporarily vanish
      setStatus("vanished");
      resetSnapStyles();
      setInternalLoading(false);

      // Step 2: Pause for ~1 second (1000ms)
      await new Promise((resolve) => setTimeout(resolve, reappearDelay));

      // Step 3: Reappear with a smooth, delightful spring animation
      setReappearKey((k) => k + 1);
      setStatus("reappearing");
      setRecentlyRequested(true);
      onComplete?.();

      // Step 4: Settle back into idle
      setTimeout(() => {
        setStatus("idle");
      }, 600);

      // Keep success indicator active for a few seconds
      setTimeout(() => {
        setRecentlyRequested(false);
      }, 3500);
    } catch (err) {
      resetSnapStyles();
      setStatus("idle");
      setInternalLoading(false);
      throw err;
    }
  };

  const handleCancelClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (disabled || isExecuting) return;
    clearTimer();
    setStatus("idle");
    onCancel?.();
  };

  const buttonStyleClasses = isCommitted
    ? currentVariant.requesting
    : isConfirming
    ? currentVariant.confirming
    : currentVariant.idle;

  return (
    <div ref={scope} className="inline-flex items-center gap-3">
      <AnimatePresence mode="wait">
        {isVanished ? (
          // Placeholder maintaining layout space while vanished for ~1s
          <motion.div
            key="vanished-placeholder"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            className="h-9 pointer-events-none"
          />
        ) : (
          <motion.div
            key={`reappear-${reappearKey}`}
            initial={
              reappearKey > 0
                ? { opacity: 0, scale: 0.76, y: 8, filter: "blur(6px)" }
                : false
            }
            animate={{
              opacity: 1,
              scale: [0.76, 1.04, 1],
              y: 0,
              filter: "blur(0px)",
            }}
            transition={{
              duration: 0.48,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="relative inline-block will-change-transform"
          >
            {/* Subtle celebration ring on reappearance */}
            {status === "reappearing" && (
              <motion.span
                initial={{ opacity: 0.8, scale: 0.96 }}
                animate={{ opacity: 0, scale: 1.25 }}
                transition={{ duration: 0.75, ease: "easeOut" }}
                className={cn(
                  "pointer-events-none absolute inset-0 ring-2 ring-emerald-500/50",
                  pill ? "rounded-full" : "rounded-lg"
                )}
              />
            )}

            <div
              ref={dissolveTargetRef}
              style={{ filter: `url(#${filterId})` }}
              className="will-change-transform"
            >
              <div
                className={cn(
                  "inline-flex items-center select-none",
                  className
                )}
              >
                {/* Primary Action Button (Request / Confirm / Requesting) */}
                <AnimateIcon
                  animateOnHover={
                    !shouldReduceMotion &&
                    !disabled &&
                    !isExecuting &&
                    !isConfirming
                  }
                  completeOnStop
                  asChild
                >
                  <motion.button
                    ref={ref}
                    type="button"
                    onClick={handlePrimaryClick}
                    disabled={disabled || isExecuting}
                    aria-label={
                      ariaLabelProp ||
                      (isConfirming
                        ? "Confirm feedback request"
                        : isExecuting
                        ? "Requesting feedback round"
                        : "Request feedback round")
                    }
                    aria-expanded={isConfirming}
                    aria-live="polite"
                    whileTap={disabled || isExecuting ? undefined : { scale: 0.97 }}
                    className={cn(
                      "relative inline-flex items-center justify-center font-semibold tracking-tight transition-colors duration-150 cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none",
                      pill ? "rounded-full" : "rounded-lg",
                      disabled && !isExecuting && "opacity-50",
                      currentSize.button,
                      buttonStyleClasses,
                      buttonClassName
                    )}
                  >
                    {/* Dynamic Icon Morphing: MessageSquareQuote -> Check -> Spinner */}
                    <span className="relative flex items-center justify-center shrink-0">
                      <AnimatePresence mode="popLayout" initial={false}>
                        {isCommitted ? (
                          <motion.span
                            key="loading-icon"
                            initial={{ opacity: 0, rotate: -45, scale: 0.7 }}
                            animate={{ opacity: 1, rotate: 0, scale: 1 }}
                            exit={{ opacity: 0, rotate: 45, scale: 0.7 }}
                            transition={SWAP_TRANSITION}
                            className="flex items-center justify-center"
                          >
                            <Loader2
                              size={currentSize.iconSize}
                              className="animate-spin"
                              aria-hidden="true"
                            />
                          </motion.span>
                        ) : isConfirming ? (
                          <motion.span
                            key="confirm-tick-icon"
                            initial={{ opacity: 0, scale: 0.6, rotate: -20 }}
                            animate={{ opacity: 1, scale: 1, rotate: 0 }}
                            exit={{ opacity: 0, scale: 0.6, rotate: 20 }}
                            transition={SWAP_TRANSITION}
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
                            key="feedback-idle-icon"
                            initial={{ opacity: 0, scale: 0.6, rotate: 20 }}
                            animate={{ opacity: 1, scale: 1, rotate: 0 }}
                            exit={{ opacity: 0, scale: 0.6, rotate: -20 }}
                            transition={SWAP_TRANSITION}
                            className="flex items-center justify-center"
                          >
                            {icon || (
                              <MessageSquareQuote
                                size={currentSize.iconSize}
                                className="shrink-0"
                                aria-hidden="true"
                              />
                            )}
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </span>

                    {/* Dynamic Text Transition: Request -> Confirm -> Requesting */}
                    <span className="relative inline-grid items-center justify-items-center overflow-hidden">
                      <AnimatePresence initial={false}>
                        {isCommitted && (
                          <motion.span
                            key="executing-sizer"
                            aria-hidden="true"
                            initial={{ width: 0 }}
                            animate={{ width: "auto" }}
                            exit={{ width: 0 }}
                            transition={MORPH_TRANSITION}
                            className="invisible col-start-1 row-start-1 overflow-hidden whitespace-nowrap font-semibold"
                          >
                            {requestingLabel}
                          </motion.span>
                        )}
                      </AnimatePresence>

                      {/* Sizers hold column width so swapping labels does not jitter */}
                      {[label, confirmLabel].map((sizerLabel, index) => (
                        <span
                          key={`label-sizer-${index}`}
                          aria-hidden="true"
                          className="invisible col-start-1 row-start-1 whitespace-nowrap font-semibold"
                        >
                          {sizerLabel}
                        </span>
                      ))}

                      <span className="absolute inset-0 flex items-center justify-center">
                        <AnimatePresence mode="popLayout" initial={false}>
                          {isCommitted ? (
                            <motion.span
                              key="requesting-text"
                              initial={{ opacity: 0, y: 5 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -5 }}
                              transition={SWAP_TRANSITION}
                              className="whitespace-nowrap font-medium"
                            >
                              {requestingLabel}
                            </motion.span>
                          ) : isConfirming ? (
                            <motion.span
                              key="confirming-text"
                              initial={{ opacity: 0, y: 5 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -5 }}
                              transition={SWAP_TRANSITION}
                              className="whitespace-nowrap font-semibold"
                            >
                              {confirmLabel}
                            </motion.span>
                          ) : (
                            <motion.span
                              key="idle-text"
                              initial={{ opacity: 0, y: 5 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -5 }}
                              transition={SWAP_TRANSITION}
                              className="whitespace-nowrap"
                            >
                              {label}
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </span>
                    </span>
                  </motion.button>
                </AnimateIcon>

                {/* Secondary Cancel "X" Button */}
                <AnimatePresence initial={false}>
                  {isConfirming && !isExecuting && (
                    <motion.div
                      key="cancel-x-button"
                      initial={{ width: 0, marginLeft: 0, opacity: 0 }}
                      animate={{
                        width: "auto",
                        marginLeft: currentSize.gapPx,
                        opacity: 1,
                      }}
                      exit={{ width: 0, marginLeft: 0, opacity: 0 }}
                      transition={MORPH_TRANSITION}
                      className="shrink-0 overflow-hidden"
                    >
                      <motion.button
                        type="button"
                        whileTap={{ scale: 0.92 }}
                        onClick={handleCancelClick}
                        disabled={disabled || isExecuting}
                        aria-label={cancelAriaLabel}
                        title="Cancel"
                        className={cn(
                          "relative inline-flex items-center justify-center shrink-0 cursor-pointer overflow-hidden transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
                          pill ? "rounded-full" : "rounded-lg",
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
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* SVG Dissolve Filter Definition */}
            <svg
              width="0"
              height="0"
              className="absolute -z-10 pointer-events-none opacity-0"
            >
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
                  <feComponentTransfer
                    in="bigNoise"
                    result="bigNoiseAdjusted"
                  >
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
          </motion.div>
        )}
      </AnimatePresence>

      {/* Subtle confirmation indicator after successful reappearance */}
      <AnimatePresence>
        {recentlyRequested && (
          <motion.span
            initial={{ opacity: 0, x: -6, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -4, scale: 0.95 }}
            transition={{ duration: 0.25 }}
            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50/90 border border-emerald-200/80 px-2.5 py-1 rounded-full shadow-xs select-none"
          >
            <Check className="size-3.5 text-emerald-600" strokeWidth={2.5} />
            Round initiated
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
});

RequestFeedbackButton.displayName = "RequestFeedbackButton";
