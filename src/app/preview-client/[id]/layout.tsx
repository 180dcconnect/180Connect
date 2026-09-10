import { Suspense, type ReactNode } from "react";

import { Rise, Stage } from "@/components/dashboard-stage";

import {
  loadClient,
  loadRecordStats,
  loadSuppression,
  requireActor,
} from "@/app/clients/[id]/load-record";
import { RecordHeader } from "./record-header";
import { RecordTabs } from "@/app/clients/[id]/record-tabs";
import { TimelineRealtimeRefresher } from "@/app/clients/[id]/timeline-realtime";

// 1:1 duplicate of src/app/clients/[id]/layout.tsx — edit freely, real file untouched.
// Copy final JSX back to src/app/clients/[id]/layout.tsx when happy.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireActor();
  const client = await loadClient(id);
  return { title: `${client.legal_name} · Clients (Preview)` };
}

async function SuppressionBanner({ organisationId }: { organisationId: string }) {
  const { latest, suppressed, suppressionPending } = await loadSuppression(organisationId);
  if (!suppressed && !suppressionPending) return null;

  if (suppressed) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-destructive/20 bg-destructive/[0.06] px-5 py-4"
      >
        <p className="text-[11px] font-bold tracking-[0.12em] text-destructive uppercase">Do not contact</p>
        <p className="mt-2 text-sm leading-[1.7] text-destructive/90">{latest?.reason}</p>
        <p className="mt-1.5 text-[13px] leading-[1.6] text-destructive/60">
          Hidden from the active working list. Outreach is blocked. Only an admin can lift this.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] px-5 py-4">
      <p className="text-[11px] font-bold tracking-[0.12em] text-amber-800 uppercase">Do not contact requested</p>
      <p className="mt-2 text-sm leading-[1.7] text-amber-900/85">{latest?.reason}</p>
      <p className="mt-1.5 text-[13px] leading-[1.6] text-amber-800/60">Awaiting admin review.</p>
    </div>
  );
}

function RecordHeaderSkeleton() {
  return <div className="h-16 animate-pulse rounded-xl bg-black/[0.06]" />;
}

export default async function PreviewClientRecordLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireActor();
  await loadClient(id);
  const stats = await loadRecordStats(id);

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <Stage className="space-y-6">
          <Rise>
            <Suspense fallback={<RecordHeaderSkeleton />}>
              <RecordHeader organisationId={id} />
            </Suspense>
          </Rise>
          <Suspense fallback={null}>
            <SuppressionBanner organisationId={id} />
          </Suspense>
        </Stage>

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

      <TimelineRealtimeRefresher organisationId={id} />
    </div>
  );
}
