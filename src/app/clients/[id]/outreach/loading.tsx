import { TabSkeleton } from "../tab-skeleton";

/** Outreach: booklet, Stage 1 email and the queued/failed lists, with history beside them. */
export default function Loading() {
  return <TabSkeleton mainCards={3} sideCards={1} />;
}
