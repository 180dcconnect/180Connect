import { TabSkeleton, type TabSkeletonCard } from "../tab-skeleton";

/**
 * Outreach: the booklet and the composer on the left, outreach history, the
 * follow-up, notes and attachments on the right — the same cards
 * `outreach/page.tsx` renders, in the same columns, hence `splitAt`.
 *
 * Drawn as the sending CAM sees it, which is the common case. A role that cannot
 * contact the client sees one "Sending" card instead of the left column's three,
 * and the queue card only renders when anything is actually queued — both data,
 * both one card either way.
 */
const CARDS: TabSkeletonCard[] = [
  { title: "w-48", hint: "w-80", action: true, kind: "lines", lines: 5 },
  { title: "w-52", hint: "w-72", kind: "lines", lines: 2 },
  { title: "w-44", hint: "w-80", kind: "list", rows: 3 },

  { title: "w-40", hint: "w-72", kind: "list", rows: 5 },
  { title: "w-28", hint: "w-80", kind: "lines", lines: 2 },
  { title: "w-20", hint: "w-72", kind: "list", rows: 3 },
  { title: "w-28", hint: "w-40", kind: "list", rows: 3 },
];

export default function Loading() {
  return <TabSkeleton cards={CARDS} splitAt={3} />;
}
