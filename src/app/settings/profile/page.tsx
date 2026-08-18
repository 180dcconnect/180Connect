import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { Group, Rise, Stage } from "@/components/dashboard-stage";

/**
 * The profile tab (F015): what the rest of the team sees about you, read-only.
 * Editing lives one row down in Account (F200) — this screen is the view, that
 * one is the form, and keeping them apart is what stops two controls for the
 * same field drifting out of sync.
 */
export default async function ProfileSettingsPage() {
  const authorization = await getCurrentActor(undefined, {
    route: "/settings/profile",
  });
  if (!authorization.ok) {
    redirect("/login");
  }

  const actor = authorization.actor;
  const fields = [
    { label: "Display name", value: actor.fullName?.trim() || "Not set" },
    { label: "Email", value: actor.email ?? "—" },
    { label: "Role", value: actor.role },
  ];

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-2xl space-y-10">
        <Rise>
          <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
            Profile
          </h1>
          <p className="mt-3 text-sm leading-[1.7] text-foreground/65">
            How you appear to the rest of the team.
          </p>
        </Rise>

        <Group className="space-y-3">
          <Rise>
            <dl className="divide-y divide-black/[0.06] rounded-2xl border border-black/[0.06] bg-white px-6 shadow-sm">
              {fields.map((field) => (
                <div
                  key={field.label}
                  className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 py-5"
                >
                  <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                    {field.label}
                  </dt>
                  <dd className="text-sm text-foreground/85">{field.value}</dd>
                </div>
              ))}
            </dl>
          </Rise>

          <Rise>
            <p className="px-1 text-sm leading-[1.7] text-foreground/65">
              Your display name is edited in{" "}
              <Link
                className="font-bold text-brand hover:underline"
                href="/settings/account"
              >
                Account
              </Link>
              . Your email is changed through your login details, and your role is
              set by an administrator.
            </p>
          </Rise>
        </Group>
      </Stage>
    </div>
  );
}
