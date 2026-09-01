import Link from "next/link";
import type { FollowUpRecommendation } from "@/lib/outreach/follow-up-recommendations";

/**
 * F160/F161 — the follow-up recommendations as their own card.
 *
 * The recommendations were already being computed for the dashboard and then
 * used only to hang a badge on the Needs Attention rows, which meant the
 * platform knew exactly which clients were overdue a follow-up and said so only
 * as an annotation on a list sorted by something else. This is the same
 * `followUpRecommendations` output, ordered by its own urgency rule (urgent
 * first, longest silence within each level) — a work queue rather than a
 * footnote.
 *
 * The card is capped and says how many it withheld, rather than growing without
 * limit: a CAM with 60 overdue clients needs a prompt to open the filtered list,
 * not a 60-row card to scroll.
 */

const VISIBLE_LIMIT = 6;

export function FollowUpsDueCard({
  recommendations,
  actorId,
}: {
  recommendations: FollowUpRecommendation[];
  actorId: string;
}) {
  const urgent = recommendations.filter((rec) => rec.urgency === "urgent").length;
  const visible = recommendations.slice(0, VISIBLE_LIMIT);
  const hidden = recommendations.length - visible.length;

  return (
    <div className="h-full flex flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm dark:border-white/[0.08] dark:bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pb-3 pt-5">
        <h3 className="text-[16px] font-semibold tracking-tight text-foreground">
          Follow-ups due
        </h3>
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
          {recommendations.length === 0
            ? "Nothing overdue"
            : urgent > 0
              ? `${recommendations.length} due · ${urgent} urgent`
              : `${recommendations.length} due`}
        </p>
      </div>

      {recommendations.length === 0 ? (
        <p className="px-5 pb-8 pt-2 text-sm leading-[1.7] text-foreground/55">
          None of your clients have gone quiet past your follow-up thresholds. This
          card fills in as clients pass them — you can change the thresholds in
          your outreach preferences.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-black/[0.06] border-t border-black/[0.06]">
            {visible.map((rec) => (
              <li key={rec.organisationId}>
                <Link
                  href={`/clients/${rec.organisationId}`}
                  className="group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-black/[0.02] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
                >
                  {/* The urgency rail: colour before text, so the eye finds the
                      urgent rows without reading the badges. */}
                  <span
                    aria-hidden="true"
                    className={`h-8 w-[3px] shrink-0 rounded-full ${
                      rec.urgency === "urgent" ? "bg-destructive" : "bg-foreground/15"
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold">{rec.legalName}</span>
                    <span className="mt-0.5 block truncate text-[12px] text-foreground/50">
                      {rec.statusLabel} · silent {rec.daysWaiting} day
                      {rec.daysWaiting === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] ${
                      rec.urgency === "urgent"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-black/[0.05] text-foreground/55"
                    }`}
                  >
                    {rec.urgency === "urgent" ? "Follow up now" : "Due"}
                  </span>
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-foreground/25 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-foreground/55"
                  >
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {hidden > 0 && (
            <Link
              href={`/clients?owner=${actorId}`}
              className="border-t border-black/[0.06] px-5 py-3 text-[12px] font-bold text-foreground/50 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
            >
              +{hidden} more overdue — open my clients →
            </Link>
          )}
        </>
      )}
    </div>
  );
}

export default FollowUpsDueCard;
