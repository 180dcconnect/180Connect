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

        <div className="mt-8 border-t border-black/10 pt-6">
          <h2 className="text-xs font-bold uppercase tracking-wider text-foreground/60">
            Preferences & Settings
          </h2>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/settings/accessibility"
              className="flex-1 rounded-xl border border-black/10 p-4 transition-colors hover:border-brand hover:bg-brand/5"
            >
              <span className="block font-bold text-foreground">
                Accessibility settings
              </span>
              <span className="mt-1 block text-xs text-foreground/60">
                Adjust font size, contrast, line spacing, and motion.
              </span>
            </Link>
            <Link
              href="/settings/outreach-preferences"
              className="flex-1 rounded-xl border border-black/10 p-4 transition-colors hover:border-brand hover:bg-brand/5"
            >
              <span className="block font-bold text-foreground">
                Outreach preferences
              </span>
              <span className="mt-1 block text-xs text-foreground/60">
                Set geography, sector, and size focus for your queue.
              </span>
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
