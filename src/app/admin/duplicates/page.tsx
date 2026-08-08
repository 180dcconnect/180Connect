import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { reportError } from "@/lib/error-logging";
import { POTENTIAL_DUPLICATE_SELECT, type PotentialDuplicateRow } from "@/lib/duplicates";
import { DuplicatesPanel } from "./duplicates-panel";

export default async function DuplicatesPage() {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/admin/duplicates",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("potential_duplicates")
    .select(POTENTIAL_DUPLICATE_SELECT)
    .order("created_at", { ascending: false })
    .overrideTypes<PotentialDuplicateRow[], { merge: false }>();

  if (error) {
    await reportError(error, { operation: "admin.duplicates.page_list" });
  }

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto w-full max-w-4xl rounded-2xl bg-white p-8 shadow-sm">
        <p className="text-sm font-bold text-brand">Admin workspace</p>
        <h1 className="mt-2 text-2xl font-bold">Possible duplicate charities</h1>
        <p className="mt-3 text-sm text-foreground/65">
          The import pipeline flags a new record here instead of saving it whenever it
          looks like a charity already in the system — matched on registration number,
          or on name and postcode. Confirm to leave it as one record, or dismiss to add
          it as a separate charity.
        </p>

        {error && (
          <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800" role="alert">
            Some data could not be loaded. Refresh and try again.
          </p>
        )}

        <DuplicatesPanel initialDuplicates={data ?? []} />
      </section>
    </main>
  );
}
