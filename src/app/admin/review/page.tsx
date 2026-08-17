import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { ReviewPanel, type DataQualityEventRow, type StatusFlagRow } from "./review-panel";

export default async function ReviewQueuePage() {
  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) {
    if (authorization.reason === "unauthenticated") redirect("/login");
    redirect("/dashboard?error=admin-access-required");
  }

  const supabase = await createClient();

  const [events, flags] = await Promise.all([
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
  ]);

  if (events.error || flags.error) {
    await reportError(events.error ?? flags.error, { operation: "admin.review.page_load" });
  }

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto max-w-5xl rounded-2xl bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Review queue</h1>
            <p className="mt-3 max-w-2xl text-sm text-foreground/65">
              Records held for human review before joining the working list, and
              organisations whose Companies House or Charity Commission status
              changed and need a look.
            </p>
          </div>
          <Link className="text-sm font-bold text-brand hover:underline" href="/admin">
            Back to admin
          </Link>
        </div>

        {(events.error || flags.error) ? (
          <p className="mt-8 rounded-lg bg-red-50 p-4 text-sm font-bold text-red-900" role="alert">
            The review queue could not be loaded. Please refresh and try again.
          </p>
        ) : (
          <ReviewPanel initialEvents={events.data ?? []} initialFlags={flags.data ?? []} />
        )}
      </section>
    </main>
  );
}
