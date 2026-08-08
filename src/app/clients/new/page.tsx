import Link from "next/link";
import { redirect } from "next/navigation";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { getCurrentActor } from "@/lib/auth/actor";
import { ManualEntryForm } from "./manual-entry-form";

export default async function NewManualClientPage() {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/new" });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));
  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto max-w-2xl rounded-2xl bg-white p-8 shadow-sm">
        <Link className="text-sm font-medium text-brand hover:underline" href="/clients">← Clients</Link>
        <h1 className="mt-4 text-2xl font-bold">Add a client manually</h1>
        <p className="mt-2 text-sm text-foreground/65">Use this when an organisation is not available from an API. An admin must review it before it becomes an active client.</p>
        <ManualEntryForm />
      </section>
    </main>
  );
}
