"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyProfileButton({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Copy profile link for ${name}`}
      className="inline-flex h-8.5 cursor-pointer items-center gap-1.5 rounded-full border border-rule bg-white px-3 text-xs font-semibold tracking-[-0.01em] text-ink transition-colors hover:border-faint hover:bg-paper focus-visible:outline-2 focus-visible:outline-lead-mid"
    >
      {copied ? (
        <>
          <Check aria-hidden="true" className="size-3.5 text-go" />
          <span className="text-go">Copied link</span>
        </>
      ) : (
        <>
          <Copy aria-hidden="true" className="size-3.5 text-faint" />
          <span>Copy link</span>
        </>
      )}
    </button>
  );
}
