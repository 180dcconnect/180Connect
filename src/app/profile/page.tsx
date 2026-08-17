import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";

export default async function ProfilePage() {
  const authorization = await getCurrentActor();
  if (!authorization.ok) {
    redirect("/login");
  }

  const actor = authorization.actor;

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto max-w-xl rounded-2xl bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">
              {actor.fullName ?? "Unnamed user"}
            </h1>
          </div>
          <Link
            className="text-sm font-bold text-brand hover:underline"
            href="/dashboard"
          >
            Back to dashboard
          </Link>
        </div>

        <dl className="mt-6 space-y-4">
          <div>
            <dt className="text-sm font-bold uppercase tracking-wide text-foreground/60">
              Email
            </dt>
            <dd className="mt-1 text-sm text-foreground/85">{actor.email}</dd>
          </div>
          <div>
            <dt className="text-sm font-bold uppercase tracking-wide text-foreground/60">
              Role
            </dt>
            <dd className="mt-1 text-sm text-foreground/85">{actor.role}</dd>
          </div>
        </dl>

        <p className="mt-6 text-sm text-foreground/65">
          Role changes are made by an administrator — you cannot edit your own
          role here.
        </p>
      </section>
    </main>
  );
}
