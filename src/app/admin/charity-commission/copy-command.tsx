"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * A terminal command the admin is meant to run themselves, with a copy button.
 *
 * The bulk import cannot be a button on this page (508MB of extracts against a
 * 300s function ceiling), so the page's job is to hand over the exact command
 * rather than approximate it in prose and let someone mistype a flag.
 *
 * `navigator.clipboard` is not available on an insecure origin or when the
 * browser refuses permission. The command stays selectable text either way, and
 * a failed copy simply leaves the button unchanged rather than claiming success.
 */
export function CopyCommand({
  command,
  label,
  hint,
}: {
  command: string;
  label: string;
  hint: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Left as it was: the text is still there to select by hand.
    }
  }

  return (
    <div className="rounded-xl border border-black/[0.07] bg-black/[0.015] p-3.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.1em] text-foreground/45">
          {label}
        </p>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold text-foreground/55 transition-colors hover:bg-black/[0.05] hover:text-foreground"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" strokeWidth={2.2} />
              Copy
            </>
          )}
        </button>
      </div>
      <code className="mt-2 block overflow-x-auto whitespace-pre text-[13px] text-foreground/85">
        {command}
      </code>
      <p className="mt-2 text-xs leading-[1.5] text-foreground/50">{hint}</p>
    </div>
  );
}
