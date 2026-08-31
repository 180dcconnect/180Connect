"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MorphingPopover,
  MorphingPopoverTrigger,
  MorphingPopoverContent,
} from "@/components/core/morphing-popover";
import { motion } from "motion/react";
import { ArrowLeftIcon } from "lucide-react";

/**
 * F072 — posts to /api/clients/[id]/notes. Uses MorphingPopover so the trigger
 * seamlessly transforms into the note composer textarea.
 */
export function AddNoteForm({ organisationId }: { organisationId: string }) {
  const uniqueId = useId();
  const router = useRouter();
  const [content, setContent] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isRefreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const saving = busy || isRefreshing;
  const isBlank = content.trim().length === 0;

  const closeMenu = () => {
    setContent("");
    setError(null);
    setIsOpen(false);
  };

  async function save() {
    if (isBlank) {
      setError("Write something before saving.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/clients/${organisationId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (response.ok) {
        setContent("");
        setIsOpen(false);
        startRefresh(() => router.refresh());
        return;
      }
      const body = await response.json();
      setError(body.error ?? "The note could not be saved.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      <MorphingPopover
        transition={{
          type: "spring",
          bounce: 0.05,
          duration: 0.3,
        }}
        open={isOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !saving) {
            closeMenu();
          } else {
            setIsOpen(nextOpen);
          }
        }}
      >
        <MorphingPopoverTrigger className="flex h-9 items-center rounded-lg border border-black/15 bg-white px-3 text-sm font-medium text-foreground shadow-sm hover:bg-black/[0.02] cursor-pointer dark:border-white/15 dark:bg-zinc-800 dark:hover:bg-zinc-700 transition-colors">
          <motion.span layoutId={`popover-label-${uniqueId}`} className="text-sm font-medium">
            Add Note
          </motion.span>
        </MorphingPopoverTrigger>

        <MorphingPopoverContent className="rounded-xl border border-black/15 bg-white p-0 shadow-[0_9px_9px_0px_rgba(0,0,0,0.01),_0_2px_5px_0px_rgba(0,0,0,0.06)] dark:border-white/15 dark:bg-zinc-800">
          <div className="h-[200px] w-full max-w-[364px] min-w-[300px]">
            <form
              className="relative flex h-full flex-col"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <label className="sr-only" htmlFor={`add-note-${organisationId}`}>
                Add a note
              </label>
              <motion.span
                layoutId={`popover-label-${uniqueId}`}
                aria-hidden="true"
                style={{
                  opacity: content ? 0 : 1,
                }}
                className="pointer-events-none absolute top-3 left-4 text-sm font-medium text-muted-foreground select-none"
              >
                Add Note
              </motion.span>
              <textarea
                id={`add-note-${organisationId}`}
                className="h-full w-full resize-none rounded-md bg-transparent px-4 py-3 text-sm outline-none text-foreground"
                autoFocus
                disabled={saving}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
              <div key="close" className="flex items-center justify-between border-t border-black/[0.06] py-3 pr-4 pl-2 dark:border-white/[0.08]">
                <button
                  type="button"
                  className="flex items-center rounded-lg bg-transparent px-2 py-1 text-sm text-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.08] cursor-pointer transition-colors"
                  onClick={closeMenu}
                  disabled={saving}
                  aria-label="Close popover"
                >
                  <ArrowLeftIcon size={16} className="text-foreground" />
                </button>
                <div className="flex items-center gap-2">
                  {error && (
                    <p aria-live="polite" role="alert" className="text-xs font-bold text-destructive">
                      {error}
                    </p>
                  )}
                  <button
                    className="relative flex h-8 shrink-0 scale-100 appearance-none items-center justify-center rounded-lg border border-black/15 bg-transparent px-3 text-sm font-medium text-foreground transition-colors select-none hover:bg-black/[0.05] focus-visible:ring-2 active:scale-[0.98] disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/[0.08] cursor-pointer"
                    type="submit"
                    disabled={saving || isBlank}
                    aria-label="Save note"
                  >
                    {saving ? "Saving…" : "Submit"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </MorphingPopoverContent>
      </MorphingPopover>
    </div>
  );
}

export default AddNoteForm;
