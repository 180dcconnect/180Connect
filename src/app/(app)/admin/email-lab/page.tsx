import { redirect } from "next/navigation";
import { getViewingActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { isViewOnly } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { InlineAlert } from "@/components/ui/inline-alert";
import { AiHeader } from "../ai-header";
import { EmailLab, type LabClientOption } from "./email-lab";

/**
 * The email prompt lab — one tab of the Artificial Intelligence group.
 *
 * What it answers: "what are we actually telling the model, and would a
 * different instruction write a better email?" Before this page the only way to
 * see the outreach prompt was to read `stage-one-prompt.ts`, and the only way
 * to try a change to it was to edit that file and redeploy.
 *
 * Nothing on this page is saved and nothing on it changes what a CAM's Compose
 * button sends — see `actions.ts`. It is a place to find out.
 *
 * The root element is a `div`, not a `main`: the admin layout's AppShell
 * already renders the `main` this is slotted into.
 */
export default async function EmailLabPage() {
  const authorization = await getViewingActor("platform-settings:manage", {
    route: "/admin/email-lab",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const supabase = await createClient();
  // Enough of the list to find anybody by typing, few enough to ship in one
  // payload. Ordered by name because that is how somebody looks for a client
  // they have in mind, not by when the row was created.
  const { data: rows, error } = await supabase
    .from("organisations")
    .select("id, legal_name, trading_name, city")
    .order("legal_name", { ascending: true })
    .limit(500);
  if (error) {
    await reportError(error, { operation: "admin.email_lab.load_client_list" });
  }

  const clients: LabClientOption[] = (rows ?? []).map((row) => ({
    id: row.id,
    name: row.trading_name?.trim() || row.legal_name,
    secondary: [row.trading_name?.trim() ? row.legal_name : null, row.city]
      .filter(Boolean)
      .join(" · "),
  }));

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <Stage className="w-full space-y-6">
        <Rise>
          <AiHeader current="/admin/email-lab">
            <p className="mt-3 text-[13px] leading-[1.55] text-dim">
              Try the outreach email writer on a real client, and see exactly
              what we ask it to do. Change the wording, send it again, compare
              the two. Nothing here is saved, and nothing you do on this page
              changes the emails your team drafts from a client record.
            </p>
            {error && (
              <div className="mt-4">
                <InlineAlert
                  variant="page"
                  message="The client list could not be loaded, so there is nobody to pick. Refresh the page; if it keeps happening, tell a developer."
                />
              </div>
            )}
          </AiHeader>
        </Rise>

        <Group className="space-y-6">
          <EmailLab clients={clients} viewOnly={isViewOnly(authorization.actor.role)} />
        </Group>
      </Stage>
    </div>
  );
}
