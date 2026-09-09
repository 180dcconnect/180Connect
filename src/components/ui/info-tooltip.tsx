"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/animate-ui/components/radix/tooltip";
import { cn } from "@/lib/utils";

export interface InfoTooltipProps {
  /** The primary content / body to show inside the tooltip. */
  content?: ReactNode;
  /** Optional bold title at the top of the tooltip. */
  title?: ReactNode;
  /** Optional footer section, separated by a subtle border (e.g. relevance notes). */
  footer?: ReactNode;
  /** Custom trigger element. When omitted, defaults to an accessible Info icon button. */
  children?: ReactNode;
  /** Placement side of the tooltip. Defaults to "top". */
  side?: "top" | "bottom" | "left" | "right";
  /** Offset distance from trigger in pixels. Defaults to 6. */
  sideOffset?: number;
  /** Optional extra classes for the tooltip container. */
  contentClassName?: string;
  /** Optional extra classes for the default Info trigger button. */
  triggerClassName?: string;
  /** Delay in milliseconds before opening the tooltip. Defaults to 150ms. */
  delayDuration?: number;
  /** Accessible label for the default trigger button. */
  label?: string;
}

/**
 * Shared tooltip component styled using the Data Sources card visual language:
 * dark charcoal ground (`bg-[#161b21]`), hairline border (`border-white/10`),
 * `rounded-inset` (6px), white text, and subtle elevation shadow.
 */
export function InfoTooltip({
  content,
  title,
  footer,
  children,
  side = "top",
  sideOffset = 6,
  contentClassName,
  triggerClassName,
  delayDuration = 150,
  label,
}: InfoTooltipProps) {
  if (!content && !title) {
    return <>{children}</>;
  }

  const trigger = children ?? (
    <button
      type="button"
      aria-label={
        label ??
        (typeof title === "string"
          ? title
          : typeof content === "string"
            ? content
            : "More information")
      }
      className={cn(
        "inline-flex items-center justify-center rounded-full text-faint transition-colors hover:text-dim focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-lead cursor-help",
        triggerClassName,
      )}
    >
      <Info className="size-3.5" />
    </button>
  );

  return (
    <Tooltip delayDuration={delayDuration}>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent
        side={side}
        sideOffset={sideOffset}
        className={cn(
          "w-max max-w-[18rem] rounded-inset border border-white/10 bg-[#161b21] px-3.5 py-2.5 text-left text-[12px] leading-[1.5] text-white shadow-lg",
          contentClassName,
        )}
      >
        {title && <span className="block font-semibold text-white">{title}</span>}
        {content && (
          <span className={cn("block text-white/80", title && "mt-1")}>
            {content}
          </span>
        )}
        {footer && (
          <span className="mt-2 block border-t border-white/10 pt-1.5 text-[11px] text-white/70">
            {footer}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
