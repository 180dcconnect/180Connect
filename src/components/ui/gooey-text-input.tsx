"use client";

import * as React from "react";
import { Liquid, type Transition } from "liquid-gooey";
import { ArrowRight, Check, Loader2, Send, Sparkles } from "lucide-react";

/**
 * Word-for-word adaptation of GooeyEmailInput (see gooey-email-input.tsx and
 * /preview-gooey) for plain text values inside a server-action form.
 * The liquid droplet button submits the enclosing <form>; the visible input
 * is controlled, so the value rides along in a hidden input under `name`.
 */
export interface GooeyTextInputProps {
  /** Form field name — value is mirrored into a hidden input */
  name: string;
  /** Initial/default value for the input */
  defaultValue?: string;
  /** Placeholder text for the input */
  placeholder?: string;
  /** Color theme variant */
  variant?: "dark" | "light" | "brand" | "glass";
  /** Size preset */
  size?: "sm" | "md" | "lg" | "xl" | "full";
  /** Custom input field width in px (overrides size preset) */
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
  buttonIcon?: "arrow" | "send" | "sparkles" | "check";
  /** Class name for the outer wrapper */
  className?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Form is pending (server action in flight) — shows spinner */
  pending?: boolean;
  /**
   * Floating label, in the pattern the sign-in fields use: it sits inside the
   * capsule as the placeholder while the field is empty, and rides up onto the
   * capsule's top edge once there is a value or focus. Supplying it replaces
   * `placeholder` — two pieces of resting text in one field is one too many.
   */
  label?: string;
  /**
   * Where the text capsule rests inside the widget. The widget is deliberately
   * wider than the capsule so the submit droplet has somewhere to fly to on
   * focus; centring the capsule inside that spare width leaves a gap on the
   * left that no other field in a form has, so a field stacked under labelled
   * inputs wants `start` and the padding all on the droplet's side.
   */
  align?: "center" | "start";
  /**
   * Sizes the capsule from the container it lands in rather than from the
   * `size` preset. The presets are fixed pixels, and the dialogs around them
   * are rem-based, so the same form drawn at a different browser zoom or root
   * font size put the capsule and the form's other controls on different left
   * edges — visible the moment the app was opened on a second display. Fluid,
   * it is the width of whatever holds it, minus the room the droplet needs.
   */
  fluid?: boolean;
  /**
   * Hard cap on the value, matching whatever the column will accept. Without it
   * the field happily collects 400 characters for a 200-character column and
   * the news arrives from a rejected submission.
   */
  maxLength?: number;
  /**
   * What the droplet does instead of submitting the enclosing form. A field
   * inside a multi-row editor has no form of its own to post — the droplet is
   * still "send", it just sends the batch.
   */
  onSubmit?: () => void;
  /** Mirrors every keystroke out, for a parent holding the draft. */
  onValueChange?: (next: string) => void;
  /** Escape while focused — abandon this field. */
  onEscape?: () => void;
}

/**
 * Slack on each side of a fluid widget, so the goo filter has somewhere to
 * paint. Pulled back off with a negative margin — it is bleed, not padding.
 */
const FLUID_BLEED = 14;

const EASING_PRESETS: Record<string, string> = {
  Bouncy: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  Smooth: "cubic-bezier(0.3, 1.05, 0.4, 1)",
  Snappy: "cubic-bezier(0.22, 1, 0.36, 1)",
  Standard: "cubic-bezier(0.4, 0, 0.2, 1)",
};

export function GooeyTextInput({
  name,
  defaultValue = "",
  placeholder = "Enter a value...",
  variant = "light",
  size = "md",
  fieldWidth,
  gooBlur = 6,
  gooContrast = 14,
  gap = 54,
  duration = 640,
  ease = EASING_PRESETS.Standard,
  fillColor,
  shadow,
  buttonIcon = "arrow",
  className = "",
  disabled = false,
  pending = false,
  label,
  align = "center",
  fluid = false,
  maxLength,
  onSubmit,
  onValueChange,
  onEscape,
}: GooeyTextInputProps) {
  const [prevDefaultValue, setPrevDefaultValue] = React.useState(defaultValue);
  const [value, setValue] = React.useState(defaultValue ?? "");
  const [isFocused, setIsFocused] = React.useState(false);
  const status = pending ? "loading" : "idle";
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isPulsing, setIsPulsing] = React.useState(false);

  // Fluid sizing: the widget is absolutely positioned inside a fixed-pixel box,
  // so it cannot be sized in CSS — it has to be told how much room it has.
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = React.useState(0);
  const isFluid = fluid && containerWidth > 0;

  React.useEffect(() => {
    if (!fluid) return;
    const node = wrapperRef.current?.parentElement;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [fluid]);

  // The label is up whenever the field is not resting-and-empty, so it never
  // covers typed text and never floats over nothing.
  const isFloated = isFocused || value.length > 0;

  // Sync value during render if defaultValue prop changes
  if (defaultValue !== prevDefaultValue) {
    setPrevDefaultValue(defaultValue);
    setValue(defaultValue ?? "");
  }

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

  // Dimensions based on size and optional custom fieldWidth
  const dims = React.useMemo(() => {
    const defaultFieldW = (() => {
      switch (size) {
        case "full":
          return 360;
        case "xl":
          return 330;
        case "lg":
          return 270;
        case "sm":
          return 190;
        case "md":
        default:
          return 240;
      }
    })();

    // The droplet rests at the capsule's right edge and travels `gap` beyond
    // it, so the room the widget needs is the capsule plus the gap — that is
    // what comes back out of the container width.
    const fluidFieldW = Math.max(200, containerWidth - gap);
    const fieldW = fluid && containerWidth > 0 ? fluidFieldW : (fieldWidth ?? defaultFieldW);
    const fieldH = size === "sm" ? 42 : size === "lg" ? 52 : 48;
    const btnSize = size === "sm" ? 38 : size === "lg" ? 48 : 44;
    const fontSize = size === "sm" ? "text-xs" : size === "lg" ? "text-base" : "text-sm";
    const iconSize = size === "sm" ? 15 : size === "lg" ? 20 : 18;
    // The goo filter is a blur-then-contrast pass: the silhouette it paints
    // spreads a few pixels past the shape that fed it. Sized to exactly the
    // container, the droplet's own fill fell outside the filter box and got
    // clipped away at the right edge — the icon still drew (it is unfiltered)
    // but the white capsule under it did not, so the button arrived invisible.
    // The widget is given bleed on both sides and pulled back by the same
    // amount, so the capsule still starts on the container's left edge.
    const totalW =
      fluid && containerWidth > 0
        ? containerWidth + FLUID_BLEED * 2
        : Math.max(340, fieldW + btnSize + gap + 40);
    const totalH = size === "sm" ? 74 : size === "lg" ? 92 : 84;

    return {
      fieldW,
      fieldH,
      btnSize,
      fontSize,
      iconSize,
      totalW,
      totalH,
    };
  }, [size, fieldWidth, gap, fluid, containerWidth]);

  // Variant themes
  const theme = React.useMemo(() => {
    switch (variant) {
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
          labelResting: "text-neutral-500",
          labelFloated: "text-neutral-300",
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
          labelResting: "text-neutral-400",
          labelFloated: "text-neutral-500",
        };
      case "brand":
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
          labelResting: "text-[#f5f5f0]/40",
          labelFloated: "text-[#f5f5f0]/60",
        };
      case "light":
      default:
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
          labelResting: "text-neutral-400",
          labelFloated: "text-neutral-500",
        };
    }
  }, [variant, fillColor, shadow]);

  // Validate, then submit the enclosing form (server action)
  const trySubmit = () => {
    if (pending || disabled) return;
    if (!value.trim()) {
      setErrorMessage("Please enter a value");
      setTimeout(() => setErrorMessage(null), 2500);
      return;
    }
    if (onSubmit) {
      onSubmit();
      return;
    }
    const form = inputRef.current?.closest("form");
    if (form) form.requestSubmit();
  };

  const transitionConfig: Transition = React.useMemo(() => {
    return {
      duration,
      ease,
    };
  }, [duration, ease]);

  // The separation is the droplet's job alone. Splitting it — field left 40%,
  // button right 60% — meant focusing the field slid the thing you were about
  // to type into sideways, and in a stacked form it also broke the left edge it
  // shares with every other control. The capsule is furniture; it stays put,
  // and the droplet travels the whole gap.
  const fieldShiftX = 0;
  const btnShiftX = isFocused ? gap : 0;

  // Compute icon to display
  const renderIcon = () => {
    if (status === "loading") {
      return <Loader2 className="animate-spin" size={dims.iconSize} />;
    }
    switch (buttonIcon) {
      case "send":
        return <Send size={dims.iconSize} className="ml-0.5" />;
      case "sparkles":
        return <Sparkles size={dims.iconSize} />;
      case "check":
        return <Check size={dims.iconSize} />;
      case "arrow":
      default:
        return <ArrowRight size={dims.iconSize} />;
    }
  };

  // Fixed resting center reference for both slots
  const centerLeft = dims.totalW / 2;
  const fieldBaseLeft =
    align === "start"
      ? isFluid
        ? FLUID_BLEED
        : 0
      : centerLeft - dims.fieldW / 2 - 10;
  const btnBaseLeft = fieldBaseLeft + dims.fieldW - dims.btnSize;

  return (
    <div
      ref={wrapperRef}
      className={`relative flex flex-col select-none ${
        fluid ? "w-full items-stretch" : "inline-flex items-center"
      } ${className}`}
      style={isFluid ? { marginLeft: -FLUID_BLEED, marginRight: -FLUID_BLEED } : undefined}
    >
      {/* Hidden input carries the value into the server-action form */}
      <input type="hidden" name={name} value={value} />

      {/* Liquid Gooey Container */}
      <Liquid
        blur={gooBlur}
        contrast={gooContrast}
        fill={theme.fill}
        shadow={theme.shadow}
        className="relative flex items-center justify-center"
        style={{
          width: `${dims.totalW}px`,
          height: `${dims.totalH}px`,
        }}
      >
        {/* 1. Text Input Capsule Slot */}
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
            {label && (
              /* Not the peer-CSS trick the sign-in fields use: this input's
                 emptiness is already state here, and `:placeholder-shown`
                 cannot see the space we would have to put in the placeholder
                 to keep it. Same movement, same two type treatments. */
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute z-10 origin-left transition-all duration-200 ease-out ${
                  isFloated
                    ? `left-4 top-0 -translate-y-1/2 rounded-full px-1.5 text-[11px] font-bold uppercase tracking-[0.12em] ${theme.labelFloated}`
                    : `left-5 top-1/2 -translate-y-1/2 ${dims.fontSize} font-medium ${theme.labelResting}`
                }`}
                style={isFloated ? { backgroundColor: theme.fill } : undefined}
              >
                {label}
              </span>
            )}

            <input
              ref={inputRef}
              type="text"
              value={value}
              title={value}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={disabled || pending}
              maxLength={maxLength}
              placeholder={label ? undefined : placeholder}
              aria-label={label}
              onChange={(e) => {
                setValue(e.target.value);
                onValueChange?.(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  trySubmit();
                }
                if (e.key === "Escape" && onEscape) {
                  e.preventDefault();
                  onEscape();
                }
              }}
              className={`w-full h-full bg-transparent border-0 outline-none px-5 rounded-full ${dims.fontSize} font-medium ${theme.text} ${theme.placeholder} transition-colors duration-200`}
            />
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
            disabled={disabled || pending}
            tabIndex={isFocused ? 0 : -1}
            aria-label="Submit value"
            onPointerDown={(e) => {
              // Prevent input blur before click finishes
              e.preventDefault();
            }}
            onClick={() => trySubmit()}
            className={`relative flex items-center justify-center rounded-full border-0 p-0 cursor-pointer ${theme.btnColor} ${theme.btnBg} ${theme.accentRing} focus-visible:outline-none focus-visible:ring-2 transition-all duration-200 active:scale-95`}
            style={{
              width: `${dims.btnSize}px`,
              height: `${dims.btnSize}px`,
            }}
          >
            <span
              className={`flex items-center justify-center transition-all duration-200 ${
                isFocused ? "opacity-100 scale-100" : "opacity-0 scale-75 pointer-events-none"
              } ${isPulsing ? "blur-[0.5px]" : "blur-0"}`}
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
