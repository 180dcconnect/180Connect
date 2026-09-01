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
}

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
}: GooeyTextInputProps) {
  const [prevDefaultValue, setPrevDefaultValue] = React.useState(defaultValue);
  const [value, setValue] = React.useState(defaultValue ?? "");
  const [isFocused, setIsFocused] = React.useState(false);
  const status = pending ? "loading" : "idle";
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isPulsing, setIsPulsing] = React.useState(false);

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

    const fieldW = fieldWidth ?? defaultFieldW;
    const fieldH = size === "sm" ? 42 : size === "lg" ? 52 : 48;
    const btnSize = size === "sm" ? 38 : size === "lg" ? 48 : 44;
    const fontSize = size === "sm" ? "text-xs" : size === "lg" ? "text-base" : "text-sm";
    const iconSize = size === "sm" ? 15 : size === "lg" ? 20 : 18;
    const totalW = Math.max(340, fieldW + btnSize + gap + 40);
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
  }, [size, fieldWidth, gap]);

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
    const form = inputRef.current?.closest("form");
    if (form) form.requestSubmit();
  };

  const transitionConfig: Transition = React.useMemo(() => {
    return {
      duration,
      ease,
    };
  }, [duration, ease]);

  // Position shifts: field shifts left, button shifts right for noticeable separation
  const fieldShiftX = isFocused ? -gap * 0.4 : 0;
  const btnShiftX = isFocused ? gap * 0.6 : 0;

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
  const fieldBaseLeft = centerLeft - dims.fieldW / 2 - 10;
  const btnBaseLeft = fieldBaseLeft + dims.fieldW - dims.btnSize;

  return (
    <div className={`relative inline-flex flex-col items-center select-none ${className}`}>
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
              placeholder={placeholder}
              onChange={(e) => {
                setValue(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  trySubmit();
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
