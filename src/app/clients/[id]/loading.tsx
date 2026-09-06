import { TabSkeleton } from "./tab-skeleton";

/** Overview: basic info, operating areas, financial scale on the left; score, tags, contactability and sources on the right. */
export default function Loading() {
  return <TabSkeleton mainCards={3} sideCards={4} />;
}
