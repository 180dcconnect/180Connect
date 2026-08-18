import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";

type SettingsSection = {
  href: string;
  title: string;
  description: string;
};

export default async function SettingsPage() {
  const authorization = await getCurrentActor(undefined, { route: "/settings" });
  if (!authorization.ok) {
    redirect("/login");
  }

  const sections: SettingsSection[] = [
    {
      href: "/settings/account",
      title: "Account",
      description: "Your display name, and where your email and role are changed.",
    },
  ];

  // Outreach preferences steer a CAM's own queue, so they are only shown to
  // someone who can act on that queue — a viewer has no outreach to target.
  if (hasPermission(authorization.actor.role, "client:edit")) {
    sections.push({
      href: "/settings/outreach-preferences",
      title: "Outreach preferences",
      description: "The geography, sector and size focus for your outreach queue.",
    });
  }

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto max-w-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="mt-1 text-sm text-foreground/65">
              Your account and the preferences that shape your workflow.
            </p>
          </div>
          <Link
            className="text-sm font-bold text-brand hover:underline"
            href="/dashboard"
          >
            Back to dashboard
          </Link>
        </div>

        <ul className="mt-6 space-y-3">
          {sections.map((section) => (
            <li key={section.href}>
              <Link
                href={section.href}
                className="block rounded-2xl bg-white p-6 shadow-sm transition-colors hover:bg-brand/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
              >
                <span className="block text-base font-bold">{section.title}</span>
                <span className="mt-1 block text-sm text-foreground/65">
                  {section.description}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
