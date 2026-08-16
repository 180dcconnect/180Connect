import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { loadRules } from "./actions";
import { RulesPanel } from "./rules-panel";

/**
 * `/admin/data-handling-rules` — F246 Public Data Handling Rules.
 *
 * Admins review and update the field-level rules that control which fields
 * from external API responses are stored in raw_source_records. Rules are
 * enforced by the ingestion runner (src/lib/ingestion/runner.ts) at the
 * single point where external data enters the platform.
 *
 * The data handling policy §2 commits to this control:
 * "a field-level rule set, held in the database and editable by an admin,
 * is applied at the single point where external data enters the platform."
 */
export default async function DataHandlingRulesPage() {
  const authorization = await getCurrentActor("user:manage", {
    route: "/admin/data-handling-rules",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const { rules, version, error } = await loadRules();

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto w-full max-w-5xl rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold">Data handling rules</h1>
        <p className="mt-3 max-w-2xl text-sm text-foreground/65">
          Field-level rules defining what data from external sources is
          acceptable to store. The ingestion pipeline checks these rules before
          writing &mdash; a denied field is stripped from the raw payload even if
          the source API provides it. Changes here take effect on the next
          import run.
        </p>

        {error && (
          <p
            className="mt-5 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800"
            role="alert"
          >
            {error} Refresh and try again.
          </p>
        )}

        <RulesPanel initialRules={rules} initialVersion={version} />
      </section>
    </main>
  );
}
