import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { outcomeReadiness } from "@/lib/ml-readiness";
import { Group, Rise, Stage } from "@/components/dashboard-stage";

/**
 * F099 — Minimum Outcome Threshold Tracking (#98).
 *
 * An admin sees how many labelled outcomes exist in F098's training view and
 * how close that is to the agreed minimum that makes ML training realistic.
 * Gated like every other admin analytics surface: the admin permission is
 * re-checked in the page itself, not just at the nav layer.
 */
export default async function MlReadinessPage() {
  const authorization = await getCurrentActor("user:manage", {
    route: "/admin/ml-readiness",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const supabase = await createClient();
  const { count, error } = await supabase
    .from("training_examples")
    .select("outreach_message_id", { count: "exact", head: true })
    .not("outcome_label", "is", null);

  if (error) {
    await reportError(error, { operation: "admin.ml_readiness.count" });
  }

  // A live count on every page load is the "no manual report" requirement —
  // no scheduler, no separate generation step.
  const readiness = outcomeReadiness(error ? 0 : (count ?? 0));

  // Tiny label histogram (same view, admin-readable; extra colour for the demo).
  const { data: byLabel } = await supabase
    .from("training_examples")
    .select("outcome_label")
    .not("outcome_label", "is", null)
    .limit(5000)
    .overrideTypes<{ outcome_label: string }[], { merge: false }>();

  const labelCounts = new Map<string, number>();
  for (const row of byLabel ?? []) {
    labelCounts.set(row.outcome_label, (labelCounts.get(row.outcome_label) ?? 0) + 1);
  }

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-5xl space-y-8">
        <Rise className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] font-semibold leading-[1] tracking-[-0.03em]">
              ML readiness
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-[1.7] text-foreground/65">
              How many labelled outcomes exist in the ML-ready dataset and how
              close that is to the agreed minimum that makes training realistic.
            </p>
          </div>
          <Link className="text-sm font-bold text-brand hover:underline" href="/admin">
            ← Platform management
          </Link>
        </Rise>

        {error && (
          <Rise>
            <p
              role="alert"
              className="rounded-2xl border border-destructive/20 bg-destructive/[0.06] px-5 py-4 text-sm font-bold text-destructive"
            >
              The dataset could not be read. The count below reflects no data
              — verify access before treating it as a real measurement.
            </p>
          </Rise>
        )}

        <Group className="space-y-6">
          <Rise>
            <div className="rounded-2xl border border-black/[0.06] bg-white px-6 py-6 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                Labelled outcomes
              </p>
              <p
                data-testid="readiness-label"
                className="mt-2 text-3xl font-extrabold tracking-tight tabular-nums"
              >
                {readiness.label}
              </p>
              <div
                className="mt-4 h-2 overflow-hidden rounded-full bg-black/[0.08]"
                role="progressbar"
                aria-valuenow={readiness.labelledCount}
                aria-valuemin={0}
                aria-valuemax={readiness.threshold}
              >
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${readiness.percent}%`,
                    backgroundColor: readiness.met ? "#0f766e" : "#111827",
                  }}
                />
              </div>
              <p data-testid="readiness-detail" className="mt-3 text-sm leading-[1.6] text-foreground/65">
                {readiness.met
                  ? "Threshold met — the dataset is large enough to start training experiments."
                  : `${readiness.remaining} more labelled outcome${readiness.remaining === 1 ? "" : "s"} needed before training is realistic.`}
              </p>
            </div>
          </Rise>

          <Rise>
            <div className="rounded-2xl border border-black/[0.06] bg-white px-6 py-6 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                By outcome
              </p>
              {labelCounts.size > 0 ? (
                <ul data-testid="label-breakdown" className="mt-3 space-y-1.5 text-sm">
                  {[...labelCounts.entries()]
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([label, n]) => (
                      <li key={label} className="flex justify-between tabular-nums">
                        <span className="capitalize text-foreground/70">{label.replaceAll("_", " ")}</span>
                        <span className="font-bold">{n}</span>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-foreground/65">
                  No labelled outcomes yet — every scored attempt still awaits an
                  outcome. Once CAMs record replies and conversions, the breakdown
                  appears here.
                </p>
              )}
            </div>
          </Rise>
        </Group>
      </Stage>
    </div>
  );
}
