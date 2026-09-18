import { TabSkeleton, type TabSkeletonCard } from "./tab-skeleton";

/**
 * Overview: basic info, operating areas, suggested edits and financial scale on
 * the left; score, similar clients, tags, contactability and sources on the
 * right. Same order as `page.tsx` — the split is the midpoint of this list.
 *
 * Approximated because it is data: `SuggestEditSection` renders nothing when
 * there are no suggestions. It is drawn here at one card, the most it adds —
 * the similarity card renders on every client, so it is drawn as one too.
 */
const CARDS: TabSkeletonCard[] = [
  { title: "w-44", hint: "w-72", action: true, kind: "facts", rows: 6 },
  { title: "w-40", kind: "chips" },
  { title: "w-48", hint: "w-64", kind: "list", rows: 2 },
  { title: "w-36", kind: "stats", cells: 4 },

  { title: "w-40", kind: "stats", cells: 2 },
  { title: "w-48", hint: "w-80", kind: "lines", lines: 1 },
  { title: "w-20", kind: "chips" },
  { title: "w-36", kind: "facts", rows: 2 },
  { title: "w-24", kind: "list", rows: 3 },
];

export default function Loading() {
  return <TabSkeleton cards={CARDS} />;
}
