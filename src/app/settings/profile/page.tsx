import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { Rise, Stage } from "@/components/dashboard-stage";
import { ProfilePanel } from "./profile-panel";

/**
 * Profile (F015) and account settings (F200) are one screen, not two: the same
 * three fields were on both, and a second copy of a field is how two controls
 * for it drift apart. This is the view; the display name opens in place.
 */
export default async function ProfileSettingsPage() {
  const authorization = await getCurrentActor(undefined, {
    route: "/settings/profile",
  });
  if (!authorization.ok) {
    redirect("/login");
  }

  // No permission argument: every signed-in role has a profile to maintain, and
  // the write is confined to the caller's own row by RLS rather than by a role
  // check here.
  const actor = authorization.actor;

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

        <Rise>
          <ProfilePanel
            initialFullName={actor.fullName ?? ""}
            email={actor.email}
            role={actor.role}
          />
        </Rise>
      </Stage>
    </div>
  );
}
