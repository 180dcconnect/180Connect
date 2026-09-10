import { Skeleton } from "@/components/ui/skeleton";

/**
 * F234 — the placeholder each tab shows while its own queries run.
 *
 * It covers the tab *body* only. The record's ground, charcoal header and tab bar
 * come from `layout.tsx`, which is above every tab's Suspense boundary and so is
 * already on screen — the shell no longer flashes and rebuilds on a tab change,
 * which is the main thing the route split bought.
 *
 * `columns` mirrors whichever grid the tab actually uses, so the skeleton and the
 * content it becomes occupy the same shape.
 */
export function TabSkeleton({
  columns = "split",
  mainCards = 3,
  sideCards = 2,
}: {
  /** `split` matches the 1.55fr/1fr grid; `single` matches a full-width stack. */
  columns?: "split" | "single";
  mainCards?: number;
  sideCards?: number;
}) {
  if (columns === "single") {
    return (
      <div className="space-y-6">
        {Array.from({ length: mainCards }).map((_, index) => (
          <Skeleton key={index} className="h-64 w-full rounded-panel" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        {Array.from({ length: mainCards }).map((_, index) => (
          <Skeleton key={index} className="h-44 w-full rounded-panel" />
        ))}
      </div>
      <div className="space-y-6">
        {Array.from({ length: sideCards }).map((_, index) => (
          <Skeleton key={index} className="h-36 w-full rounded-panel" />
        ))}
      </div>
    </div>
  );
}
