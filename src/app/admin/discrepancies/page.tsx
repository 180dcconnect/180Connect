import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";
import { FIELD_DISCREPANCY_SELECT, type FieldDiscrepancyRow } from "@/lib/discrepancies";
import { DiscrepanciesPanel } from "./discrepancies-panel";

export default async function DiscrepanciesPage() {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/admin/discrepancies",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("field_discrepancies")
    .select(FIELD_DISCREPANCY_SELECT)
    .order("created_at", { ascending: false })
    .overrideTypes<FieldDiscrepancyRow[], { merge: false }>();

  if (error) {
    await reportError(error, { operation: "admin.discrepancies.page_list" });
  }

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto w-full max-w-4xl rounded-2xl bg-white p-8 shadow-sm">
        <p className="text-sm font-bold text-brand">Admin workspace</p>
        <h1 className="mt-2 text-2xl font-bold">Data discrepancies</h1>
        <p className="mt-3 text-sm text-foreground/65">
          When confirming that an incoming record and an existing charity are the same
          organisation, the pipeline compares their fields. Anywhere a source disagrees
          with what is already stored is flagged here instead of one value silently
          overwriting the other. Pick which value to keep for each flagged field.
        </p>

        {error && (
          <div className="mt-5">
            <InlineAlert variant="page" message="Some data could not be loaded. Refresh and try again." />
          </div>
        )}

        <DiscrepanciesPanel initialDiscrepancies={data ?? []} />
      </section>
    </main>
  );
}
