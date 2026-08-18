"use client";

import * as React from "react";
import Link from "next/link";
import { motion, type Transition } from "motion/react";
import { Sun, Moon, Sparkles } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/animate-ui/components/radix/tooltip";

export type SidebarChecklistStep = {
  key: string;
  title: string;
  href: string;
  done: boolean;
};

const getPathAnimate = (isChecked: boolean) => ({
  pathLength: isChecked ? 1 : 0,
  opacity: isChecked ? 1 : 0,
});

const getPathTransition = (isChecked: boolean): Transition => ({
  pathLength: { duration: 0.7, ease: "easeInOut" },
  opacity: {
    duration: 0.01,
    delay: isChecked ? 0 : 0.7,
  },
});

export function SidebarChecklist({
  steps = [
    {
      key: "outreach_preferences",
      title: "Set outreach preferences",
      href: "/settings/outreach-preferences",
      done: false,
    },
    {
      key: "review_clients",
      title: "Review assigned clients",
      href: "/clients",
      done: false,
    },
  ],
  completedCount,
  totalCount,
  collapsed = false,
  forceTheme,
}: {
  steps?: SidebarChecklistStep[];
  completedCount?: number;
  totalCount?: number;
  collapsed?: boolean;
  forceTheme?: "light" | "dark";
}) {
  const [theme, setTheme] = React.useState<"light" | "dark">(forceTheme ?? "dark");

  React.useEffect(() => {
    if (forceTheme) return;
    try {
      const saved = localStorage.getItem("sidebar_checklist_theme");
      if (saved === "light" || saved === "dark") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setTheme(saved);
      }
    } catch {
      // Ignore localStorage read error
    }
  }, [forceTheme]);

  const currentTheme = theme;

  const toggleTheme = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = currentTheme === "dark" ? "light" : "dark";
    setTheme(next);
    if (!forceTheme) {
      try {
        localStorage.setItem("sidebar_checklist_theme", next);
      } catch {
        // Ignore localStorage write error
      }
    }
  };

  const actualCompleted = completedCount ?? steps.filter((s) => s.done).length;
  const actualTotal = totalCount ?? steps.length;
  const progressPercent =
    actualTotal === 0 ? 0 : Math.round((actualCompleted / actualTotal) * 100);
  const allDone = actualCompleted >= actualTotal && actualTotal > 0;

  if (collapsed) {
    return (
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <Link
            href="/dashboard?preview_guide=0"
            className={`group relative mx-auto flex h-10 w-10 items-center justify-center rounded-xl transition-all ${
              currentTheme === "dark"
                ? "bg-[#161b21] text-white hover:bg-[#1f252d] border border-white/10"
                : "bg-white text-foreground hover:bg-black/5 border border-black/10"
            }`}
          >
            <div className="relative flex items-center justify-center">
              {allDone ? (
                <Sparkles className="h-4 w-4 text-brand" />
              ) : (
                <span className="text-xs font-black">
                  {actualCompleted}/{actualTotal}
                </span>
              )}
            </div>
            {/* Tiny progress dot */}
            <span
              className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand"
              aria-hidden="true"
            />
          </Link>
        </TooltipTrigger>
        <TooltipContent
          side="right"
          sideOffset={10}
          showArrow={false}
          className="rounded-xl bg-neutral-900 px-3.5 py-2 text-xs font-semibold text-white shadow-lg"
        >
          Getting started ({actualCompleted} of {actualTotal} complete)
        </TooltipContent>
      </Tooltip>
    );
  }

  const isDark = currentTheme === "dark";

  return (
    <div
      className={`relative rounded-2xl p-4 transition-all duration-300 ${
        isDark
          ? "border border-white/[0.08] bg-[#161b21] text-white shadow-lg shadow-black/20"
          : "border border-black/[0.08] bg-white/90 text-foreground shadow-sm"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h3
            className={`text-xs font-bold tracking-tight ${
              isDark ? "text-white" : "text-foreground"
            }`}
          >
            Getting started
          </h3>
          <button
            type="button"
            onClick={toggleTheme}
            title={`Switch to ${isDark ? "light" : "dark"} mode`}
            className={`rounded-md p-1 transition-colors ${
              isDark
                ? "text-white/40 hover:bg-white/10 hover:text-white"
                : "text-foreground/40 hover:bg-black/5 hover:text-foreground"
            }`}
          >
            {isDark ? (
              <Sun className="h-3 w-3" />
            ) : (
              <Moon className="h-3 w-3" />
            )}
            <span className="sr-only">Toggle theme</span>
          </button>
        </div>

        <span
          className={`text-[11px] font-semibold tracking-wide ${
            isDark ? "text-white/50" : "text-foreground/50"
          }`}
        >
          {actualCompleted} of {actualTotal}
        </span>
      </div>

      {/* Progress Bar */}
      <div
        className={`mt-2.5 h-1.5 w-full overflow-hidden rounded-full ${
          isDark ? "bg-white/10" : "bg-black/10"
        }`}
      >
        <motion.div
          className={`h-full rounded-full ${
            isDark ? "bg-brand" : "bg-brand"
          }`}
          initial={{ width: 0 }}
          animate={{ width: `${progressPercent}%` }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        />
      </div>

      {/* Checklist Items */}
      <ul className="mt-3.5 space-y-2">
        {steps.map((step) => (
          <li key={step.key}>
            <Link
              href={step.href}
              className={`group flex items-center gap-2.5 rounded-lg px-1.5 py-1 -mx-1.5 text-xs transition-colors ${
                isDark
                  ? "hover:bg-white/5"
                  : "hover:bg-black/[0.04]"
              }`}
            >
              {/* Checkbox circle with spring checkmark */}
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-all duration-200 ${
                  step.done
                    ? "bg-brand text-white shadow-xs"
                    : isDark
                    ? "border border-white/30 text-transparent group-hover:border-white/60"
                    : "border border-black/25 text-transparent group-hover:border-black/50"
                }`}
              >
                <motion.span
                  initial={false}
                  animate={{ scale: step.done ? 1 : 0, opacity: step.done ? 1 : 0 }}
                  transition={{ type: "spring", stiffness: 400, damping: 25 }}
                >
                  ✓
                </motion.span>
              </span>

              {/* Title with playful animated wavy strikethrough */}
              <div className="relative min-w-0 flex-1 truncate">
                <span
                  className={`truncate transition-colors duration-200 ${
                    step.done
                      ? isDark
                        ? "text-white/40 font-normal"
                        : "text-foreground/45 font-normal"
                      : isDark
                      ? "text-white/85 group-hover:text-white font-medium"
                      : "text-foreground/85 group-hover:text-foreground font-medium"
                  }`}
                >
                  {step.title}
                </span>

                <motion.svg
                  width="220"
                  height="24"
                  viewBox="0 0 340 32"
                  preserveAspectRatio="none"
                  className="pointer-events-none absolute left-0 top-1/2 z-20 h-5 w-full -translate-y-1/2"
                >
                  <motion.path
                    d="M 10 16.91 s 79.8 -11.36 98.1 -11.34 c 22.2 0.02 -47.82 14.25 -33.39 22.02 c 12.61 6.77 124.18 -27.98 133.31 -17.28 c 7.52 8.38 -26.8 20.02 4.61 22.05 c 24.55 1.93 113.37 -20.36 113.37 -20.36"
                    vectorEffect="non-scaling-stroke"
                    strokeWidth={2.4}
                    strokeLinecap="round"
                    strokeMiterlimit={10}
                    fill="none"
                    initial={false}
                    animate={getPathAnimate(step.done)}
                    transition={getPathTransition(step.done)}
                    className={isDark ? "stroke-brand" : "stroke-brand"}
                  />
                </motion.svg>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
