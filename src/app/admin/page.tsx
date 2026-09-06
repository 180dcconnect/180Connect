import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";

/**
 * `/admin` is the catch-all inventory of admin workspaces.
 *
 * The sidebar is the front door for what admins touch often; pages grouped
 * under one sidebar entry (Data imports, Platform settings — see
 * `src/app/admin/import-group.ts`) also keep a tile here so nothing depends on
 * remembering which group hid it. Tiles here are organised by the job they do,
 * not by where they also appear.
 *
 * The rule that made the old redirect necessary still stands: a tile for a
 * feature that does not exist is worse than no tile, because the user spends a
 * click finding out. Add a tile here only when its route exists.
 */

function Tile({ href, title, children }: { href: string; title: string; children: React.ReactNode }) {
  return (
    <Link className="rounded-xl border border-black/10 p-5 hover:border-brand" href={href}>
      <h2 className="font-bold">{title}</h2>
      <p className="mt-1 text-sm text-foreground/65">{children}</p>
    </Link>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-8">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">{label}</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

export default async function AdminPage() {
  const authorization = await getCurrentActor("user:manage", { route: "/admin" });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto max-w-5xl rounded-2xl bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-3xl font-bold">All admin tools</h1>
          <p className="mt-3 max-w-2xl text-sm text-foreground/65">
            Every privileged workspace, grouped by the job it does. Each page
            checks permission again on the server.
          </p>
        </div>

        <Section label="Team & people">
          <Tile href="/admin/users" title="User management">
            Assign roles, and suspend, deactivate or reactivate access.
          </Tile>
          <Tile href="/admin/offboard" title="Work handover & offboarding">
            Reassign an outgoing CAM&apos;s clients and open actions to another team member.
          </Tile>
          <Tile href="/admin/cam-settings" title="CAM queue settings">
            View outreach preferences and queue configuration for team members.
          </Tile>
        </Section>

        <Section label="Approvals & data quality">
          <Tile href="/admin/review" title="Review queue">
            Review records held for validation and status changes flagged during sync.
          </Tile>
          <Tile href="/admin/suppressions" title="Suppressions">
            Suppress a charity, or approve/reject a CAM&apos;s request.
          </Tile>
          <Tile href="/admin/ownership-requests" title="Ownership requests">
            Decide who gets a client when a CAM asks for one another CAM owns.
          </Tile>
          <Tile href="/admin/edit-suggestions" title="Suggested client edits">
            Approve or reject CAM-proposed corrections to sensitive client fields.
          </Tile>
          <Tile href="/admin/manual-entries" title="Manual client entries">
            Review organisations submitted manually by CAMs.
          </Tile>
          <Tile href="/admin/duplicates" title="Possible duplicates">
            Review charities the import pipeline flagged as likely duplicates.
          </Tile>
          <Tile href="/admin/discrepancies" title="Data discrepancies">
            Review fields where two sources disagree and choose which value to keep.
          </Tile>
        </Section>

        <Section label="Data imports">
          <Tile href="/admin/import-status" title="Import status">
            See whether data ingestion runs succeeded, partially succeeded, or failed.
          </Tile>
          <Tile href="/admin/companies-house" title="Companies House import">
            Import UK company records into the ingestion pipeline.
          </Tile>
          <Tile href="/admin/charity-commission" title="Charity Commission import">
            Bring UK charity registration and contact data into the ingestion pipeline.
          </Tile>
          <Tile href="/admin/three-sixty-giving" title="360Giving import">
            Attach grant and funding history to charities already in the pipeline.
          </Tile>
        </Section>

        <Section label="Platform settings">
          <Tile href="/settings/score-settings" title="Score settings">
            Tune how much each parameter counts towards client priority scores.
          </Tile>
          <Tile href="/settings/data-handling-rules" title="Data handling rules">
            Manage which fields from external sources are stored or excluded.
          </Tile>
          <Tile href="/settings/restricted-fields" title="Restricted client fields">
            Choose which client fields CAMs must propose corrections to instead of editing.
          </Tile>
          <Tile href="/admin/sending-limits" title="Outreach sending limit">
            Set the branch mailbox&apos;s daily outreach sending cap.
          </Tile>
        </Section>

        <Section label="Oversight & intelligence">
          <Tile href="/admin/team-pipeline" title="Team pipeline">
            Every client&apos;s pipeline stage across the whole team, by stage or owning CAM.
          </Tile>
          <Tile href="/admin/audit-log" title="Audit log">
            Every recorded action, most recent first.
          </Tile>
          <Tile href="/admin/feedback" title="Feedback">
            Review what signed-in users have told the platform.
          </Tile>
          <Tile href="/admin/ai-generations" title="AI generation history">
            Every generated email draft, by model — compare performance and cost.
          </Tile>
          <Tile href="/admin/ml-readiness" title="ML readiness">
            How many labelled outcomes exist in the ML dataset and how close that is to the training threshold.
          </Tile>
        </Section>
      </section>
    </main>
  );
}
