import { TabSkeleton } from "../tab-skeleton";

/** Financials: two full-width tables — grants, then filings. */
export default function Loading() {
  return <TabSkeleton columns="single" mainCards={2} />;
}
