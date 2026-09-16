"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";

import { EASE } from "@/components/brand/motion";
import { DeleteButton } from "@/components/ui/delete-button";
import { Pill } from "../[id]/section-card";
import { deleteManualEntryDraft } from "./actions";

export type DraftRow = {
  id: string;
  name: string;
  /** Formatted on the server, so the client renders the same text it hydrates. */
  date: string;
  fromWebsite: boolean;
};

/**
 * The Drafts card's rows, with delete.
 *
 * ── How a delete leaves ──
 *
 * Delete → Delete? → the snap dissolves the button. Only then does the row go:
 * it fades and folds its height away, and once that has finished the list
 * refreshes from the server. Each step waits for the one before, because
 * removing the row (or refreshing) while the snap plays cuts it off mid-dust.
 *
 * ── Why the button's slot is pinned ──
 *
 * The snap leaves the button vanished, and a vanished button takes no room —
 * so the badge beside it would slide into the gap before the row folds. The
 * slot is frozen at its size the moment the delete is confirmed, and the row
 * keeps its shape until it is gone.
 *
 * The divider sits inside each row rather than on the list, so it folds away
 * with the row instead of lingering as a double line.
 */
export function DraftRows({ rows }: { rows: DraftRow[] }) {
  const router = useRouter();
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const visible = rows.filter((row) => !removed.has(row.id));

  return (
    <ul className="border-t border-rule-soft [&>li+li>div]:border-t [&>li+li>div]:border-rule-soft">
      <AnimatePresence initial={false} onExitComplete={() => router.refresh()}>
        {visible.map((row) => (
          <motion.li
            className="overflow-hidden"
            exit={{ opacity: 0, height: 0 }}
            key={row.id}
            transition={{ duration: 0.32, ease: EASE }}
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3">
              <span className="w-28 shrink-0 text-[12.5px] tabular-nums text-dim">{row.date}</span>
              <Link
                className="min-w-0 flex-1 truncate text-sm font-semibold text-lead hover:underline"
                href={`/clients/new?draft=${row.id}`}
              >
                {row.name}
              </Link>
              <Pill tone="neutral" dot={false}>
                {row.fromWebsite ? "From their website" : "Typed in"}
              </Pill>
              <RowDelete
                entryId={row.id}
                name={row.name}
                onDeleted={() => setRemoved((current) => new Set(current).add(row.id))}
              />
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function RowDelete({
  entryId,
  name,
  onDeleted,
}: {
  entryId: string;
  name: string;
  onDeleted: () => void;
}) {
  const slot = useRef<HTMLSpanElement>(null);
  const [pinned, setPinned] = useState<{ width: number; height: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A failed delete still plays the snap (the button cannot know in advance),
  // so a fresh button is remounted through the key, the same as the booklet panel.
  const [attempt, setAttempt] = useState(0);
  const deleted = useRef(false);

  return (
    <>
      {error && <span className="text-[12.5px] text-stop">{error}</span>}
      <span
        className="flex shrink-0 items-center justify-end"
        ref={slot}
        style={pinned ?? undefined}
      >
        <DeleteButton
          aria-label={`Delete draft ${name}`}
          confirmLabel="Delete?"
          deletingLabel="Deleting…"
          key={attempt}
          label="Delete"
          onComplete={() => {
            if (deleted.current) onDeleted();
          }}
          onConfirm={async () => {
            const box = slot.current?.getBoundingClientRect();
            if (box) setPinned({ width: box.width, height: box.height });
            setError(null);
            const result = await deleteManualEntryDraft(entryId);
            if (result.ok) {
              deleted.current = true;
              return;
            }
            setError(result.message);
            setPinned(null);
            setAttempt((value) => value + 1);
          }}
          size="xs"
          variant="subtle"
        />
      </span>
    </>
  );
}
