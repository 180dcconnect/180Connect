import { redirect } from "next/navigation";
import { getViewingActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import {
  groupOutcomes,
  outcomeReadiness,
  type OutcomeGroup,
  type OutcomeGrouping,
  type OutcomeRow,
} from "@/lib/ml-readiness";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { InlineAlert } from "@/components/ui/inline-alert";
import { HorizontalStickGauge } from "@/components/ui/horizontal-stick-gauge";
import { Pill, SectionCard } from "@/app/(app)/clients/[id]/section-card";
import { AiHeader } from "../ai-header";
import { OutcomesBreakdownCard } from "./outcomes-breakdown-card";

/**
 * F099 — Minimum Outcome Threshold Tracking (#98).
 * One tab of the Artificial Intelligence group — see
 * `src/app/(app)/admin/ai-group.ts`.
 *
 * An admin sees how many labelled outcomes exist in F098's training view and
 * how close that is to the agreed minimum that makes ML training realistic.
 * Gated like every other admin analytics surface: the admin permission is
 * re-checked in the page itself, not just at the nav layer.
 *
 * ONE READ, FOUR READINGS. The same rows behind the count are grouped four ways
 * (type, client, sector, month) so the breakdown card can be switched without a
 * second query — and so the count and every breakdown are guaranteed to be the
 * same data, read once. The client names ride along on a second read only
 * because a bucket labelled with a uuid is exactly the internal name this
 * screen must never show.
 *
 * The root element is a `div`, not a `main`: the admin layout's AppShell already
 * renders the `main` this is slotted into.
 */
export default async function MlReadinessPage() {
  const authorization = await getViewingActor("platform-settings:manage", {
    route: "/admin/ml-readiness",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("training_examples")
    .select("outcome_label, organisation_id, organisation_sector, outcome_recorded_at")
    .not("outcome_label", "is", null)
    .overrideTypes<OutcomeRow[], { merge: false }>();

  if (error) {
    await reportError(error, { operation: "admin.ml_readiness.count" });
  }

  // A live count on every page load is the "no manual report" requirement —
  // no scheduler, no separate generation step. Single query drives the
  // progress bar and every breakdown, so they cannot disagree.
  const outcomes = rows ?? [];
  const count = error ? 0 : outcomes.length;
  const readiness = outcomeReadiness(count);

  // Names for the clients the outcomes are with. Only the ones that actually
  // appear — a bucket with no name on file reads as "Client not on file", which
  // is a gap in the data worth seeing rather than a row to hide.
  const clientIds = [...new Set(outcomes.map((row) => row.organisation_id))];
  const { data: clientRows } = clientIds.length
    ? await supabase
        .from("organisations")
        .select("id, legal_name")
        .in("id", clientIds)
        .overrideTypes<{ id: string; legal_name: string }[], { merge: false }>()
    : { data: [] as { id: string; legal_name: string }[] };
  const clientNames = new Map(
    (clientRows ?? []).map((client) => [client.id, client.legal_name?.trim() || "Client not on file"]),
  );

  const groups: Record<OutcomeGrouping, OutcomeGroup[]> = {
    type: groupOutcomes(outcomes, "type"),
    client: groupOutcomes(outcomes, "client", clientNames),
    sector: groupOutcomes(outcomes, "sector"),
    month: groupOutcomes(outcomes, "month"),
  };

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-6xl space-y-8">
        <Rise>
          <AiHeader current="/admin/ml-readiness">
            <p className="mt-3 max-w-3xl text-sm leading-[1.7] text-dim">
              To train machine learning models that can accurately predict which charities and social enterprises are most likely to partner with us, we need real historical results. This page tracks how many client outcomes (such as replies and conversions) are recorded in our database, and how close we are to having enough data to train custom models.
            </p>
            {error && (
              <div className="mt-4">
                <InlineAlert
                  variant="page"
                  message="Client outcome records could not be loaded from the database. The count below may not reflect recent activity — please refresh or try again shortly."
                />
              </div>
            )}
          </AiHeader>
        </Rise>

        <Group className="space-y-6">
          <Rise>
            <SectionCard
              headingId="labelled-outcomes"
              title="Client outcomes in database"
              hint="Recorded replies and conversions with clients, counted live from our database."
              action={
                <Pill tone={readiness.met ? "go" : "hold"}>
                  {readiness.met ? "Ready to train" : "Collecting data"}
                </Pill>
              }
            >
              <p
                data-testid="readiness-label"
                className="mt-4 text-[clamp(1.75rem,4vw,2.5rem)] leading-none font-semibold tracking-[-0.03em] tabular-nums text-ink"
              >
                {readiness.label}
              </p>
              <div className="mt-3">
                <HorizontalStickGauge
                  checked={readiness.labelledCount}
                  total={readiness.threshold}
                  ariaLabel="Recorded client outcomes toward the training minimum"
                  activeColor={readiness.met ? "var(--go)" : "var(--lead)"}
                  checkedLabel="Client outcomes"
                  remainingLabel="Still needed"
                />
              </div>
              <p data-testid="readiness-detail" className="mt-3 text-[13px] leading-[1.55] text-dim">
                {readiness.met
                  ? "Target met — we have enough recorded client outcomes to begin training and testing machine learning models."
                  : `${readiness.remaining} more client outcome${readiness.remaining === 1 ? "" : "s"} needed in our database before we can train reliable models.`}
              </p>
            </SectionCard>
          </Rise>

          <Rise>
            <OutcomesBreakdownCard groups={groups} />
          </Rise>

          <Rise>
            <SectionCard
              headingId="how-it-works"
              title="How this works"
              hint="Why 180Connect tracks client outcomes and how it helps consulting teams."
            >
              <div className="mt-4 grid gap-4 sm:grid-cols-3 text-sm leading-[1.6]">
                <div className="rounded-lg border border-rule-soft bg-white p-4">
                  <div className="flex items-center gap-2 font-semibold text-ink">
                    <span className="flex size-6 items-center justify-center rounded-full bg-lead/10 text-xs font-bold text-lead">1</span>
                    Reach out to clients
                  </div>
                  <p className="mt-2 text-[13px] text-dim">
                    CAMs reach out to charities and social enterprises through personalized email outreach.
                  </p>
                </div>
                <div className="rounded-lg border border-rule-soft bg-white p-4">
                  <div className="flex items-center gap-2 font-semibold text-ink">
                    <span className="flex size-6 items-center justify-center rounded-full bg-lead/10 text-xs font-bold text-lead">2</span>
                    Record outcomes
                  </div>
                  <p className="mt-2 text-[13px] text-dim">
                    Every reply, discovery call, and project conversion is recorded in our database as a real client outcome.
                  </p>
                </div>
                <div className="rounded-lg border border-rule-soft bg-white p-4">
                  <div className="flex items-center gap-2 font-semibold text-ink">
                    <span className="flex size-6 items-center justify-center rounded-full bg-lead/10 text-xs font-bold text-lead">3</span>
                    Train smarter AI
                  </div>
                  <p className="mt-2 text-[13px] text-dim">
                    Once we reach 50 client outcomes, our machine learning models can learn which organizations are best suited for 180DC projects.
                  </p>
                </div>
              </div>
            </SectionCard>
          </Rise>
        </Group>
      </Stage>
    </div>
  );
}
