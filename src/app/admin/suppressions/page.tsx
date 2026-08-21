import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { reportError } from "@/lib/error-logging";
import { SUPPRESSION_SELECT, type SuppressionRow } from "@/lib/suppressions";
import { SuppressionsPanel } from "./suppressions-panel";

type OrganisationOption = { id: string; legal_name: string };

export default async function SuppressionsPage() {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/admin/suppressions",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const supabase = await createClient();

  const [suppressions, organisations] = await Promise.all([
    supabase
      .from("suppressions")
      .select(SUPPRESSION_SELECT)
      .order("created_at", { ascending: false })
      .overrideTypes<SuppressionRow[], { merge: false }>(),
    supabase
      .from("organisations")
      .select("id, legal_name")
      .order("legal_name")
      .overrideTypes<OrganisationOption[], { merge: false }>(),
  ]);

  if (suppressions.error) {
    await reportError(suppressions.error, { operation: "admin.suppressions.page_list" });
  }
  if (organisations.error) {
    await reportError(organisations.error, { operation: "admin.suppressions.page_organisations" });
  }

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto w-full max-w-4xl rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold">Suppress a charity</h1>
        <p className="mt-3 text-sm text-foreground/65">
          Hides a record from the active working list and blocks outreach until the
          suppression is lifted. A reason is required and is kept on file. Suppressing
          here takes effect immediately — an admin does not wait on their own request.
        </p>

        {(suppressions.error || organisations.error) && (
          <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800" role="alert">
            Some data could not be loaded. Refresh and try again.
          </p>
        )}

        <SuppressionsPanel
          initialSuppressions={suppressions.data ?? []}
          organisations={organisations.data ?? []}
        />
      </section>
    </main>
  );
}
