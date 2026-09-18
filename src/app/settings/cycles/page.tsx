import { redirect } from "next/navigation";

import { getViewingActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { VIEW_ONLY_CONTROL_NOTE } from "@/lib/auth/view-only";
import { isViewOnly } from "@/lib/auth/permissions";
import { cyclePhase, describeCycleWindow, orderCyclesByStart } from "@/lib/outreach-cycles";
import { todayIso } from "@/lib/date-range";
import { CyclesPanel, type CycleSummary } from "./cycles-panel";

/**
 * Outreach cycles: the named stretches of time ("Spring 26") Team analytics
 * compares.
 *
 * Gated on `platform-settings:manage`, the same admin-only permission the save
 * actions enforce — copy the score-settings screen's contract: leadership
 * reads the definitions, only admins change them, and the note below says so
 * in one voice rather than leaving a silent gap where the controls would be.
 *
 * ── The layout ──
 *
 * Filed Record (`docs/app-design-system.md`), as the other settings pages.
 *
 * ── What the page hands the panel ──
 *
 * Every cycle arrives with its `phase` (past, in progress, or not started
 * yet) already decided. "Today" is a server fact here for the same reason
 * `windowLabel` is: a client component working it out for itself would render
 * a different answer than the server did and hydrate into a mismatch.
 */
export default async function OutreachCyclesPage() {
  const authorization = await getViewingActor("platform-settings:manage", {
    route: "/settings/cycles",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("outreach_cycles")
    .select("id, name, starts_on, ends_on")
    .order("starts_on", { ascending: true });

  if (error) {
    await reportError(error, { operation: "settings.cycles.load" });
  }

  const ordered = orderCyclesByStart(
    (data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      starts_on: row.starts_on as string,
      ends_on: row.ends_on as string,
    })),
  );
  const today = todayIso();
  const cycles: CycleSummary[] = ordered.map((cycle) => ({
    id: cycle.id,
    name: cycle.name,
    startsOn: cycle.starts_on,
    endsOn: cycle.ends_on,
    windowLabel: describeCycleWindow(cycle),
    phase: cyclePhase(cycle, today),
  }));

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="w-full space-y-8">
        <Rise>
          <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] leading-[1] font-semibold tracking-[-0.03em] text-ink">
            Outreach cycles
          </h1>
          <p className="mt-5 text-sm leading-[1.7] text-dim">
            A cycle is a named stretch of outreach — Spring 26, say — with a
            first and a last day. Team analytics compares one cycle against
            another, so every email belongs to exactly one: cycles may not
            overlap, and moving a cycle&apos;s dates changes which emails count
            towards it. Deleting a cycle removes the label only — emails and
            numbers are untouched.
          </p>
          {isViewOnly(authorization.actor.role) && (
            <p className="mt-2 text-sm text-dim">{VIEW_ONLY_CONTROL_NOTE}</p>
          )}
        </Rise>

        <Group className="space-y-4">
          <CyclesPanel cycles={cycles} readOnly={isViewOnly(authorization.actor.role)} />
        </Group>
      </Stage>
    </div>
  );
}
