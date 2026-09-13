"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The one copy-invite-link control, used everywhere an invite link surfaces:
 * the single-invite sheet, the bulk-invite results, and the pending-invites
 * resend rows. One behaviour in all three — copy with "copied" confirmation —
 * instead of three slightly different underline buttons.
 *
 * When the Clipboard API refuses (permissions, non-secure context), it falls
 * back to a selectable field rather than failing silently: a link the admin
 * cannot copy is no workaround at all.
 */
export function CopyInviteLink({
  link,
  tone,
}: {
  link: string;
  /** "dark" for the invite sheet, "light" for the pending-invites list. */
  tone: "dark" | "light";
}) {
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A fresh link is a fresh control: clear the old confirmation. Adjusted
  // during render (React's documented derived-state pattern, same as
  // GmailReadingPane's thread switch) — an effect would trip the
  // set-state-in-effect rule for the same job.
  const [prevLink, setPrevLink] = useState(link);
  if (prevLink !== link) {
    setPrevLink(link);
    setCopied(false);
    setManualCopy(false);
  }

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      setManualCopy(true);
      return;
    }
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 3000);
  }

  return (
    <span className="inline-flex min-w-0 flex-col gap-1">
      <button
        type="button"
        onClick={() => void handleCopy()}
        className={cn(
          "cursor-pointer text-left text-xs font-semibold underline underline-offset-2 hover:opacity-80",
          tone === "dark" ? "text-[#e6f5c0]" : "text-brand",
        )}
      >
        {copied ? "✓ Copied invite link" : "Copy invite link"}
      </button>
      {manualCopy && (
        <input
          readOnly
          value={link}
          onFocus={(event) => event.target.select()}
          aria-label="Invite link — automatic copy failed, copy it manually"
          className={cn(
            "w-full max-w-60 truncate rounded-md border px-2 py-1 text-[11px]",
            tone === "dark"
              ? "border-white/20 bg-black/30 text-[#f4f4ef]"
              : "border-black/15 bg-white text-foreground",
          )}
        />
      )}
    </span>
  );
}
