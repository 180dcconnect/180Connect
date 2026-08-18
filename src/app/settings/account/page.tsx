import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { AccountSettingsForm } from "./account-form";

export default async function AccountSettingsPage() {
  const authorization = await getCurrentActor(undefined, {
    route: "/settings/account",
  });
  if (!authorization.ok) {
    redirect("/login");
  }

  // No permission argument above: every signed-in role has an account to
  // maintain, and the write is confined to the caller's own row by RLS rather
  // than by a role check here.
  const actor = authorization.actor;

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto max-w-xl rounded-2xl bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Account</h1>
            <p className="mt-1 text-sm text-foreground/65">
              Manage the details shown on your profile.
            </p>
          </div>
          <Link
            className="text-sm font-bold text-brand hover:underline"
            href="/settings"
          >
            All settings
          </Link>
        </div>

        <AccountSettingsForm
          initialFullName={actor.fullName ?? ""}
          email={actor.email}
          role={actor.role}
        />
      </section>
    </main>
  );
}
