"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Liquid, type Transition } from "liquid-gooey";
import { ArrowRight, Check, Loader2, Sparkles, Send, X, Plus } from "lucide-react";

export interface GooeyEmailInputProps {
  /** Placeholder text for email input */
  placeholder?: string;
  /** Callback when the user submits a valid email */
  onSubmit?: (email: string) => Promise<void> | void;
  /** Color theme variant */
  variant?: "dark" | "light" | "brand" | "glass" | "obsidian";
  /** Size preset */
  size?: "sm" | "md" | "lg" | "xl";
  /** Custom input field width in px (overrides size preset width) */
  fieldWidth?: number;
  /** Blur sigma in px (default 6) */
  gooBlur?: number;
  /** Alpha contrast slope (default 18) */
  gooContrast?: number;
  /** Distance in px the button separates away on focus (default 52) */
  gap?: number;
  /** Animation duration in ms (default 380) */
  duration?: number;
  /** Transition easing curve */
  ease?: string;
  /** Custom fill color for liquid capsule (overrides variant) */
  fillColor?: string;
  /** Custom box shadow string (overrides variant) */
  shadow?: string;
  /** Custom icon for submit button */
  buttonIcon?: "arrow" | "send" | "sparkles" | "x" | "plus";
  /**
   * Tap handler for the droplet that replaces submit — e.g. an "x" droplet
   * that dismisses the field. Enter still submits via onSubmit.
   */
  onDropletClick?: () => void;
  /** Accessible label for the droplet when onDropletClick replaces submit. */
  dropletLabel?: string;
  /** Class name for the outer wrapper */
  className?: string;
  /** Disabled state */
  disabled?: boolean;
  /**
   * Controlled value. When provided the field stops owning its text (for
   * non-email uses like the booklet's website URL) — pair with onValueChange.
   */
  value?: string;
  /** Change handler for controlled mode. */
  onValueChange?: (value: string) => void;
  /** Input type. Defaults to email. */
  inputType?: string;
  /** Accessible label for the field. */
  fieldLabel?: string;
  /** Accessible label for the submit droplet. */
  submitLabel?: string;
  /**
   * Validate before submit. Return an error message, or null when fine.
   * Defaults to the email check — pass `() => null` where the server is the
   * validator (it reports back through its own error box).
   */
  validate?: (value: string) => string | null;
  /**
   * Live validation for the droplet: debounced after each keystroke, spinner
   * while it runs, tick when the value verifies. Tapping a tick submits;
   * tapping anything else falls through to onDropletClick. Only when
   * provided — without it the droplet keeps its legacy submit behavior.
   */
  validateAsync?: (value: string) => Promise<string | null>;
  /** Debounce before a live check fires. */
  validationDelayMs?: number;
  /** Placeholder shown briefly after a successful submit. */
  successPlaceholder?: string;
  /** Focus the field on mount, for fields revealed by a transform. */
  autoFocusField?: boolean;
  /** Maximum input length, passed straight to the field. */
  maxLength?: number;
  /**
   * Stage alignment. Centered by default; "start" left-packs the capsule so
   * the visible pill begins at the row's edge instead of floating mid-stage.
   */
  align?: "center" | "start";
  /**
   * Button-face text. When provided and the field is empty and blurred, the
   * capsule wears it like a button label (with `restIcon` beside it) instead
   * of the placeholder — focusing or typing flips it into a plain field. One
   * element throughout, so becoming a field needs no swap animation.
   */
  restPlaceholder?: string;
}

const EASING_PRESETS: Record<string, string> = {
  Bouncy: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  Smooth: "cubic-bezier(0.3, 1.05, 0.4, 1)",
  Snappy: "cubic-bezier(0.22, 1, 0.36, 1)",
  Standard: "cubic-bezier(0.4, 0, 0.2, 1)",
};

export function GooeyEmailInput({
  placeholder = "Enter your email address...",
  onSubmit,
  variant = "light",
  size = "md",
  fieldWidth,
  gooBlur = 6,
  gooContrast = 18,
  gap = 54,
  duration = 380,
  ease = EASING_PRESETS.Bouncy,
  fillColor,
  shadow,
  buttonIcon = "arrow",
  onDropletClick,
  dropletLabel = "Close",
  className = "",
  disabled = false,
  value,
  onValueChange,
  inputType = "email",
  fieldLabel = "Email address",
  submitLabel = "Submit email",
  validate,
  validateAsync,
  validationDelayMs = 600,
  successPlaceholder = "Subscribed successfully!",
  autoFocusField = false,
  maxLength,
  align = "center",
  restPlaceholder,
}: GooeyEmailInputProps) {
  const [email, setEmail] = React.useState("");
  const [isFocused, setIsFocused] = React.useState(false);
  const [status, setStatus] = React.useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isPulsing, setIsPulsing] = React.useState(false);

  const controlled = value !== undefined;
  const text = controlled ? value : email;

  // Live droplet validation. Empty means nothing to verify (droplet keeps its
  // resting behavior); otherwise each pause fires one check, and a stale
  // flight that lands after newer typing is ignored rather than applied.
  const live = validateAsync !== undefined;
  const [checking, setChecking] = React.useState(false);
  const [verdict, setVerdict] = React.useState<boolean | null>(null);
  const checkId = React.useRef(0);

  React.useEffect(() => {
    if (!live) return;
    if (!text.trim()) {
      const resetTimer = setTimeout(() => {
        setVerdict(null);
        setChecking(false);
      }, 0);
      return () => clearTimeout(resetTimer);
    }
    const id = ++checkId.current;
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        const problem = await validateAsync!(text);
        if (checkId.current !== id) return;
        setVerdict(problem === null);
      } catch {
        // An unreachable validator is "not confirmed", never "confirmed".
        if (checkId.current !== id) return;
        setVerdict(false);
      } finally {
        if (checkId.current === id) setChecking(false);
      }
    }, validationDelayMs);
    return () => clearTimeout(timer);
  }, [text, live, validateAsync, validationDelayMs]);

  // Trigger brief icon cross-blur / pulse animation on focus change
  React.useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const raf = requestAnimationFrame(() => {
      setIsPulsing(true);
      timeoutId = setTimeout(() => setIsPulsing(false), duration + 80);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isFocused, duration]);

  // Dimensions based on size
  const dims = React.useMemo(() => {
    switch (size) {
      case "sm": {
        const fieldW = fieldWidth ?? 190;
        return {
          fieldW,
          fieldH: 42,
          btnSize: 38,
          fontSize: "text-xs",
          iconSize: 15,
          totalW: Math.max(300, fieldW + 38 + gap + 60),
          totalH: align === "start" ? 52 : 74,
        };
      }
      case "lg": {
        const fieldW = fieldWidth ?? 260;
        return {
          fieldW,
          fieldH: 54,
          btnSize: 48,
          fontSize: "text-base",
          iconSize: 20,
          totalW: Math.max(400, fieldW + 48 + gap + 80),
          totalH: align === "start" ? 66 : 94,
        };
      }
      case "md":
      default: {
        const fieldW = fieldWidth ?? 224;
        return {
          fieldW,
          fieldH: 48,
          btnSize: 44,
          fontSize: "text-sm",
          iconSize: 18,
          totalW: Math.max(360, fieldW + 44 + gap + 70),
          totalH: align === "start" ? 58 : 84,
        };
      }
    }
  }, [size, gap, fieldWidth, align]);

  // Variant themes
  const theme = React.useMemo(() => {
    switch (variant) {
      case "obsidian":
        // Matches the raised obsidian sheet the invite drawer sits on
        // (INK_RAISED #161b21 + the single lime accent), so the input can be
        // dropped straight into that surface without re-tinting anything.
        return {
          fill: fillColor ?? "#161b21",
          shadow:
            shadow ??
            "0 0 0 1px rgba(230, 245, 192, 0.22) inset, inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 10px 30px -6px rgba(0, 0, 0, 0.7)",
          text: "text-[#f4f4ef]",
          placeholder: "placeholder:text-[#f4f4ef]/45",
          btnColor: "text-[#e6f5c0] hover:text-[#f4fcd9]",
          btnBg: "hover:bg-[#e6f5c0]/12",
          accentRing: "focus-visible:ring-[#e6f5c0]/50",
        };
      case "dark":
        return {
          fill: fillColor ?? "#1e1e24",
          shadow:
            shadow ??
            "0 0 0 1px rgba(255, 255, 255, 0.08) inset, 0 8px 24px -4px rgba(0, 0, 0, 0.6)",
          text: "text-neutral-100",
          placeholder: "placeholder:text-neutral-500",
          btnColor: "text-neutral-100 hover:text-white",
          btnBg: "hover:bg-white/10",
          accentRing: "focus-visible:ring-white/40",
        };
      case "light":
        return {
          fill: fillColor ?? "#ffffff",
          shadow:
            shadow ??
            "0 0 0 1px rgba(0, 0, 0, 0.08), 0 2px 6px -1px rgba(0, 0, 0, 0.06), 0 12px 28px -4px rgba(0, 0, 0, 0.1)",
          text: "text-neutral-900",
          placeholder: "placeholder:text-neutral-400",
          btnColor: "text-neutral-900 hover:text-black",
          btnBg: "hover:bg-black/5",
          accentRing: "focus-visible:ring-neutral-900/30",
        };
      case "glass":
        return {
          fill: fillColor ?? "rgba(255, 255, 255, 0.9)",
          shadow:
            shadow ??
            "0 0 0 1px rgba(255, 255, 255, 0.6) inset, 0 0 0 1px rgba(0, 0, 0, 0.06), 0 8px 32px 0 rgba(0, 0, 0, 0.08)",
          text: "text-neutral-900",
          placeholder: "placeholder:text-neutral-400",
          btnColor: "text-neutral-900 hover:text-black",
          btnBg: "hover:bg-black/5",
          accentRing: "focus-visible:ring-neutral-900/30",
        };
      case "brand":
      default:
        return {
          fill: fillColor ?? "#111215",
          shadow:
            shadow ??
            "0 0 0 1px rgba(230, 245, 192, 0.22) inset, 0 10px 30px -4px rgba(0, 0, 0, 0.35), 0 0 20px -2px rgba(230, 245, 192, 0.15)",
          text: "text-[#f5f5f0]",
          placeholder: "placeholder:text-[#f5f5f0]/40",
          btnColor: "text-[#e6f5c0] hover:text-[#f4fcd9]",
          btnBg: "hover:bg-[#e6f5c0]/10",
          accentRing: "focus-visible:ring-[#e6f5c0]/50",
        };
    }
  }, [variant, fillColor, shadow]);

  // Button-face: empty and blurred with a rest label, the capsule carries it
  // as an overlaid white label with its icon — real text, not a dim
  // placeholder, so it reads as a button title. Anything else is a plain
  // field. The overlay sits exactly where field text starts, so flipping
  // between the two moves nothing.
  const resting = restPlaceholder !== undefined && !isFocused && !text;

  const check = (candidate: string): string | null => {
    if (validate) return validate(candidate);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(candidate) ? null : "Please enter a valid email";
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!text || status === "loading") return;

    const problem = check(text);
    if (problem) {
      setStatus("error");
      setErrorMessage(problem);
      setTimeout(() => {
        setStatus("idle");
        setErrorMessage(null);
      }, 2500);
      return;
    }

    try {
      setStatus("loading");
      setErrorMessage(null);
      if (onSubmit) {
        await onSubmit(text);
      } else {
        // Default simulated network delay
        await new Promise((res) => setTimeout(res, 900));
      }
      setStatus("success");
      if (!controlled) setEmail("");
      inputRef.current?.blur();
      setTimeout(() => setStatus("idle"), 3500);
    } catch {
      setStatus("error");
      setErrorMessage("Failed to subscribe. Please retry.");
      setTimeout(() => {
        setStatus("idle");
        setErrorMessage(null);
      }, 3000);
    }
  };

  const transitionConfig: Transition = React.useMemo(() => {
    return {
      duration,
      ease,
    };
  }, [duration, ease]);

  // Position shifts: when align === "start", the capsule stays anchored on the left
  // edge with zero left offset and the droplet travels rightward. When centered, they shift symmetrically.
  const fieldShiftX = align === "start" ? 0 : isFocused ? -gap * 0.4 : 0;
  const btnShiftX = align === "start" ? (isFocused ? gap : 0) : isFocused ? gap * 0.6 : 0;

  // Compute icon to display. In live mode a tick means "verified — tap to
  // go"; anything unverified keeps the droplet's resting behavior.
  const hasText = text.trim() !== "";
  const liveChecking = live && hasText && (checking || verdict === null);
  const liveTick = live && hasText && !checking && verdict === true;
  const renderIcon = () => {
    if (status === "loading" || liveChecking) {
      return <Loader2 className="animate-spin" size={dims.iconSize} />;
    }
    if (status === "success" || liveTick) {
      return <Check className="text-emerald-500" size={dims.iconSize} />;
    }
    switch (buttonIcon) {
      case "send":
        return <Send size={dims.iconSize} className="ml-0.5" />;
      case "sparkles":
        return <Sparkles size={dims.iconSize} />;
      case "x":
        return <X size={dims.iconSize} />;
      case "plus":
        return <Plus size={dims.iconSize} />;
      case "arrow":
      default:
        return <ArrowRight size={dims.iconSize} />;
    }
  };

  // Fixed resting center reference for both slots — or a left-packed stage
  // whose visible capsule starts neatly inset from the row's edge, keeping
  // right-hand room for the droplet's separation travel.
  const centerLeft = dims.totalW / 2;
  const fieldBaseLeft =
    align === "start" ? 12 : centerLeft - dims.fieldW / 2 - 10;
  const btnBaseLeft = fieldBaseLeft + dims.fieldW - dims.btnSize;
  const stageW =
    align === "start"
      ? Math.ceil(fieldBaseLeft + dims.fieldW + gap + 16)
      : dims.totalW;

  return (
    <div
      className={`relative inline-flex flex-col ${
        align === "start" ? "items-start" : "items-center"
      } select-none ${className}`}
    >
      {/* Liquid Gooey Container */}
      <Liquid
        blur={gooBlur}
        contrast={gooContrast}
        fill={theme.fill}
        shadow={theme.shadow}
        className={`relative flex items-center ${
          align === "start" ? "justify-start" : "justify-center"
        }`}
        style={{
          width: `${stageW}px`,
          height: `${dims.totalH}px`,
        }}
      >
        {/* 1. Email Input Capsule Slot */}
        <Liquid.Item
          x={fieldShiftX}
          y={0}
          transition={transitionConfig}
          className="absolute"
          style={{
            left: `${fieldBaseLeft}px`,
            top: `calc(50% - ${dims.fieldH / 2}px)`,
          }}
        >
          <div
            className="relative flex items-center"
            style={{
              width: `${dims.fieldW}px`,
              height: `${dims.fieldH}px`,
              borderRadius: "9999px",
            }}
          >
            <input
              ref={inputRef}
              type={inputType}
              value={text}
              maxLength={maxLength}
              disabled={disabled || status === "loading"}
              placeholder={
                status === "success"
                  ? successPlaceholder
                  : resting
                    ? ""
                    : placeholder
              }
              aria-label={fieldLabel}
              autoFocus={autoFocusField}
              onChange={(e) => {
                if (controlled) onValueChange?.(e.target.value);
                else setEmail(e.target.value);
                if (status === "error") setStatus("idle");
              }}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSubmit();
                }
              }}
              className={`w-full h-full bg-transparent border-0 outline-none px-5 rounded-full ${dims.fontSize} font-medium ${theme.text} ${theme.placeholder} transition-colors duration-200`}
            />
            {restPlaceholder !== undefined && (
              <AnimatePresence initial={false}>
                {resting && (
                  <motion.span
                    key="rest-label"
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 left-5 right-5 flex items-center justify-center overflow-hidden"
                    initial={{ opacity: 0, y: 8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -10, scale: 1.03 }}
                    transition={{ duration: 0.32, ease: "easeOut" }}
                  >
                    <span className="truncate text-sm font-semibold text-white">
                      {restPlaceholder}
                    </span>
                  </motion.span>
                )}
              </AnimatePresence>
            )}
          </div>
        </Liquid.Item>

        {/* 2. Submit Button Droplet Slot */}
        <Liquid.Item
          x={btnShiftX}
          y={0}
          transition={transitionConfig}
          className="absolute"
          style={{
            left: `${btnBaseLeft}px`,
            top: `calc(50% - ${dims.btnSize / 2}px)`,
          }}
        >
          <button
            type="button"
            disabled={disabled || status === "loading"}
            tabIndex={isFocused ? 0 : -1}
            aria-label={
              liveTick
                ? "Verified"
                : onDropletClick
                  ? dropletLabel
                  : submitLabel
            }
            onPointerDown={(e) => {
              // Prevent input blur before click finishes — but only once the
              // droplet is live; while hidden, taps must reach the input.
              if (isFocused) e.preventDefault();
            }}
            onClick={() => {
              // Hidden droplet is a funnel, not a control: any tap on its zone
              // focuses the field instead of falling through (or not) to the
              // input beneath, which the goo layering cannot be trusted with.
              if (!isFocused) {
                inputRef.current?.focus();
                return;
              }
              // A tick is a verdict, not a trigger: tapping it does nothing.
              // Generation stays on the explicit go actions (the header arrow,
              // Enter), never on admiring the confirmation.
              if (status === "loading" || liveChecking || liveTick) return;
              if (onDropletClick) {
                // Blur first so the capsule settles back to its resting face;
                // the caller clears (or collapses) underneath the merge.
                inputRef.current?.blur();
                onDropletClick();
              } else handleSubmit();
            }}
            className={`relative flex items-center justify-center rounded-full border-0 p-0 transition-all duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 ${theme.btnColor} ${isFocused ? `${theme.btnBg} cursor-pointer` : "cursor-text"} ${theme.accentRing}`}
            style={{
              width: `${dims.btnSize}px`,
              height: `${dims.btnSize}px`,
            }}
          >
            {/* `filter-none`, not `blur-0`: Tailwind's `blur-0` is still
                `filter: blur(0px)`, a non-none filter that survives the pulse
                and defeats any `backdrop-filter` this capsule is nested inside
                (the booklet composer's frosted search panel). */}
            <span
              className={`flex items-center justify-center transition-all duration-200 ${
                isFocused ? "opacity-100 scale-100" : "opacity-0 scale-75 pointer-events-none"
              } ${isPulsing ? "blur-[0.5px]" : "filter-none"}`}
              style={{
                transitionDelay: isFocused ? `${Math.round(duration * 0.15)}ms` : "0ms",
              }}
            >
              {renderIcon()}
            </span>
          </button>
        </Liquid.Item>
      </Liquid>

      {/* Error Message Tooltip / Toast below if invalid */}
      {errorMessage && (
        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-semibold text-rose-500 animate-in fade-in slide-in-from-top-1 duration-200">
          {errorMessage}
        </div>
      )}
    </div>
  );
}
