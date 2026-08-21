import Link from "next/link";
import { OriginButton } from "@/components/ui/origin-button";

/**
 * F067 AC3 — a client id that no longer exists (deleted, or merged away during
 * dedup) shows this instead of Next's generic 404, so it reads as an expected
 * outcome rather than a broken page. Same ground, card and type scale as the
 * detail page it stands in for.
 */
export default function ClientNotFound() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-5xl">
        <Link
          className="group inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40 transition-colors hover:text-foreground/70"
          href="/clients"
        >
          <span aria-hidden="true" className="transition-transform group-hover:-translate-x-0.5">
            ←
          </span>
          Clients
        </Link>

        <div className="mt-6 rounded-2xl border border-black/[0.06] bg-white px-6 py-10 shadow-sm sm:px-8">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
            Nothing here
          </p>
          <h1 className="mt-2 text-[clamp(1.75rem,3.5vw,2.5rem)] font-semibold font-body leading-[1.05] tracking-[-0.03em]">
            Client not found
          </h1>
          <p className="mt-3 max-w-prose text-sm leading-[1.7] text-foreground/55">
            This client record no longer exists. It may have been deleted, or merged
            into another record during deduplication.
          </p>
          <div className="mt-6">
            <OriginButton href="/clients" size="sm">
              Back to clients
            </OriginButton>
          </div>
        </div>
      </div>
    </div>
  );
}
