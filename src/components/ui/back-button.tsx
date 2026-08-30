"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import {
  ArrowLeft,
  ChevronLeft,
  MoveLeft,
  CornerUpLeft,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LIP } from "@/components/brand/tokens";
import { LIFT } from "@/components/brand/motion";

export type BackButtonVariant =
  | "sliding-door"       // Sliding icon chamber (expanding 1/4 to 100% on hover)
  | "signature-dual"     // 180Connect signature tangent disc + label capsule
  | "glass-capsule"      // Specular frosted glass capsule with top lip highlight
  | "editorial-minimal"  // High-fashion editorial type with sliding underline sweep
  | "radial-wash"        // Origin radial expansion hover fill
  | "tactile-puck"       // Squircle icon tile + fluid text
  | "breadcrumb-peek"    // Parent section badge + shortcut tag + title reveal
  | "floating-disc"      // Dynamic morphing circle with expandable label
  | "neo-brutalist";     // Offset hard shadow & physical press feedback

export type BackButtonTone = "light" | "dark" | "glass" | "bone" | "brand";
export type BackButtonSize = "sm" | "md" | "lg";
export type BackButtonIcon = "arrow" | "chevron" | "long-arrow" | "corner" | "undo";

export interface BackButtonProps {
  /** Optional navigation target. If omitted, falls back to `onClick` or `router.back()` */
  href?: string;
  /** Optional secondary destination name for breadcrumb/peek style */
  destination?: string;
  /** Custom click handler. If neither `href` nor `onClick` is provided, triggers browser back */
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  /** Primary label text. Defaults to "Back" */
  label?: React.ReactNode;
  /** Visual design variant */
  variant?: BackButtonVariant;
  /** Surface tone / color theme */
  tone?: BackButtonTone;
  /** Size scale */
  size?: BackButtonSize;
  /** Which icon glyph to render */
  icon?: BackButtonIcon;
  /** Whether to display a keyboard shortcut badge (e.g. ⌘[ or Esc) */
  shortcut?: string;
  /** Optional extra classes */
  className?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Loading state */
  loading?: boolean;
  /** Accessible label */
  "aria-label"?: string;
  /** Custom children */
  children?: React.ReactNode;
}

/** Render appropriate arrow icon based on prop */
function renderArrowIcon(icon: BackButtonIcon, className?: string, size = 16) {
  switch (icon) {
    case "chevron":
      return <ChevronLeft className={cn("shrink-0", className)} size={size} strokeWidth={2.2} aria-hidden="true" />;
    case "long-arrow":
      return <MoveLeft className={cn("shrink-0", className)} size={size} strokeWidth={2} aria-hidden="true" />;
    case "corner":
      return <CornerUpLeft className={cn("shrink-0", className)} size={size} strokeWidth={2} aria-hidden="true" />;
    case "undo":
      return <Undo2 className={cn("shrink-0", className)} size={size} strokeWidth={2} aria-hidden="true" />;
    case "arrow":
    default:
      return <ArrowLeft className={cn("shrink-0", className)} size={size} strokeWidth={2.2} aria-hidden="true" />;
  }
}

/**
 * High-precision, polymorphic BackButton component with multiple distinct
 * design variants adhering to 180Connect design system guidelines and shadcn standards.
 */
export const BackButton = React.forwardRef<HTMLElement, BackButtonProps>(
  (
    {
      href,
      onClick,
      label = "Back",
      variant = "sliding-door",
      tone = "bone",
      size = "md",
      icon = "arrow",
      shortcut,
      className,
      disabled = false,
      loading = false,
      "aria-label": ariaLabelProp,
      children,
    },
    ref
  ) => {
    const router = useRouter();

    const handleClick = (e: React.MouseEvent<HTMLElement>) => {
      if (disabled || loading) {
        e.preventDefault();
        return;
      }
      if (onClick) {
        onClick(e);
        return;
      }
      if (!href) {
        e.preventDefault();
        router.back();
      }
    };

    const accessibleLabel =
      ariaLabelProp ||
      (typeof label === "string" ? label : "Go back");

    // Size scale configurations
    const sizeConfig = {
      sm: {
        height: "h-8",
        px: "px-3",
        text: "text-xs",
        discSize: "size-8",
        iconSize: "size-3.5",
        gap: "gap-1.5",
      },
      md: {
        height: "h-9",
        px: "px-4",
        text: "text-sm",
        discSize: "size-9",
        iconSize: "size-4",
        gap: "gap-2",
      },
      lg: {
        height: "h-11",
        px: "px-5",
        text: "text-[15px]",
        discSize: "size-11",
        iconSize: "size-4.5",
        gap: "gap-2.5",
      },
    }[size];

    // Shared wrapper props
    const commonProps = {
      ref,
      onClick: handleClick,
      "aria-label": accessibleLabel,
      "aria-disabled": disabled,
      role: href ? undefined : "button",
      tabIndex: disabled ? -1 : 0,
      className: cn(
        "group relative select-none inline-flex items-center outline-none focus-visible:ring-2 focus-visible:ring-offset-2 transition-all",
        disabled && "opacity-45 pointer-events-none cursor-not-allowed",
        className
      ),
    };

    // ──────────────────────────────────────────────────────────────────────────
    // VARIANT 0: Sliding Door Chamber (Tailored 180Connect Aesthetics)
    // ──────────────────────────────────────────────────────────────────────────
    if (variant === "sliding-door") {
      const isDark = tone === "dark" || tone === "glass";
      const isBrand = tone === "brand";

      // Base capsule colors
      const baseCapsuleClass = isDark
        ? "bg-white/[0.08] text-white ring-1 ring-white/15 backdrop-blur-xl hover:ring-white/30 hover:bg-white/[0.12]"
        : isBrand
        ? "bg-brand/10 text-brand border border-brand/25 hover:border-brand/40"
        : "bg-white text-[#0c1014] border border-black/[0.08] shadow-xs hover:border-black/20 hover:shadow-md";

      // Chamber at rest & expanding on hover
      const chamberClass = isDark
        ? "bg-white/[0.12] text-white/90 group-hover:bg-[#e6f5c0] group-hover:text-[#0c1014] group-hover:shadow-md"
        : isBrand
        ? "bg-brand/15 text-brand group-hover:bg-brand group-hover:text-white group-hover:shadow-md"
        : "bg-black/[0.05] text-[#0c1014]/75 group-hover:bg-[#0c1014] group-hover:text-white group-hover:shadow-md";

      const heightClass = size === "sm" ? "h-8 min-w-[80px]" : size === "lg" ? "h-11 min-w-[110px]" : "h-9 min-w-[95px]";

      return (
        <Wrapper href={href} {...commonProps}>
          <div
            className={cn(
              "group relative overflow-hidden rounded-md font-bold transition-all duration-300 flex items-center justify-center cursor-pointer",
              heightClass,
              sizeConfig.text,
              baseCapsuleClass,
              className
            )}
            style={{
              boxShadow: isDark
                ? "inset 0 1px 0 rgba(255, 255, 255, 0.25)"
                : "inset 0 1px 0 rgba(255, 255, 255, 0.9)",
            }}
          >
            {/* Label text that fades smoothly on hover */}
            <span className="w-full text-center pl-5 pr-2.5 translate-x-1.5 transition-all duration-300 group-hover:opacity-0 group-hover:scale-95 flex items-center justify-center">
              {children || label}
            </span>

            {/* Sliding chamber with icon */}
            <i
              className={cn(
                "absolute inset-0 z-10 grid w-1/4 place-items-center transition-all duration-300 ease-out group-hover:w-full",
                chamberClass
              )}
            >
              {renderArrowIcon(
                icon,
                "transition-transform duration-300 group-hover:-translate-x-0.5",
                size === "sm" ? 14 : size === "lg" ? 18 : 16
              )}
            </i>
          </div>
        </Wrapper>
      );
    }

    // ──────────────────────────────────────────────────────────────────────────
    // VARIANT 1: Signature Dual-Capsule (Brand Disc + Tangent Pill)
    // ──────────────────────────────────────────────────────────────────────────
    if (variant === "signature-dual") {
      const isDark = tone === "dark";
      const isGlass = tone === "glass";

      const discBg = isDark
        ? "bg-white/[0.08] text-white border border-white/15"
        : isGlass
        ? "bg-black/60 text-white backdrop-blur-md ring-1 ring-white/20"
        : "bg-[#0c1014] text-white shadow-sm";

      const pillBg = isDark
        ? "bg-white/[0.06] text-white/90 border border-white/10"
        : isGlass
        ? "bg-black/40 text-[#f4f4ef] backdrop-blur-md ring-1 ring-white/15"
        : "bg-white text-[#0c1014] border border-black/[0.08] shadow-xs";

      const hoverWash = isDark
        ? "bg-white text-[#0c1014]"
        : "bg-[#e6f5c0] text-[#0c1014]";

      return (
        <Wrapper href={href} {...commonProps}>
          <motion.div
            className="flex items-center gap-1"
            whileHover={{ y: -1.5 }}
            whileTap={{ scale: 0.98 }}
            transition={LIFT}
          >
            {/* Left Disc */}
            <div
              className={cn(
                "relative flex items-center justify-center rounded-full overflow-hidden transition-all duration-300",
                sizeConfig.discSize,
                discBg,
                "group-hover:bg-[#e6f5c0] group-hover:text-[#0c1014] group-hover:border-[#e6f5c0]"
              )}
              style={{ boxShadow: isGlass ? LIP : undefined }}
            >
              {/* Arrow with dart-in animation */}
              <span className="relative z-10 transition-transform duration-300 ease-out group-hover:-translate-x-0.5">
                {renderArrowIcon(icon, sizeConfig.iconSize)}
              </span>
            </div>

            {/* Right Tangent Label Capsule */}
            <div
              className={cn(
                "relative flex items-center overflow-hidden rounded-full font-bold transition-all duration-300",
                sizeConfig.height,
                sizeConfig.px,
                sizeConfig.text,
                pillBg
              )}
              style={{ boxShadow: isGlass ? LIP : undefined }}
            >
              {/* Animated wash overlay that sweeps in on hover */}
              <span
                className={cn(
                  "pointer-events-none absolute inset-0 -translate-x-full transition-transform duration-300 ease-out group-hover:translate-x-0",
                  hoverWash
                )}
              />

              <span className="relative z-10 flex items-center gap-1.5 transition-colors duration-300 group-hover:text-[#0c1014]">
                <span>{children || label}</span>
                {shortcut && (
                  <kbd className="ml-1 rounded px-1 py-0.5 text-[10px] font-mono uppercase bg-black/10 text-current">
                    {shortcut}
                  </kbd>
                )}
              </span>
            </div>
          </motion.div>
        </Wrapper>
      );
    }

    // ──────────────────────────────────────────────────────────────────────────
    // VARIANT 2: Specular Floating Glass Capsule
    // ──────────────────────────────────────────────────────────────────────────
    if (variant === "glass-capsule") {
      const isDark = tone === "dark";
      return (
        <Wrapper href={href} {...commonProps}>
          <motion.div
            className={cn(
              "relative flex items-center rounded-full backdrop-blur-xl transition-all duration-300",
              sizeConfig.height,
              sizeConfig.px,
              sizeConfig.gap,
              sizeConfig.text,
              isDark
                ? "bg-white/[0.08] text-white ring-1 ring-white/15 hover:bg-white/[0.16] hover:ring-white/30"
                : "bg-white/80 text-foreground ring-1 ring-black/[0.08] shadow-xs hover:bg-white hover:ring-black/15 hover:shadow-md",
              "focus-visible:ring-brand/50"
            )}
            style={{
              boxShadow: isDark
                ? "inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 4px 12px rgba(0,0,0,0.2)"
                : "inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 2px 8px rgba(0,0,0,0.04)",
            }}
            whileHover={{ y: -1.5, scale: 1.01 }}
            whileTap={{ scale: 0.97, y: 0 }}
            transition={LIFT}
          >
            <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-black/[0.05] dark:bg-white/[0.1] transition-transform duration-200 group-hover:-translate-x-0.5 group-hover:bg-brand/15 group-hover:text-brand">
              {renderArrowIcon(icon, "size-3.5")}
            </div>

            <span className="font-semibold tracking-[-0.01em]">{children || label}</span>

            {shortcut && (
              <kbd className="ml-0.5 rounded-md border border-black/10 dark:border-white/15 bg-black/[0.03] dark:bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-mono font-medium text-foreground/60 dark:text-white/60">
                {shortcut}
              </kbd>
            )}
          </motion.div>
        </Wrapper>
      );
    }

    // ──────────────────────────────────────────────────────────────────────────
    // VARIANT 3: Editorial Minimalist (Stem Arrow & Sliding Underline Wipe)
    // ──────────────────────────────────────────────────────────────────────────
    if (variant === "editorial-minimal") {
      const isDark = tone === "dark";
      return (
        <Wrapper href={href} {...commonProps}>
          <div
            className={cn(
              "relative inline-flex items-center gap-2 py-1 transition-colors duration-200",
              isDark ? "text-white/80 hover:text-white" : "text-foreground/80 hover:text-foreground",
              sizeConfig.text
            )}
          >
            <span className="shrink-0 transition-transform duration-300 ease-out group-hover:-translate-x-1">
              {renderArrowIcon(icon, sizeConfig.iconSize)}
            </span>

            <span className="font-bold tracking-[0.04em] uppercase text-[11px] sm:text-xs">
              {children || label}
            </span>

            {shortcut && (
              <span className="text-[10px] font-mono opacity-40 group-hover:opacity-70 transition-opacity">
                [{shortcut}]
              </span>
            )}

            {/* Sliding underline sweep */}
            <span
              className={cn(
                "absolute bottom-0 left-0 h-[1.5px] w-full origin-right scale-x-0 transition-transform duration-300 ease-out group-hover:origin-left group-hover:scale-x-100",
                isDark ? "bg-white" : "bg-brand"
              )}
            />
          </div>
        </Wrapper>
      );
    }

    // ──────────────────────────────────────────────────────────────────────────
    // VARIANT 4: Origin Radial Expansion Wash
    // ──────────────────────────────────────────────────────────────────────────
    if (variant === "radial-wash") {
      const isDark = tone === "dark";
      return (
        <Wrapper href={href} {...commonProps}>
          <motion.div
            className={cn(
              "relative overflow-hidden rounded-full font-bold transition-all duration-300",
              sizeConfig.height,
              sizeConfig.px,
              sizeConfig.gap,
              sizeConfig.text,
              isDark
                ? "bg-[#161b21] text-white border border-white/10"
                : "bg-white text-foreground border border-black/[0.08] shadow-xs"
            )}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.98 }}
            transition={LIFT}
          >
            {/* Radial wash layer that expands on hover */}
            <span
              className={cn(
                "pointer-events-none absolute inset-0 -z-0 scale-0 rounded-full transition-transform duration-500 ease-out group-hover:scale-150",
                isDark ? "bg-white/15" : "bg-[#e6f5c0]"
              )}
              style={{ transformOrigin: "left center" }}
            />

            <span className="relative z-10 flex items-center gap-2">
              <span className="transition-transform duration-300 ease-out group-hover:-translate-x-1 text-brand dark:text-[#e6f5c0]">
                {renderArrowIcon(icon, sizeConfig.iconSize)}
              </span>
              <span>{children || label}</span>
            </span>
          </motion.div>
        </Wrapper>
      );
    }

    // ──────────────────────────────────────────────────────────────────────────
    // VARIANT 5: Tactile Squircle Puck & Label
    // ──────────────────────────────────────────────────────────────────────────
    if (variant === "tactile-puck") {
      const isDark = tone === "dark";
      return (
        <Wrapper href={href} {...commonProps}>
          <motion.div
            className={cn(
              "flex items-center gap-2.5 rounded-2xl p-1 pr-3 transition-all duration-200",
              isDark
                ? "hover:bg-white/[0.08] text-white"
                : "hover:bg-black/[0.05] text-foreground"
            )}
            whileHover={{ x: -2 }}
            whileTap={{ scale: 0.97 }}
            transition={LIFT}
          >
            {/* Squircle Puck */}
            <div
              className={cn(
                "flex shrink-0 items-center justify-center rounded-xl transition-all duration-300",
                size === "sm" ? "size-7" : size === "lg" ? "size-9" : "size-8",
                isDark
                  ? "bg-white/10 text-white group-hover:bg-brand group-hover:text-white"
                  : "bg-black/[0.06] text-foreground group-hover:bg-brand group-hover:text-white group-hover:shadow-sm"
              )}
            >
              <span className="transition-transform duration-200 group-hover:-translate-x-0.5">
                {renderArrowIcon(icon, sizeConfig.iconSize)}
              </span>
            </div>

            {/* Text Stack */}
            <div className="flex flex-col text-left">
              <span className={cn("font-bold leading-tight", sizeConfig.text)}>
                {children || label}
              </span>
            </div>

            {shortcut && (
              <kbd className="ml-1 rounded border border-black/10 dark:border-white/15 px-1 text-[10px] font-mono text-foreground/50 dark:text-white/50">
                {shortcut}
              </kbd>
            )}
          </motion.div>
        </Wrapper>
      );
    }

    // ──────────────────────────────────────────────────────────────────────────
    // VARIANT 6: Segmented Breadcrumb "History Peeker"
    // ──────────────────────────────────────────────────────────────────────────
    if (variant === "breadcrumb-peek") {
      const isDark = tone === "dark";
      return (
        <Wrapper href={href} {...commonProps}>
          <motion.div
            className={cn(
              "flex items-center rounded-full p-1 border transition-all duration-300",
              sizeConfig.text,
              isDark
                ? "bg-black/40 border-white/10 text-white backdrop-blur-md hover:border-white/20"
                : "bg-white/90 border-black/[0.08] text-foreground shadow-xs hover:border-black/15 hover:shadow-sm"
            )}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.98 }}
            transition={LIFT}
          >
            {/* Left Action Icon Pill */}
            <div
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-1 font-bold text-xs transition-colors",
                isDark
                  ? "bg-white/10 group-hover:bg-[#e6f5c0] group-hover:text-[#0c1014]"
                  : "bg-black/[0.06] group-hover:bg-[#e6f5c0] group-hover:text-[#0c1014]"
              )}
            >
              <span className="transition-transform duration-200 group-hover:-translate-x-0.5">
                {renderArrowIcon(icon, "size-3.5")}
              </span>
              <span>{children || label}</span>
            </div>

            {shortcut && (
              <div className="flex items-center px-2 text-xs">
                <kbd className="rounded bg-black/[0.06] dark:bg-white/[0.1] px-1.5 py-0.5 text-[10px] font-mono">
                  {shortcut}
                </kbd>
              </div>
            )}
          </motion.div>
        </Wrapper>
      );
    }

    // ──────────────────────────────────────────────────────────────────────────
    // VARIANT 7: Morphing Floating Action Disc (FAB / Minimal Glyph)
    // ──────────────────────────────────────────────────────────────────────────
    if (variant === "floating-disc") {
      const isDark = tone === "dark";
      return (
        <Wrapper href={href} {...commonProps}>
          <motion.div
            className={cn(
              "group relative flex items-center justify-center rounded-full border transition-all duration-300 overflow-hidden",
              sizeConfig.discSize,
              isDark
                ? "bg-white/[0.08] border-white/15 text-white hover:w-auto hover:px-4 hover:bg-white hover:text-black"
                : "bg-white border-black/[0.1] text-foreground shadow-sm hover:w-auto hover:px-4 hover:bg-[#0c1014] hover:text-white"
            )}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.94 }}
            transition={LIFT}
          >
            <span className="shrink-0 transition-transform duration-200 group-hover:-translate-x-0.5">
              {renderArrowIcon(icon, sizeConfig.iconSize)}
            </span>
            <span className="max-w-0 opacity-0 overflow-hidden whitespace-nowrap font-bold text-xs transition-all duration-300 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2">
              {children || label}
            </span>
          </motion.div>
        </Wrapper>
      );
    }

    // ──────────────────────────────────────────────────────────────────────────
    // VARIANT 8: Neo-Brutalist Tactile Border Pill
    // ──────────────────────────────────────────────────────────────────────────
    if (variant === "neo-brutalist") {
      return (
        <Wrapper href={href} {...commonProps}>
          <div
            className={cn(
              "relative inline-flex items-center rounded-xl border-2 border-[#0c1014] bg-[#f4f4ef] font-black tracking-tight text-[#0c1014] transition-all duration-150",
              sizeConfig.height,
              sizeConfig.px,
              sizeConfig.gap,
              sizeConfig.text,
              "shadow-[3px_3px_0px_0px_#0c1014] hover:bg-[#e6f5c0] hover:shadow-[4px_4px_0px_0px_#0c1014] hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
            )}
          >
            <span className="transition-transform duration-150 group-hover:-translate-x-0.5">
              {renderArrowIcon(icon, sizeConfig.iconSize)}
            </span>
            <span>{children || label}</span>
          </div>
        </Wrapper>
      );
    }

    return null;
  }
);

BackButton.displayName = "BackButton";

type WrapperProps = {
  href?: string;
  children: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  "aria-label"?: string;
  "aria-disabled"?: boolean;
  role?: string;
  tabIndex?: number;
};

/** Polymorphic wrapper: Link if href exists, otherwise span/button */
const Wrapper = React.forwardRef<HTMLElement, WrapperProps>(
  ({ href, children, ...props }, ref) => {
    if (href) {
      return (
        <Link href={href} ref={ref as React.Ref<HTMLAnchorElement>} {...props}>
          {children}
        </Link>
      );
    }
    return (
      <button type="button" ref={ref as React.Ref<HTMLButtonElement>} {...props}>
        {children}
      </button>
    );
  }
);

Wrapper.displayName = "Wrapper";
