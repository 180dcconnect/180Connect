import { redirect } from "next/navigation";
import { getViewingActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { excludeResolvedReviewFlags } from "@/lib/gmail/reply-message";
import {
  ReviewPanel,
  type DataQualityEventRow,
  type StatusFlagRow,
  type UnmatchedReplyRow,
} from "./review-panel";

/**
 * The window each queue reads. The rail reports "200+" when a list fills it,
 * rather than a number nobody can stand behind: the true count may be higher.
 */
const REVIEW_WINDOW = 200;

/**
 * Is anything waiting, in one line.
 *
 * The same rail the Data imports screens carry under their heading
 * (register-rail.tsx) and the duplicates queue carries under its: a dot that
 * carries the state as well as the words — amber when there is work, green
 * when the queue is clear — with the decided count beside it so clearing the
 * queue reads as progress. Nothing renders until something has been held at
 * least once: on a first visit the cards below already explain what each queue
 * is for, and a line above them repeating that would be the same sentence
 * twice.
 */
function QueueRail({
  open,
  decided,
  capped,
}: {
  open: number;
  decided: number;
  capped: boolean;
}) {
  if (open === 0 && decided === 0) return null;

  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 font-body text-sm text-dim">
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${open > 0 ? "bg-hold" : "bg-go"}`}
      />
      {open > 0 ? (
        <>
          <span className="font-semibold tabular-nums text-ink">
            {open.toLocaleString()}
            {capped ? "+" : ""}
          </span>
          {open === 1 && !capped ? "thing is" : "things are"} waiting for a decision
        </>
      ) : (
        <>
          Nothing is waiting for a decision ·{" "}
          <span className="font-semibold tabular-nums text-ink">
            {decided.toLocaleString()}
            {capped ? "+" : ""}
          </span>{" "}
          already decided
        </>
      )}
    </p>
  );
}

export default async function ReviewQueuePage() {
  const authorization = await getViewingActor("user:manage");
  if (!authorization.ok) {
    if (authorization.reason === "unauthenticated") redirect("/login");
    redirect("/dashboard?error=admin-access-required");
  }

  // The page asks the same question the PATCH route asks (`user:manage`),
  // never the role — so the two cannot drift apart the day the permission
  // moves. A viewer fails it and reads every queue without answering any.
  const canReview = hasPermission(authorization.actor.role, "user:manage");

  const supabase = await createClient();

  const [events, flags, unmatchedReplies, resolvedReplies] = await Promise.all([
    supabase
      .from("data_quality_events")
      .select(
        "id, raw_source_record_id, rule_name, rule_category, field_value, severity, " +
          "suggested_fix, resolved, resolved_at, created_at, " +
          "raw_source_records ( raw_payload )",
      )
      .order("created_at", { ascending: false })
      .limit(REVIEW_WINDOW)
      .overrideTypes<DataQualityEventRow[], { merge: false }>(),
    supabase
      .from("organisation_status_flags")
      .select(
        "id, organisation_id, source, company_number, previous_status, new_status, " +
          "detected_at, resolved, resolved_at, organisations ( legal_name )",
      )
      .order("detected_at", { ascending: false })
      .limit(REVIEW_WINDOW)
      .overrideTypes<StatusFlagRow[], { merge: false }>(),
    supabase
      .from("audit_log")
      .select("id, detail, created_at")
      .eq("action", "gmail_reply_needs_review")
      .eq("target_table", "gmail_unmatched_replies")
      .order("created_at", { ascending: false })
      .limit(REVIEW_WINDOW)
      .overrideTypes<UnmatchedReplyRow[], { merge: false }>(),
    supabase
      .from("audit_log")
      .select("detail")
      .eq("action", "gmail_reply_review_resolved")
      .limit(500)
      .overrideTypes<{ detail: { provider_message_id?: unknown } }[], { merge: false }>(),
  ]);

  if (events.error || flags.error || unmatchedReplies.error || resolvedReplies.error) {
    await reportError(events.error ?? flags.error ?? unmatchedReplies.error ?? resolvedReplies.error, {
      operation: "admin.review.page_load",
    });
  }

  const openUnmatchedReplies = excludeResolvedReviewFlags(
    unmatchedReplies.data ?? [],
    resolvedReplies.data ?? [],
  );
  const openEvents = (events.data ?? []).filter((event) => !event.resolved);
  const openFlags = (flags.data ?? []).filter((flag) => !flag.resolved);
  const decidedCount =
    (events.data ?? []).filter((event) => event.resolved).length +
    (flags.data ?? []).filter((flag) => flag.resolved).length;
  const openCount = openEvents.length + openFlags.length + openUnmatchedReplies.length;
  const capped =
    (events.data ?? []).length >= REVIEW_WINDOW ||
    (flags.data ?? []).length >= REVIEW_WINDOW ||
    (unmatchedReplies.data ?? []).length >= REVIEW_WINDOW;

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      {/* No max-w-*: content fills the column and the page's side padding sets
          where it stops (docs/app-design-system.md §Width). */}
      <Stage className="w-full space-y-8">
        <Rise>
          <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] leading-[1] font-semibold tracking-[-0.03em] text-ink">
            Review queue
          </h1>
          <p className="mt-3 text-sm leading-[1.7] text-dim">
            Replies that could not be linked safely, records held before joining
            the working list, and organisation status changes that need a look.
          </p>
          <QueueRail open={openCount} decided={decidedCount} capped={capped} />
        </Rise>

        <Group>
          {(events.error || flags.error || unmatchedReplies.error || resolvedReplies.error) ? (
            <Rise>
              <InlineAlert
                variant="page"
                message="The review queue could not be loaded. This has been recorded — refresh and try again."
              />
            </Rise>
          ) : (
            <Rise>
              <ReviewPanel
                canReview={canReview}
                initialEvents={events.data ?? []}
                initialFlags={flags.data ?? []}
                initialUnmatchedReplies={openUnmatchedReplies}
              />
            </Rise>
          )}
        </Group>
      </Stage>
    </div>
  );
}
