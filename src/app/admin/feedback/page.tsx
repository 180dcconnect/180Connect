import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { reportError } from "@/lib/error-logging";
import { averageRating, RATING_LABELS } from "@/lib/feedback";
import { Group, Rise } from "@/components/dashboard-stage";
import { RequestFeedbackButton } from "./request-feedback-button";

type FeedbackRow = {
  id: string;
  user_id: string;
  rating: number;
  comment: string | null;
  page_context: string | null;
  created_at: string;
};

type UserOption = { id: string; email: string; full_name: string | null };

/** Face emoji per rating level 1–5 */
const RATING_EMOJI = ["😡", "😕", "😐", "🙂", "😄"];

function relativeTime(dateStr: string, now: Date): string {
  const date = new Date(dateStr);
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Admin feedback page — lists all feedback submissions, most recent first.
 *
 * Follows the same layout as the audit log page: bone ground, white floating
 * cards, display heading + eyebrow summary, staged blur-up entrance.
 */
export default async function FeedbackPage() {
  const authorization = await getCurrentActor("user:manage", {
    route: "/admin/feedback",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const supabase = await createClient();

  const [{ data: rows, error }, { data: userOptions }] = await Promise.all([
    supabase
      .from("feedback")
      .select("id, user_id, rating, comment, page_context, created_at")
      .order("created_at", { ascending: false })
      .limit(200)
      .overrideTypes<FeedbackRow[], { merge: false }>(),
    supabase
      .from("users")
      .select("id, email, full_name")
      .order("email")
      .overrideTypes<UserOption[], { merge: false }>(),
  ]);

  if (error) {
    await reportError(error, { operation: "admin.feedback.page_list" });
  }

  const people = new Map(
    (userOptions ?? []).map((u) => [u.id, u.full_name?.trim() || u.email]),
  );

  const entries = rows ?? [];
  const ratings = entries.map((r) => r.rating);
  const avg = averageRating(ratings);
  const now = new Date();

  // Rating distribution for the summary bar
  const distribution = [0, 0, 0, 0, 0]; // index 0 = rating 1, etc.
  for (const r of ratings) {
    distribution[r - 1]++;
  }
  const maxCount = Math.max(...distribution, 1);

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-5xl space-y-10">
        <Group className="space-y-6">
          <Rise className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
            <div className="min-w-0">
              <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
                Feedback
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-[1.7] text-foreground/65">
                What the team thinks about 180Connect. Ratings are collected
                periodically via the in-app prompt. Responses are anonymous to
                the submitter but visible here.
              </p>
            </div>
            <RequestFeedbackButton />
          </Rise>

          {/* Summary strip */}
          <Rise>
            <div className="rounded-2xl border border-black/[0.06] bg-white px-6 py-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
                {/* Overall stats */}
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{avg !== null ? RATING_EMOJI[Math.round(avg) - 1] : "—"}</span>
                  <div>
                    <p className="text-2xl font-extrabold tabular-nums tracking-tight">
                      {avg !== null ? avg.toFixed(1) : "—"}
                    </p>
                    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                      {entries.length} response{entries.length === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>

                {/* Distribution mini-bars */}
                <div className="flex flex-1 items-end gap-1.5" style={{ minWidth: 180 }}>
                  {distribution.map((count, i) => (
                    <div key={i} className="flex flex-1 flex-col items-center gap-1">
                      <div
                        className="w-full rounded-md"
                        style={{
                          height: Math.max(4, (count / maxCount) * 40),
                          backgroundColor: count > 0
                            ? ["#f43f5e", "#f97316", "#fbbf24", "#84cc16", "#10b981"][i]
                            : "rgba(0,0,0,0.06)",
                          transition: "height 0.3s ease",
                        }}
                      />
                      <span className="text-[10px] font-medium text-foreground/40">
                        {RATING_LABELS[i]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Rise>
        </Group>

        {/* Feedback entries */}
        <Group className="space-y-3">
          <Rise>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
              <span className="tabular-nums">{entries.length}</span> response
              {entries.length === 1 ? "" : "s"}
              {entries.length === 200 && " · showing most recent 200"}
            </p>
          </Rise>

          {entries.length > 0 ? (
            entries.map((entry) => (
              <Rise key={entry.id}>
                <div className="rounded-2xl border border-black/[0.06] bg-white px-5 py-4 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl" role="img" aria-label={RATING_LABELS[entry.rating - 1]}>
                        {RATING_EMOJI[entry.rating - 1]}
                      </span>
                      <div>
                        <p className="text-sm font-bold text-foreground/80">
                          {people.get(entry.user_id) ?? "Unknown user"}
                        </p>
                        <p className="text-xs text-foreground/40">
                          {relativeTime(entry.created_at, now)}
                          {entry.page_context && (
                            <span className="text-foreground/25"> · {entry.page_context}</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums" style={{
                      color: ["#f43f5e", "#f97316", "#d97706", "#65a30d", "#059669"][entry.rating - 1],
                      backgroundColor: ["#f43f5e", "#f97316", "#d97706", "#65a30d", "#059669"].map(c => c + "12")[entry.rating - 1],
                    }}>
                      {entry.rating}/5
                    </span>
                  </div>
                  {entry.comment && (
                    <p className="mt-3 border-t border-black/[0.04] pt-3 text-sm leading-[1.7] text-foreground/60">
                      {entry.comment}
                    </p>
                  )}
                </div>
              </Rise>
            ))
          ) : (
            <Rise>
              <div className="rounded-2xl border border-black/[0.06] bg-white px-5 py-10 shadow-sm">
                <p className="text-center text-sm leading-[1.7] text-foreground/65">
                  No feedback has been submitted yet. The prompt appears on the
                  dashboard after a user has been active for at least 7 days, or
                  when you request a feedback round.
                </p>
              </div>
            </Rise>
          )}
        </Group>
      </div>
    </div>
  );
}
