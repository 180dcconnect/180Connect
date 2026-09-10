import { BackButton } from "@/components/ui/back-button";
import { OriginButton } from "@/components/ui/origin-button";

/**
 * F067 AC3 — a client id that no longer exists (deleted, or merged away during
 * dedup) shows this instead of Next's generic 404, so it reads as an expected
 * outcome rather than a broken page. Same ground, card and type scale as the
 * detail page it stands in for.
 */
export default function ClientNotFound() {
  return (
    <div className="min-h-screen bg-paper px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-6xl">
        <BackButton
          variant="editorial-minimal"
          href="/clients"
        />

        <div className="mt-6 rounded-panel border border-rule bg-white px-6 py-10 sm:px-8">
          <p className="text-[13px] font-medium text-dim">
            Nothing here
          </p>
          <h1 className="mt-2 text-[clamp(1.6rem,3.2vw,2.15rem)] leading-[1.1] font-semibold tracking-[-0.022em] text-ink">
            Client not found
          </h1>
          <p className="mt-3 max-w-prose text-sm leading-[1.7] text-dim">
            This client record no longer exists. It may have been deleted, or merged
            into another record during deduplication.
          </p>
          <div className="mt-6">
            <OriginButton href="/clients" size="sm" variant="ink">
              Back to clients
            </OriginButton>
          </div>
        </div>
      </div>
    </div>
  );
}
