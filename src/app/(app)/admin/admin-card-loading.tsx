import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * The loading frame for the admin pages still on the older layout — a single
 * white card on the grey ground (`#f1f2f4`) — which had no `loading.tsx` at all.
 *
 * Without one, Next cannot prefetch these pages (they render per request) and a
 * click shows nothing until the server has finished. With one, the sidebar stays
 * put, this frame paints at once, and the page streams into it.
 *
 * The heading is the page's fixed copy, drawn rather than guessed at; the body is
 * whatever the page passes, sized to its own panel. Deliberately not a shared
 * `admin/loading.tsx`: a loading file on the parent folder is shown whenever any
 * admin page below it changes, so every admin screen would flash this frame
 * before its own skeleton.
 */
export function AdminCardLoading({
  width,
  eyebrow,
  title,
  children,
}: {
  /** The page card's `max-w-*` class, exactly as the page writes it. */
  width: "max-w-2xl" | "max-w-4xl" | "max-w-5xl";
  eyebrow?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className={`mx-auto w-full ${width} rounded-2xl bg-white p-8 shadow-sm`}>
        {eyebrow && <p className="text-sm font-bold text-brand">{eyebrow}</p>}
        <h1 className={`text-2xl font-bold ${eyebrow ? "mt-2" : ""}`}>{title}</h1>
        <Skeleton className="mt-3 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-2/3" />
        <div aria-hidden="true">{children}</div>
      </section>
    </main>
  );
}
