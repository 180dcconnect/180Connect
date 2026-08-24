import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { RestrictedFieldRow } from "@/lib/edit-suggestions";
import { RestrictedFieldsPanel } from "./restricted-fields-panel";

export default async function RestrictedFieldsPage() {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/admin/restricted-fields",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("restricted_edit_fields")
    .select("field_name, reason, active")
    .order("active", { ascending: false })
    .order("field_name")
    .overrideTypes<RestrictedFieldRow[], { merge: false }>();

  if (error) {
    await reportError(error, { operation: "admin.restricted_fields.page_list" });
  }

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto w-full max-w-4xl rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold">Restricted client fields</h1>
        <p className="mt-3 text-sm text-foreground/65">
          Fields listed here as active cannot be saved directly by a CAM — their only
          route is a suggested edit that an admin approves or rejects (#23). Changes
          take effect immediately and are audited. Retired fields keep their history;
          they simply stop being enforced.
        </p>

        {error && (
          <div className="mt-5">
            <InlineAlert variant="page" message="The restricted fields could not be loaded. Refresh and try again." />
          </div>
        )}

        <RestrictedFieldsPanel initialFields={data ?? []} />
      </section>
    </main>
  );
}
