import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";

// Matches supabase/migrations/20260723100000_create_audit_log.sql. No generated
// types file exists yet in this repo, so this is hand-written from the migration.
type AuditLogRow = {
  id: string;
  actor_user_id: string | null;
  action: string;
  target_table: string | null;
  target_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
};

type UserOption = { id: string; email: string; full_name: string | null };
type OrganisationOption = { id: string; legal_name: string };

// Next.js 16: searchParams is a Promise on App Router pages, not a plain
// object (that changed from older versions). Same pattern already merged in
// src/app/login/page.tsx and src/app/reset-password/page.tsx.
type SearchParams = Promise<{ actor?: string; org?: string }>;

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) {
    if (authorization.reason === "unauthenticated") redirect("/login");
    redirect("/dashboard?error=admin-access-required");
  }

  const supabase = await createClient();

  const { actor: actorFilter, org: orgFilter } = await searchParams;

  // RLS also restricts this SELECT to admins (audit_log_select_admin), so a
  // bug in the getCurrentActor check above cannot leak rows to a non-admin —
  // this query fails closed on its own.
  let query = supabase
    .from("audit_log")
    .select("id, actor_user_id, action, target_table, target_id, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (actorFilter) {
    query = query.eq("actor_user_id", actorFilter);
  }
  if (orgFilter) {
    query = query.eq("target_table", "organisations").eq("target_id", orgFilter);
  }

  // overrideTypes is the current @supabase/postgrest-js method for this — it
  // replaced the older .returns<T>(), which is now the deprecated one. See
  // node_modules/@supabase/postgrest-js/src/PostgrestTransformBuilder.ts.
  const { data: rows, error } = await query.overrideTypes<AuditLogRow[], { merge: false }>();

  if (error) {
    // Fail visibly per the project SOP, but never show the raw database error
    // to the user — it can describe internal shape (column/constraint names)
    // that isn't this project's convention to expose.
    await reportError(error, { operation: "admin.audit_log.page_list" });
  }

  // Options for the filter dropdowns. Both tables are readable by any active
  // user (see their own RLS policies), so no extra permission check is needed
  // beyond the admin gate already passed above.
  const [{ data: userOptions }, { data: orgOptions }] = await Promise.all([
    supabase
      .from("users")
      .select("id, email, full_name")
      .order("email")
      // Same overrideTypes note as above — current method, not deprecated.
      .overrideTypes<UserOption[], { merge: false }>(),
    supabase
      .from("organisations")
      .select("id, legal_name")
      .order("legal_name")
      .overrideTypes<OrganisationOption[], { merge: false }>(),
  ]);

  const filtersActive = Boolean(actorFilter || orgFilter);

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto w-full max-w-4xl rounded-2xl bg-white p-8 shadow-sm">
        <p className="text-sm font-bold text-brand">180Connect</p>
        <h1 className="mt-2 text-2xl font-bold">Audit log</h1>
        <p className="mt-3 text-sm text-foreground/65">
          Every recorded action, most recent first. Admin-only, append-only —
          this list can never be edited or deleted, only added to.
        </p>

        <form className="mt-6 flex flex-wrap items-end gap-4" method="get">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-foreground/65">Person</span>
            <select
              name="actor"
              defaultValue={actorFilter ?? ""}
              className="rounded-lg border border-black/10 px-3 py-2 text-sm"
            >
              <option value="">Everyone</option>
              {(userOptions ?? []).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.full_name ?? option.email}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-foreground/65">Client</span>
            <select
              name="org"
              defaultValue={orgFilter ?? ""}
              className="rounded-lg border border-black/10 px-3 py-2 text-sm"
            >
              <option value="">Every client</option>
              {(orgOptions ?? []).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.legal_name}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            className="rounded-full border border-black/10 px-5 py-2 text-sm font-bold hover:bg-black/5"
          >
            Filter
          </button>

          {filtersActive ? (
            <a
              href="/admin/audit-log"
              className="text-sm font-medium text-brand hover:underline"
            >
              Clear filters
            </a>
          ) : null}
        </form>

        {error ? (
          <p className="mt-8 rounded-lg bg-red-50 p-4 text-sm text-red-700">
            Something went wrong loading the audit log. This has been recorded
            — try again shortly.
          </p>
        ) : rows && rows.length > 0 ? (
          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-160 text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-xs uppercase tracking-wide text-foreground/50">
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Action</th>
                  <th className="py-2 pr-4">Actor</th>
                  <th className="py-2 pr-4">Target</th>
                  <th className="py-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-black/5 align-top">
                    <td className="py-3 pr-4 whitespace-nowrap text-foreground/65">
                      {new Date(row.created_at).toLocaleString("en-GB")}
                    </td>
                    <td className="py-3 pr-4 font-medium">{row.action}</td>
                    <td className="py-3 pr-4 text-foreground/65">
                      {row.actor_user_id ?? "system"}
                    </td>
                    <td className="py-3 pr-4 text-foreground/65">
                      {row.target_table ? `${row.target_table} / ${row.target_id}` : "—"}
                    </td>
                    <td className="py-3 font-mono text-xs text-foreground/65">
                      {row.detail && Object.keys(row.detail).length > 0
                        ? JSON.stringify(row.detail)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-8 text-sm text-foreground/65">
            {filtersActive
              ? "Nothing matches this filter."
              : "Nothing has been logged yet."}
          </p>
        )}
      </section>
    </main>
  );
}
