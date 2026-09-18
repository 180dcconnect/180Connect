import { TabSkeleton, type TabSkeletonCard } from "../tab-skeleton";

/**
 * Activity: the timeline in the wide column, notes and attachments beside it —
 * the same three cards `activity/page.tsx` renders, in the same columns, which is
 * why this one passes `splitAt` rather than splitting evenly.
 *
 * Approximated because it is data: how many timeline entries, notes and attached
 * files the record has. The timeline is drawn at its first screenful; the two
 * side cards at their usual four and three rows.
 */
const CARDS: TabSkeletonCard[] = [
  { title: "w-32", hint: "w-72", action: true, kind: "list", rows: 8 },
  { title: "w-24", kind: "lines", lines: 4 },
  { title: "w-32", kind: "list", rows: 3 },
];

export default function Loading() {
  return <TabSkeleton cards={CARDS} splitAt={1} />;
}
