import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import type { AppRole } from "@/lib/auth/permissions";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { ROLE_OPTIONS } from "@/app/admin/users/role-options";
import { PasswordPanel } from "./password-panel";
import { ProfilePanel } from "./profile-panel";

const ROLE_LABEL: Record<AppRole, string> = {
  cam: "CAM",
  admin: "Admin",
  viewer: "Viewer",
};

/**
 * Profile (F015) and account settings (F200 / F201) are one screen, not two:
 * the display name and read-only auth details are configured together here.
 * Notification delivery frequency is *not* on this screen — F178 made
 * /settings/notifications the one place that is set, so this page does not
 * read or write `users.notification_frequency` at all (a second copy of a
 * field is how two controls for it drift apart). This is the view; the
 * display name opens in place.
 *
 * ── The layout ──
 *
 * The Data imports skeleton (`admin/charity-commission/page.tsx`), in the
 * Filed Record language (`docs/app-design-system.md`): a heading, one rail of
 * facts under it — who you are signed in as — and then a card per job. The
 * rail replaces a paragraph that told you what the page was for; the cards
 * already say that.
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
  const roleLabel = ROLE_LABEL[actor.role] ?? actor.role;
  // The same sentence the invite sheet shows when the role is chosen, so what
  // an admin agreed to and what the member reads here are one piece of copy.
  const roleDescription =
    ROLE_OPTIONS.find((option) => option.value === actor.role)?.description ?? null;

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="w-full space-y-8">
        <Rise>
          <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] leading-[1] font-semibold tracking-[-0.03em] text-ink">
            Profile &amp; account
          </h1>
        </Rise>

        <Group className="space-y-4">
          <Rise>
            <ProfilePanel
              initialFullName={actor.fullName ?? ""}
              email={actor.email}
              roleLabel={roleLabel}
              roleDescription={roleDescription}
            />
          </Rise>

          <Rise>
            <PasswordPanel />
          </Rise>
        </Group>
      </Stage>
    </div>
  );
}
