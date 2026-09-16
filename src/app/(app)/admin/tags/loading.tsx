import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors page.tsx: the one white card on the bone ground, its eyebrow, heading
 * and copy (fixed, so drawn), the create form, then the existing tags.
 * Approximated because it is data: how many tags exist.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <section className="mx-auto max-w-2xl rounded-2xl border border-black/[0.06] bg-white p-8 shadow-sm">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand">Tags</p>
        <h1 className="mt-2 text-[clamp(2rem,4vw,2.75rem)] font-black leading-[1.05] tracking-[-0.03em]">
          Create a tag
        </h1>
        <p className="mt-3 text-[15px] leading-[1.8] text-black/55">
          Tags are shared across the whole team. Once created, any CAM can
          assign it to a client.
        </p>

        <div aria-hidden="true">
          <div className="mt-6 flex flex-wrap items-end gap-3">
            <div>
              <Skeleton className="h-4 w-16" />
              <Skeleton className="mt-1 h-9 w-56 rounded-xl" />
            </div>
            <Skeleton className="h-9 w-40 rounded-xl" />
            <Skeleton className="h-9 w-24 rounded-full" />
          </div>

          <div className="mt-8">
            <Skeleton className="h-4 w-28" />
            <div className="mt-3 flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Skeleton className="h-7 w-28 rounded-full" />
                  <Skeleton className="h-7 w-14 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
