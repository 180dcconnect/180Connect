import { redirect } from "next/navigation";
import { getViewingActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { outcomeReadiness } from "@/lib/ml-readiness";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { InlineAlert } from "@/components/ui/inline-alert";
import { HorizontalStickGauge } from "@/components/ui/horizontal-stick-gauge";
import { Pill, SectionCard } from "@/app/(app)/clients/[id]/section-card";
import { AiHeader } from "../ai-header";

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
    .select("outcome_label")
    .not("outcome_label", "is", null)
    .overrideTypes<{ outcome_label: string }[], { merge: false }>();

  if (error) {
    await reportError(error, { operation: "admin.ml_readiness.count" });
  }

  // A live count on every page load is the "no manual report" requirement —
  // no scheduler, no separate generation step. Single query drives both the
  // progress bar and the breakdown, so they cannot disagree.
  const count = error ? 0 : (rows?.length ?? 0);
  const readiness = outcomeReadiness(count);

  const labelCounts = new Map<string, number>();
  for (const row of rows ?? []) {
    labelCounts.set(row.outcome_label, (labelCounts.get(row.outcome_label) ?? 0) + 1);
  }

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-6xl space-y-8">
        <Rise>
          <AiHeader current="/admin/ml-readiness">
            <p className="mt-3 text-sm leading-[1.7] text-dim">
              How many labelled outcomes exist in the training dataset and how
              close that is to the agreed minimum that makes training realistic.
            </p>
            {error && (
              <div className="mt-4">
                <InlineAlert
                  variant="page"
                  message="The dataset could not be read. The count below reflects no data — verify access before treating it as a real measurement."
                />
              </div>
            )}
          </AiHeader>
        </Rise>

        <Group className="space-y-6">
          <Rise>
            <SectionCard
              headingId="labelled-outcomes"
              title="Labelled outcomes"
              hint="Labelled replies and conversions, counted live from the training dataset."
              action={
                <Pill tone={readiness.met ? "go" : "hold"}>
                  {readiness.met ? "Ready" : "Not yet"}
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
                  ariaLabel="Labelled outcomes toward the training minimum"
                  activeColor={readiness.met ? "var(--go)" : "var(--lead)"}
                  checkedLabel="Labelled outcomes"
                  remainingLabel="Still needed"
                />
              </div>
              <p data-testid="readiness-detail" className="mt-3 text-[13px] leading-[1.55] text-dim">
                {readiness.met
                  ? "Threshold met — the dataset is large enough to start training experiments."
                  : `${readiness.remaining} more labelled outcome${readiness.remaining === 1 ? "" : "s"} needed before training is realistic.`}
              </p>
            </SectionCard>
          </Rise>

          <Rise>
            <SectionCard
              headingId="readiness-by-outcome"
              title="By outcome"
              hint="How the labelled outcomes break down by result."
            >
              {labelCounts.size > 0 ? (
                <ul data-testid="label-breakdown" className="mt-4 divide-y divide-rule-soft border-t border-rule-soft text-sm">
                  {[...labelCounts.entries()]
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([label, n]) => (
                      <li key={label} className="flex justify-between gap-4 py-2 tabular-nums">
                        <span className="capitalize text-dim">{label.replaceAll("_", " ")}</span>
                        <span className="font-semibold text-ink">{n}</span>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm leading-[1.65] text-dim">
                  No labelled outcomes yet — every scored attempt still awaits an
                  outcome. Once CAMs record replies and conversions, the breakdown
                  appears here.
                </p>
              )}
            </SectionCard>
          </Rise>
        </Group>
      </Stage>
    </div>
  );
}
