"use client";

import { motion } from "motion/react";
import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

const FILL_DURATION = 0.45;
const FILL_EASE = [0.16, 1, 0.3, 1] as const;

type ButtonHTMLAttributesForMotion = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  | "onAnimationEnd"
  | "onAnimationIteration"
  | "onAnimationStart"
  | "onDrag"
  | "onDragEnd"
  | "onDragEnter"
  | "onDragExit"
  | "onDragLeave"
  | "onDragOver"
  | "onDragStart"
  | "onDrop"
>;

function getCoverDiameter(width: number, height: number, x: number, y: number) {
  return Math.ceil(
    2 *
      Math.max(
        Math.hypot(x, y),
        Math.hypot(width - x, y),
        Math.hypot(x, height - y),
        Math.hypot(width - x, height - y)
      )
  );
}

function assignRef<T>(ref: React.ForwardedRef<T>, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }

  if (ref) {
    ref.current = value;
  }
}

function hasTextContent(node: React.ReactNode): boolean {
  if (typeof node === "string" || typeof node === "number") {
    return String(node).trim().length > 0;
  }

  if (Array.isArray(node)) {
    return node.some(hasTextContent);
  }

  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return hasTextContent(node.props.children);
  }

  return false;
}

export type OriginButtonVariant =
  | "default" // Signature landing glass (charcoal glass + lime #e6f5c0 hover fill)
  | "card" // Clean light card + ink hover fill
  | "dark" // Flat ink + white wash
  | "outline" // Subtle outline
  | "ghost" // Transparent ghost
  | "destructive"; // Red destructive

export type OriginButtonSize = "xs" | "sm" | "md" | "lg";

type OriginButtonProps = ButtonHTMLAttributesForMotion & {
  children?: React.ReactNode;
  loading?: boolean;
  variant?: OriginButtonVariant;
  size?: OriginButtonSize;
  href?: string;
};

const MotionLink = motion.create(Link);

const OriginButton = React.forwardRef<HTMLButtonElement, OriginButtonProps>(
  (
    {
      children,
      className,
      disabled = false,
      loading = false,
      type = "button",
      variant = "default",
      size = "md",
      href,
      onBlur,
      onClick,
      onFocus,
      onKeyDown,
      onKeyUp,
      onPointerCancel,
      onPointerDown,
      onPointerEnter,
      onPointerLeave,
      onPointerUp,
      ...props
    },
    ref
  ) => {
    const buttonRef = React.useRef<HTMLButtonElement>(null);
    const linkRef = React.useRef<HTMLAnchorElement>(null);
    const isDisabled = Boolean(disabled || loading);
    const [hovered, setHovered] = React.useState(false);
    const [isPressed, setIsPressed] = React.useState(false);
    const [origin, setOrigin] = React.useState({ x: 0, y: 0 });
    const [coverSize, setCoverSize] = React.useState(0);

    const ariaLabel = props["aria-label"];
    const ariaLabelledBy = props["aria-labelledby"];

    React.useEffect(() => {
      if (process.env.NODE_ENV === "production") {
        return;
      }

      if (
        hasTextContent(children) ||
        ariaLabel?.trim() ||
        ariaLabelledBy?.trim()
      ) {
        return;
      }

      console.warn(
        "OriginButton: provide visible label text or aria-label / aria-labelledby so the control has an accessible name."
      );
    }, [ariaLabel, ariaLabelledBy, children]);

    const updateOrigin = React.useCallback((x: number, y: number) => {
      const node = buttonRef.current || linkRef.current;
      if (!node) return;

      const rect = node.getBoundingClientRect();
      setOrigin({ x, y });
      setCoverSize(getCoverDiameter(rect.width, rect.height, x, y));
    }, []);

    const updateOriginFromPointer = React.useCallback(
      (event: React.PointerEvent<HTMLElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        updateOrigin(event.clientX - rect.left, event.clientY - rect.top);
      },
      [updateOrigin]
    );

    const updateOriginFromCenter = React.useCallback(() => {
      const node = buttonRef.current || linkRef.current;
      if (!node) return;

      const rect = node.getBoundingClientRect();
      updateOrigin(rect.width / 2, rect.height / 2);
    }, [updateOrigin]);

    const showFill = !isDisabled && (hovered || isPressed);

    React.useLayoutEffect(() => {
      const node = buttonRef.current || linkRef.current;
      if (!(node && showFill)) return;

      const measure = () => {
        const rect = node.getBoundingClientRect();
        setCoverSize(
          getCoverDiameter(rect.width, rect.height, origin.x, origin.y)
        );
      };

      measure();

      const observer = new ResizeObserver(measure);
      observer.observe(node);

      const fonts = document.fonts;
      if (fonts?.ready) {
        fonts.ready.then(measure).catch(() => undefined);
      }

      return () => observer.disconnect();
    }, [showFill, origin.x, origin.y]);

    const fillTransition = { duration: FILL_DURATION, ease: FILL_EASE };

    const setMergedRef = React.useCallback(
      (node: HTMLButtonElement | null) => {
        buttonRef.current = node;
        assignRef(ref, node);
      },
      [ref]
    );

    // Sizing
    const sizeClasses = {
      xs: "h-7 px-3 text-xs rounded-full gap-1.5",
      sm: "h-8.5 px-4 text-xs font-semibold rounded-full gap-1.5",
      md: "h-10 px-5 text-sm font-medium rounded-full gap-2",
      lg: "h-12 px-7 font-medium text-[15px] rounded-full gap-2.5",
    }[size];

    // Resting background layer (fades out on hover so dark pixels never bleed into anti-aliased curved caps)
    const restBgLayer = {
      default:
        "bg-[#1c1a18]/85 backdrop-blur-md ring-1 ring-white/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] shadow-xs",
      card: "border-[0.5px] border-border bg-card shadow-xs dark:bg-muted",
      dark: "border-[0.5px] border-black/80 bg-[#0c1014] shadow-sm dark:bg-white dark:border-white/20",
      outline: "border border-black/15 bg-transparent",
      ghost: "border-transparent bg-transparent",
      destructive: "border-[0.5px] border-destructive/20 bg-destructive/10",
    }[variant];

    // Active hovered border/rim layer
    const activeBorderLayer = {
      default: "ring-1 ring-black/[0.08] shadow-xs",
      card: "border-[0.5px] border-black/20 shadow-xs",
      dark: "border-[0.5px] border-black/80 shadow-sm",
      outline: "border border-black/30",
      ghost: "border-transparent",
      destructive: "border-[0.5px] border-destructive/40",
    }[variant];

    // Expanding radial fill color
    const fillBg = {
      default: "bg-[#e6f5c0]",
      card: "bg-foreground dark:bg-neutral-50",
      dark: "bg-white/20 dark:bg-black/20",
      outline: "bg-[#e6f5c0]",
      ghost: "bg-foreground/10 dark:bg-white/10",
      destructive: "bg-destructive text-white",
    }[variant];

    // Text color at rest
    const textRestColor = {
      default: "text-[#f4f4ef]",
      card: "text-card-foreground dark:text-foreground",
      dark: "text-white dark:text-black",
      outline: "text-foreground",
      ghost: "text-foreground",
      destructive: "text-destructive",
    }[variant];

    // Text color when radial fill is active
    const textFilledColor = {
      default: "text-[#0c1014] font-semibold",
      card: "text-background dark:text-neutral-950",
      dark: "text-white dark:text-black",
      outline: "text-[#0c1014] font-semibold",
      ghost: "text-foreground",
      destructive: "text-white",
    }[variant];

    const sharedClasses = cn(
      "group relative inline-flex cursor-pointer touch-manipulation select-none items-center justify-center overflow-hidden whitespace-nowrap tracking-[-0.02em] bg-transparent",
      sizeClasses,
      "transition-[color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand focus-visible:ring-offset-background",
      "disabled:pointer-events-none disabled:opacity-50",
      showFill ? textFilledColor : textRestColor,
      className
    );

    const safeCoverSize = Math.max(coverSize * 1.25 + 24, 0);

    const restingSpan = (
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 rounded-full transition-opacity duration-300",
          restBgLayer,
          showFill ? "opacity-0" : "opacity-100"
        )}
      />
    );

    const activeBorderSpan = (
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 rounded-full transition-opacity duration-300",
          activeBorderLayer,
          showFill ? "opacity-100" : "opacity-0"
        )}
      />
    );

    const fillSpan = (
      <motion.span
        animate={{ scale: showFill && safeCoverSize > 0 ? 1 : 0 }}
        aria-hidden
        className={cn(
          "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full",
          fillBg
        )}
        initial={false}
        style={{
          height: safeCoverSize,
          left: origin.x,
          top: origin.y,
          width: safeCoverSize,
        }}
        transition={fillTransition}
      />
    );

    const content = (
      <span className="relative z-10 inline-flex items-center justify-center gap-2">
        {loading && (
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        )}
        {children}
      </span>
    );

    if (href) {
      return (
        <MotionLink
          href={href}
          ref={linkRef}
          className={sharedClasses}
          data-pressed={isPressed ? "true" : "false"}
          onBlur={() => {
            setIsPressed(false);
            setHovered(false);
          }}
          onFocus={(event) => {
            if (isDisabled || event.defaultPrevented) return;
            if (event.currentTarget.matches(":focus-visible")) {
              updateOriginFromCenter();
              setHovered(true);
            }
          }}
          onPointerDown={(event) => {
            if (event.defaultPrevented || isDisabled || event.button !== 0) return;
            updateOriginFromPointer(event);
            setIsPressed(true);
            setHovered(true);
          }}
          onPointerEnter={(event) => {
            if (isDisabled || event.defaultPrevented) return;
            updateOriginFromPointer(event);
            setHovered(true);
          }}
          onPointerLeave={() => {
            setHovered(false);
            setIsPressed(false);
          }}
          onPointerUp={() => {
            setIsPressed(false);
          }}
          whileTap={isDisabled ? undefined : { scale: 0.98 }}
        >
          {restingSpan}
          {fillSpan}
          {activeBorderSpan}
          {content}
        </MotionLink>
      );
    }

    return (
      <motion.button
        {...props}
        aria-busy={loading || undefined}
        className={sharedClasses}
        data-pressed={isPressed ? "true" : "false"}
        disabled={isDisabled}
        onBlur={(event) => {
          onBlur?.(event);
          setIsPressed(false);
          if (!event.defaultPrevented) {
            setHovered(false);
          }
        }}
        onClick={onClick}
        onFocus={(event) => {
          onFocus?.(event);
          if (isDisabled || event.defaultPrevented) return;
          if (event.currentTarget.matches(":focus-visible")) {
            updateOriginFromCenter();
            setHovered(true);
          }
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);

          if (
            event.defaultPrevented ||
            isDisabled ||
            event.repeat ||
            (event.key !== " " && event.key !== "Enter")
          ) {
            return;
          }

          if (event.key === " ") {
            event.preventDefault();
          }

          updateOriginFromCenter();
          setIsPressed(true);
          setHovered(true);
        }}
        onKeyUp={(event) => {
          onKeyUp?.(event);

          if (event.key === " " || event.key === "Enter") {
            setIsPressed(false);
            if (!event.currentTarget.matches(":focus-visible")) {
              setHovered(false);
            }
          }
        }}
        onPointerCancel={(event) => {
          onPointerCancel?.(event);
          setIsPressed(false);
        }}
        onPointerDown={(event) => {
          onPointerDown?.(event);

          if (event.defaultPrevented || isDisabled || event.button !== 0) {
            return;
          }

          updateOriginFromPointer(event);
          setIsPressed(true);
          setHovered(true);
        }}
        onPointerEnter={(event) => {
          onPointerEnter?.(event);
          if (isDisabled || event.defaultPrevented) return;
          updateOriginFromPointer(event);
          setHovered(true);
        }}
        onPointerLeave={(event) => {
          onPointerLeave?.(event);
          setHovered(false);
          setIsPressed(false);
        }}
        onPointerUp={(event) => {
          onPointerUp?.(event);
          setIsPressed(false);
        }}
        ref={setMergedRef}
        type={type}
        whileTap={isDisabled ? undefined : { scale: 0.98 }}
      >
        {restingSpan}
        {fillSpan}
        {activeBorderSpan}
        {content}
      </motion.button>
    );
  }
);
OriginButton.displayName = "OriginButton";

export { OriginButton };
export type { OriginButtonProps };
