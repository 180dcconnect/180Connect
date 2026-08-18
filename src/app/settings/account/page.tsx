import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { Rise, Stage } from "@/components/dashboard-stage";
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
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-2xl space-y-10">
        <Rise>
          <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
            Account
          </h1>
          <p className="mt-3 text-sm leading-[1.7] text-foreground/65">
            Manage the details shown on your profile.
          </p>
        </Rise>

        <Rise>
          <AccountSettingsForm
            initialFullName={actor.fullName ?? ""}
            email={actor.email}
            role={actor.role}
          />
        </Rise>
      </Stage>
    </div>
  );
}
