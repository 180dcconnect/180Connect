import { TabSkeleton } from "../tab-skeleton";

/** Activity: the timeline in the wide column, notes and attachments beside it. */
export default function Loading() {
  return <TabSkeleton mainCards={1} sideCards={2} />;
}
