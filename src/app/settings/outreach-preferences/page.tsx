import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { OutreachPreferencesForm } from "./preferences-form";
import type { GeographicReach, IncomeBand } from "./constants";

type OutreachPreferencesRow = {
  preferred_geographic_reach: GeographicReach[] | null;
  preferred_sectors: string[] | null;
  preferred_income_bands: IncomeBand[] | null;
};

export default async function OutreachPreferencesPage() {
  const authorization = await getCurrentActor(undefined, {
    route: "/settings/outreach-preferences",
  });
  if (!authorization.ok) {
    redirect("/login");
  }

  const supabase = await createClient();
  // RLS scopes this to the caller's own row (docs/rls-permission-matrix.md §3.13) —
  // no user_id filter needed here, there is nothing else this query could return.
  const { data } = await supabase
    .from("outreach_preferences")
    .select("preferred_geographic_reach, preferred_sectors, preferred_income_bands")
    .maybeSingle<OutreachPreferencesRow>();

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto max-w-xl rounded-2xl bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Outreach preferences</h1>
            <p className="mt-1 text-sm text-foreground/65">
              Set the geography, sector and size focus for your outreach queue.
            </p>
          </div>
          <Link
            className="text-sm font-bold text-brand hover:underline"
            href="/dashboard"
          >
            Back to dashboard
          </Link>
        </div>

        <OutreachPreferencesForm
          initialGeographicReach={data?.preferred_geographic_reach ?? []}
          initialSectors={data?.preferred_sectors ?? []}
          initialIncomeBands={data?.preferred_income_bands ?? []}
        />
      </section>
    </main>
  );
}
