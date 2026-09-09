import { Suspense, type ReactNode } from "react";

import { Rise, Stage } from "@/components/dashboard-stage";

import { loadClient, loadRecordStats, loadSuppression } from "./load-record";
import { RecordHeader } from "./record-header";
import { RecordTabs } from "./record-tabs";
import { TimelineRealtimeRefresher } from "./timeline-realtime";

/**
 * The client record's shell: one header, one tab bar, and whichever tab is open
 * underneath.
 *
 * This replaces a single 1534-line `page.tsx` that rendered sixteen cards in two
 * columns and navigated itself with a sticky rail of `#anchor` links. Splitting
 * the sections across four real routes is what makes the record navigable — but
 * it is also what makes it cheap: each tab now runs only its own queries instead
 * of every section's, and the shell's own reads are shared with whichever tab is
 * rendering through the `cache()`d loaders in `load-record.ts`.
 *
 * The shell awaits only the organisation row — enough to 404 a dead id from the
 * right place — and streams the header behind a Suspense boundary, so the frame
 * paints while the header and the tab body arrive beside each other.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await loadClient(id);
  return { title: `${client.legal_name} · Clients` };
}

/**
 * Suppression governs whether outreach is allowed at all, so it is read before
 * any tab that offers to do outreach — and it sits in the shell, above the tab
 * bar, so it cannot be missed by opening the record on a different tab.
 */
async function SuppressionBanner({ organisationId }: { organisationId: string }) {
  const { latest, suppressed, suppressionPending } = await loadSuppression(organisationId);
  if (!suppressed && !suppressionPending) return null;

  if (suppressed) {
    return (
      <div
        role="alert"
        className="rounded-panel border border-stop/25 bg-stop-wash px-5 py-4"
      >
        <p className="text-[15px] font-semibold text-stop">Do not contact</p>
        <p className="mt-1.5 text-sm leading-[1.65] text-stop/90">{latest?.reason}</p>
        <p className="mt-1 text-[13px] leading-[1.55] text-stop/70">
          Hidden from the active working list. Outreach is blocked. Only an admin can lift
          this.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-panel border border-hold/25 bg-hold-wash px-5 py-4">
      <p className="text-[15px] font-semibold text-hold">Do-not-contact requested</p>
      <p className="mt-1.5 text-sm leading-[1.65] text-hold/90">{latest?.reason}</p>
      <p className="mt-1 text-[13px] leading-[1.55] text-hold/70">Awaiting admin review.</p>
    </div>
  );
}

/** Holds the header's height while it streams, so the tab bar does not jump. */
function RecordHeaderSkeleton() {
  return (
    <div className="h-[21rem] animate-pulse rounded-panel border border-rule bg-white sm:h-[17rem]" />
  );
}

export default async function ClientRecordLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  /*
   * Resolved here, not only inside the streamed header: a dead or merged client
   * id has to reach `not-found.tsx` from the *layout*, so the 404 renders on its
   * own instead of inside this shell under a header skeleton that will never
   * arrive. It costs nothing — `loadClient` is `cache()`d and `generateMetadata`
   * has already awaited it for this request.
   */
  const [, stats] = await Promise.all([loadClient(id), loadRecordStats(id)]);

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <div className="mx-auto w-full max-w-[1400px] space-y-6">
        <Stage className="relative z-50 space-y-6">
          <Rise className="relative z-50">
            <Suspense fallback={<RecordHeaderSkeleton />}>
              <RecordHeader organisationId={id} />
            </Suspense>
          </Rise>
          <Suspense fallback={null}>
            <SuppressionBanner organisationId={id} />
          </Suspense>
        </Stage>

        {/* Deliberately outside Stage/Rise. `entranceSoft` settles on
            `filter: blur(0px)`, and a filtered ancestor opens a containing
            block that breaks `position: sticky` on everything inside it — the
            same trap the old anchor rail carried a comment about. */}
        <RecordTabs
          counts={{
            outreach: stats.outreach,
            financials: stats.financials,
            activity: stats.activity,
          }}
          organisationId={id}
        />

        {children}
      </div>

      {/* Lives in the shell so a realtime note, email, reply or audit event
          refreshes the header's counts from whichever tab is open. */}
      <TimelineRealtimeRefresher organisationId={id} />
    </div>
  );
}
