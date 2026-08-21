"use client";

import { useTransition, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { resetOnboardingStateAction } from "@/lib/onboarding-dev-actions";

export function OnboardingPreviewBar({ currentMode }: { currentMode?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  const activeMode = currentMode || searchParams.get("preview_guide") || "0";

  function handleReset() {
    setResetMessage(null);
    startTransition(async () => {
      const res = await resetOnboardingStateAction();
      if (res.ok) {
        setResetMessage("Reset DB state!");
        setTimeout(() => setResetMessage(null), 3000);
        router.refresh();
      } else {
        setResetMessage("Reset failed: " + (res.message || "error"));
      }
    });
  }

  const modes = [
    { key: "0", label: "0 / 2 (Start)", href: "/dashboard?preview_guide=0" },
    { key: "1", label: "1 / 2 (Partial)", href: "/dashboard?preview_guide=1" },
    { key: "2", label: "2 / 2 (Complete)", href: "/dashboard?preview_guide=2" },
    { key: "empty", label: "No Clients Variant", href: "/dashboard?preview_guide=empty" },
    { key: "live", label: "Live Account DB", href: "/dashboard?preview_guide=live" },
  ];

  return (
    <aside
      aria-label="F255 First-Run Guide Preview Switcher"
      className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-brand/30 bg-white/95 px-4 py-2.5 shadow-xl backdrop-blur-md transition-all"
    >
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
        <div className="flex items-center gap-1.5 font-bold text-brand">
          <span className="inline-block h-2 w-2 rounded-full bg-brand animate-pulse" />
          <span>F255 Preview Mode</span>
        </div>

        <div className="h-4 w-px bg-black/10" />

        <div className="flex items-center gap-1">
          {modes.map((m) => {
            const isActive =
              activeMode === m.key || (activeMode === "true" && m.key === "0");
            return (
              <Link
                key={m.key}
                href={m.href}
                className={`rounded-lg px-2.5 py-1 font-semibold transition-colors ${
                  isActive
                    ? "bg-brand text-white shadow-xs"
                    : "text-foreground/70 hover:bg-black/5 hover:text-foreground"
                }`}
              >
                {m.label}
              </Link>
            );
          })}
        </div>

        <div className="h-4 w-px bg-black/10" />

        <button
          type="button"
          onClick={handleReset}
          disabled={pending}
          title="Reset your user's onboarding completion flags & steps in database"
          className="rounded-lg border border-brand/20 bg-brand/5 px-2.5 py-1 font-bold text-brand hover:bg-brand/10 disabled:opacity-50"
        >
          {pending ? "Resetting…" : "Reset DB"}
        </button>

        <Link
          href="/preview-guide"
          className="rounded-lg px-2 py-1 font-semibold text-foreground/60 hover:text-brand hover:underline"
        >
          Sandbox ↗
        </Link>

        <Link
          href="/dashboard"
          className="rounded-lg px-2 py-1 font-bold text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
          title="Exit preview mode"
        >
          ✕ Exit
        </Link>
      </div>

      {resetMessage && (
        <div className="mt-1 text-center text-[11px] font-bold text-brand">
          {resetMessage}
        </div>
      )}
    </aside>
  );
}
