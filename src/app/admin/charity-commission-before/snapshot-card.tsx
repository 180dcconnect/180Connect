import { Database, TriangleAlert } from "lucide-react";

import { RefreshButton } from "./refresh-button";

/**
 * The staged register: how current it is, and how to refresh it.
 *
 * Deliberately not a button. The extracts are ~1.8GB uncompressed and take a
 * couple of minutes to stream, which is not work for a serverless function with
 * a 300s ceiling — so the page hands over the exact command rather than
 * pretending to be one.
 *
 * What this card is *not* is the place where anything is decided. The snapshot
 * filters nothing: it stages the whole register of England and Wales so that
 * every criterion can be a query underneath, changeable by anyone on the team
 * without a code change. That separation is the point of the redesign, and this
 * card says so where the old one used to display the criteria as settled fact.
 */
export function SnapshotCard({
  snapshotDate,
  registerSize,
  staleDays,
  canRefresh,
}: {
  snapshotDate: string | null;
  registerSize: number;
  /** Whether this deployment can trigger a rebuild (GITHUB_REGISTER_TOKEN set). */
  canRefresh: boolean;
  /**
   * How old the snapshot is, in days. Computed by the page rather than here:
   * reading the clock during render is impure, and the page is the async server
   * component that already owns one clock for the whole screen.
   */
  staleDays: number | null;
}) {
  // The regulator republishes daily. A week is the point at which a newly
  // registered charity is likely missing and a closure likely unrecorded.
  const stale = staleDays !== null && staleDays > 7;

  return (
    <section className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-xs sm:p-6">
      <div className="flex items-start gap-3.5">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
          <Database className="h-4 w-4" strokeWidth={2.2} />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-foreground">Charity register</h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-[1.6] text-foreground/65">
            A copy of the Charity Commission&rsquo;s register that ships with the
            app, with no criteria applied to it. Everything you filter on below is
            a search over this file — which is why it costs the database nothing
            and why changing what you import needs no code change.
          </p>
        </div>
      </div>

      {snapshotDate ? (
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
          <span className="text-foreground/70">{registerSize.toLocaleString()}</span> charities
          {" · "}
          taken{" "}
          <span className="text-foreground/70">
            {new Date(snapshotDate).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
          {staleDays !== null && staleDays > 0 && (
            <span className={stale ? "text-amber-800" : ""}>
              {" · "}
              {staleDays} day{staleDays === 1 ? "" : "s"} old
            </span>
          )}
        </p>
      ) : (
        <p className="mt-4 text-sm text-foreground/55">
          The register is not loaded on this deployment. Refresh it below —
          nothing can be imported until it has been built.
        </p>
      )}

      {stale && (
        <p className="mt-3 flex items-start gap-2 text-xs leading-[1.6] text-amber-900">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
          <span>
            The regulator republishes daily. A copy this old may miss recent
            registrations and still list charities that have since closed.
          </span>
        </p>
      )}

      <RefreshButton configured={canRefresh} />
    </section>
  );
}
