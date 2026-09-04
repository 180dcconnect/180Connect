"use client";

import * as React from "react";
import { Liquid, type Transition } from "liquid-gooey";
import { ArrowRight, Check, Loader2, Send, Sparkles } from "lucide-react";

export interface GooeyActionButtonProps {
  /** Text inside the capsule */
  label: React.ReactNode;
  /** Click / submit handler */
  onClick?: () => void;
  /** Color theme variant — same palette map as GooeyEmailInput */
  variant?: "dark" | "light" | "brand" | "glass" | "obsidian";
  /** Size preset */
  size?: "sm" | "md" | "lg";
  /** Blur sigma in px (default 6) */
  gooBlur?: number;
  /** Alpha contrast slope (default 13) */
  gooContrast?: number;
  /** Distance in px the droplet separates away when open (default 54) */
  gap?: number;
  /** Animation duration in ms (default 640) */
  duration?: number;
  /** Transition easing curve */
  ease?: string;
  /** Custom fill color for liquid capsule (overrides variant) */
  fillColor?: string;
  /** Custom box shadow string (overrides variant) */
  shadow?: string;
  /** Icon riding in the droplet */
  buttonIcon?: "arrow" | "send" | "sparkles";
  /**
   * Controlled separation. The email input buds its droplet on focus; a button
   * has no focus moment worth reacting to, so the caller decides — typically
   * "the form is valid". Leave undefined to fall back to hover/focus.
   */
  open?: boolean;
  /** Shows a spinner in the droplet and blocks further clicks */
  loading?: boolean;
  /** Shows a tick in the droplet */
  success?: boolean;
  /** Button type */
  type?: "button" | "submit";
  /** Form attribute, for a submit button rendered outside its form */
  form?: string;
  /** Class name for the outer wrapper */
  className?: string;
  /** Disabled state */
  disabled?: boolean;
}

const EASING_PRESETS: Record<string, string> = {
  Bouncy: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  Smooth: "cubic-bezier(0.3, 1.05, 0.4, 1)",
  Snappy: "cubic-bezier(0.22, 1, 0.36, 1)",
  Standard: "cubic-bezier(0.4, 0, 0.2, 1)",
};

/**
 * The GooeyEmailInput, with the input swapped for a label.
 *
 * Same liquid group, same two slots, same theme map — the capsule and the
 * droplet are both painted by the group's single `fill`, so the droplet is
 * never a separate accent colour. Only the icon carries the accent, exactly as
 * it does in the input.
 */
export function GooeyActionButton({
  label,
  onClick,
  variant = "obsidian",
  size = "md",
  gooBlur = 6,
  gooContrast = 13,
  gap = 54,
  duration = 640,
  ease = EASING_PRESETS.Standard,
  fillColor,
  shadow,
  buttonIcon = "arrow",
  open,
  loading = false,
  success = false,
  type = "button",
  form,
  className = "",
  disabled = false,
}: GooeyActionButtonProps) {
  const [isHot, setIsHot] = React.useState(false);
  const [isPulsing, setIsPulsing] = React.useState(false);
  const [labelW, setLabelW] = React.useState(0);

  const labelRef = React.useRef<HTMLSpanElement>(null);
  const isOpen = open ?? isHot;

  // Same brief icon cross-blur the input plays when the droplet moves
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
  }, [isOpen, duration]);

  // Dimensions based on size — the pill width is measured, not fixed, because
  // the label is caller-supplied and changes between states ("Send invitation"
  // vs "Sending invite…").
  const base = React.useMemo(() => {
    switch (size) {
      case "sm":
        return { pillH: 36, btnSize: 36, padX: 36, fontSize: "text-xs", iconSize: 15 };
      case "lg":
        return { pillH: 48, btnSize: 48, padX: 52, fontSize: "text-base", iconSize: 20 };
      case "md":
      default:
        return { pillH: 44, btnSize: 44, padX: 44, fontSize: "text-sm", iconSize: 18 };
    }
  }, [size]);

  React.useLayoutEffect(() => {
    const node = labelRef.current;
    if (!node) return;
    const measure = () => setLabelW(node.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [label, base.fontSize]);

  const pillW = Math.max(base.btnSize + 24, Math.ceil(labelW) + base.padX);

  // The group box hugs the travel envelope rather than reserving a fixed
  // margin, so the control can sit flush in a right-aligned footer. PAD is
  // only the slack the goo blur needs to bleed into.
  const PAD = 12;
  const pillBaseLeft = PAD + gap * 0.4;
  const btnBaseLeft = pillBaseLeft + pillW - base.btnSize;
  const totalW = pillBaseLeft + pillW + gap * 0.6 + PAD;
  const totalH = base.pillH + PAD * 2;

  const theme = React.useMemo(() => {
    switch (variant) {
      case "obsidian":
        return {
          fill: fillColor ?? "#161b21",
          shadow:
            shadow ??
            "0 0 0 1px rgba(230, 245, 192, 0.22) inset, inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 10px 30px -6px rgba(0, 0, 0, 0.7)",
          text: "text-[#f4f4ef]",
          textHover: "text-white",
          pillHoverBg: "bg-white/[0.08]",
          btnColor: "text-[#e6f5c0]",
          btnColorHover: "text-[#f4fcd9]",
          btnHoverBg: "bg-[#e6f5c0]/15",
          accentRing: "focus-visible:ring-[#e6f5c0]/50",
        };
      case "dark":
        return {
          fill: fillColor ?? "#1e1e24",
          shadow:
            shadow ??
            "0 0 0 1px rgba(255, 255, 255, 0.08) inset, 0 8px 24px -4px rgba(0, 0, 0, 0.6)",
          text: "text-neutral-100",
          textHover: "text-white",
          pillHoverBg: "bg-white/[0.08]",
          btnColor: "text-neutral-100",
          btnColorHover: "text-white",
          btnHoverBg: "bg-white/12",
          accentRing: "focus-visible:ring-white/40",
        };
      case "light":
        return {
          fill: fillColor ?? "#ffffff",
          shadow:
            shadow ??
            "0 0 0 1px rgba(0, 0, 0, 0.08), 0 2px 6px -1px rgba(0, 0, 0, 0.06), 0 12px 28px -4px rgba(0, 0, 0, 0.1)",
          text: "text-neutral-900",
          textHover: "text-black",
          pillHoverBg: "bg-black/[0.05]",
          btnColor: "text-neutral-900",
          btnColorHover: "text-black",
          btnHoverBg: "bg-black/[0.08]",
          accentRing: "focus-visible:ring-neutral-900/30",
        };
      case "glass":
        return {
          fill: fillColor ?? "rgba(255, 255, 255, 0.9)",
          shadow:
            shadow ??
            "0 0 0 1px rgba(255, 255, 255, 0.6) inset, 0 0 0 1px rgba(0, 0, 0, 0.06), 0 8px 32px 0 rgba(0, 0, 0, 0.08)",
          text: "text-neutral-900",
          textHover: "text-black",
          pillHoverBg: "bg-black/[0.05]",
          btnColor: "text-neutral-900",
          btnColorHover: "text-black",
          btnHoverBg: "bg-black/[0.08]",
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
          textHover: "text-white",
          pillHoverBg: "bg-white/[0.08]",
          btnColor: "text-[#e6f5c0]",
          btnColorHover: "text-[#f4fcd9]",
          btnHoverBg: "bg-[#e6f5c0]/15",
          accentRing: "focus-visible:ring-[#e6f5c0]/50",
        };
    }
  }, [variant, fillColor, shadow]);

  const transitionConfig: Transition = React.useMemo(
    () => ({ duration, ease }),
    [duration, ease],
  );

  const pillShiftX = isOpen ? -gap * 0.4 : 0;
  const btnShiftX = isOpen ? gap * 0.6 : 0;

  const renderIcon = () => {
    if (loading) return <Loader2 className="animate-spin" size={base.iconSize} />;
    if (success) return <Check className="text-emerald-500" size={base.iconSize} />;
    switch (buttonIcon) {
      case "send":
        return <Send size={base.iconSize} className="ml-0.5" />;
      case "sparkles":
        return <Sparkles size={base.iconSize} />;
      case "arrow":
      default:
        return <ArrowRight size={base.iconSize} />;
    }
  };

  const isBlocked = disabled || loading;
  const isHovered = isHot && !isBlocked;

  const fire = () => {
    if (isBlocked) return;
    onClick?.();
  };

  return (
    <div
      className={`relative inline-flex flex-col items-center select-none ${className}`}
      onMouseEnter={() => setIsHot(true)}
      onMouseLeave={() => setIsHot(false)}
    >
      {/* Off-flow measurer: same type styles as the real label, so the pill
          width tracks the text without hardcoding a size per label. */}
      <span
        ref={labelRef}
        aria-hidden="true"
        className={`pointer-events-none invisible absolute whitespace-nowrap font-medium ${base.fontSize}`}
      >
        {label}
      </span>

      <Liquid
        blur={gooBlur}
        contrast={gooContrast}
        fill={theme.fill}
        shadow={theme.shadow}
        className="relative flex items-center justify-center"
        style={{ width: `${totalW}px`, height: `${totalH}px` }}
      >
        {/* 1. Label Capsule Slot */}
        <Liquid.Item
          x={pillShiftX}
          y={0}
          transition={transitionConfig}
          className="absolute"
          style={{
            left: `${pillBaseLeft}px`,
            top: `calc(50% - ${base.pillH / 2}px)`,
          }}
        >
          <button
            type={type}
            form={form}
            disabled={isBlocked}
            onClick={fire}
            onFocus={() => setIsHot(true)}
            onBlur={() => setIsHot(false)}
            className={`flex items-center justify-center rounded-full border-0 px-5 ${base.fontSize} font-medium ${
              isHovered ? `${theme.textHover} ${theme.pillHoverBg}` : `${theme.text} bg-transparent`
            } ${theme.accentRing} transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 ${
              isBlocked ? "cursor-not-allowed opacity-55" : "cursor-pointer active:scale-[0.98]"
            }`}
            style={{ width: `${pillW}px`, height: `${base.pillH}px` }}
          >
            <span className="whitespace-nowrap">{label}</span>
          </button>
        </Liquid.Item>

        {/* 2. Droplet Slot — decorative twin of the pill, not a second tab stop */}
        <Liquid.Item
          x={btnShiftX}
          y={0}
          transition={transitionConfig}
          className="absolute"
          style={{
            left: `${btnBaseLeft}px`,
            top: `calc(50% - ${base.btnSize / 2}px)`,
          }}
        >
          <button
            type={type}
            form={form}
            tabIndex={-1}
            aria-hidden="true"
            disabled={isBlocked}
            onPointerDown={(e) => e.preventDefault()}
            onClick={fire}
            className={`relative flex items-center justify-center rounded-full border-0 p-0 ${
              isHovered ? `${theme.btnColorHover} ${theme.btnHoverBg}` : `${theme.btnColor} bg-transparent`
            } transition-all duration-200 focus-visible:outline-none ${
              isBlocked ? "cursor-not-allowed" : "cursor-pointer active:scale-95"
            }`}
            style={{ width: `${base.btnSize}px`, height: `${base.btnSize}px` }}
          >
            <span
              className={`flex items-center justify-center transition-all duration-200 ${
                isOpen ? "scale-100 opacity-100" : "pointer-events-none scale-75 opacity-0"
              } ${isPulsing ? "blur-[0.5px]" : "blur-0"}`}
              style={{ transitionDelay: isOpen ? `${Math.round(duration * 0.15)}ms` : "0ms" }}
            >
              {renderIcon()}
            </span>
          </button>
        </Liquid.Item>
      </Liquid>
    </div>
  );
}
