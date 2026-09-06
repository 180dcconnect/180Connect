"use client";

import { motion } from "motion/react";
import { Inbox } from "lucide-react";

import { entranceIndexed } from "@/components/brand/motion";
import type { InboxQueueRow } from "@/lib/inbox-queue";
import { QueueRow } from "./queue-row";

/**
 * The queue's list surface.
 *
 * Rows arrive with `entranceIndexed` rather than through `Stage`/`Group`'s
 * `stagger`: the queue is unbounded (every organisation ever contacted, when
 * the scope is All), and a hundred rows at 0.04s apart is a four-second
 * cascade with the reader watching the bottom of the page fill in.
 * `entranceIndexed` caps the delay, so everything above the fold still arrives
 * in reading order and everything below it is settled before it is scrolled to.
 *
 * `entranceIndexed` settles on `filter: blur(0px)`, which makes each row a
 * containing block — harmless here because nothing inside a row is sticky or
 * frosted. Anything sticky on this page (the scope bar) must stay outside it.
 */
export function QueueList({
  rows,
  emptyTitle = "Nothing waiting",
  emptyHint = "No threads in this view.",
}: {
  rows: readonly InboxQueueRow[];
  emptyTitle?: string;
  emptyHint?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-panel border border-rule bg-white px-6 py-12 text-center">
        <Inbox aria-hidden="true" className="mx-auto size-7 text-faint" />
        <p className="mt-2.5 text-sm font-semibold text-ink">{emptyTitle}</p>
        <p className="mx-auto mt-1 max-w-[46ch] text-[13px] leading-[1.55] text-dim">
          {emptyHint}
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-rule-soft overflow-hidden rounded-panel border border-rule bg-white">
      {rows.map((row, index) => (
        <motion.li
          key={row.orgId}
          variants={entranceIndexed()}
          custom={index}
          initial="hidden"
          animate="show"
        >
          <QueueRow row={row} />
        </motion.li>
      ))}
    </ul>
  );
}
