import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";
import { excludeResolvedReviewFlags } from "@/lib/gmail/reply-message";
import {
  ReviewPanel,
  type DataQualityEventRow,
  type StatusFlagRow,
  type UnmatchedReplyRow,
} from "./review-panel";

export default async function ReviewQueuePage() {
  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) {
    if (authorization.reason === "unauthenticated") redirect("/login");
    redirect("/dashboard?error=admin-access-required");
  }

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
      .limit(200)
      .overrideTypes<DataQualityEventRow[], { merge: false }>(),
    supabase
      .from("organisation_status_flags")
      .select(
        "id, organisation_id, source, company_number, previous_status, new_status, " +
          "detected_at, resolved, resolved_at, organisations ( legal_name )",
      )
      .order("detected_at", { ascending: false })
      .limit(200)
      .overrideTypes<StatusFlagRow[], { merge: false }>(),
    supabase
      .from("audit_log")
      .select("id, detail, created_at")
      .eq("action", "gmail_reply_needs_review")
      .eq("target_table", "gmail_unmatched_replies")
      .order("created_at", { ascending: false })
      .limit(200)
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

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto max-w-5xl rounded-2xl bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Review queue</h1>
            <p className="mt-3 max-w-2xl text-sm text-foreground/65">
              Replies that could not be linked safely, records held before joining
              the working list, and organisation status changes that need a look.
            </p>
          </div>
          <Link className="text-sm font-bold text-brand hover:underline" href="/admin">
            Back to admin
          </Link>
        </div>

        {(events.error || flags.error || unmatchedReplies.error || resolvedReplies.error) ? (
          <div className="mt-8">
            <InlineAlert
              variant="page"
              message="The review queue could not be loaded. Please refresh and try again."
            />
          </div>
        ) : (
          <ReviewPanel
            initialEvents={events.data ?? []}
            initialFlags={flags.data ?? []}
            initialUnmatchedReplies={openUnmatchedReplies}
          />
        )}
      </section>
    </main>
  );
}
