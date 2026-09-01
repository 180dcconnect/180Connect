import { TabSkeleton } from "./tab-skeleton";

/** Overview: basic info, suggested edits, score and contactability, with tags and sources beside them. */
export default function Loading() {
  return <TabSkeleton mainCards={4} sideCards={2} />;
}
