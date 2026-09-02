import { notFound, redirect } from "next/navigation";

import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { Stage, Rise } from "@/components/dashboard-stage";
import { formatTeamActivity, type RawTeamActivityRow } from "@/lib/team-activity";

import { TeamMemberHeader, type TeamMemberHeaderData } from "./team-member-header";
import { TeamMemberView, type MemberActivityItem, type MemberNoteItem } from "./team-member-view";
import type { AssignedClientItem } from "./assigned-clients-card";

type Params = Promise<{ id: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: user } = await supabase
    .from("users")
    .select("full_name, email")
    .eq("id", id)
    .maybeSingle();

  if (!user) return { title: "Team Member · 180Connect" };
  const name = user.full_name?.trim() || user.email;
  return { title: `${name} · Team Member Profile` };
}

export default async function TeamMemberPage({ params }: { params: Params }) {
  const { id } = await params;
  const authorization = await getCurrentActor();
  if (!authorization.ok) {
    redirect("/login");
  }

  const supabase = await createClient();

  // Run all profile, client, activity, and intelligence queries concurrently
  const [
    userResult,
    ownedClientsResult,
    suppressionsResult,
    preferencesResult,
    sentMessagesResult,
    notesResult,
    activitiesResult,
  ] = await Promise.all([
    supabase
      .from("users")
      .select(
        "id, email, full_name, role, is_active, deactivated_at, last_seen_at, created_at, invited_at, invite_accepted_at, invited_by_user_id",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("organisations")
      .select(
        "id, legal_name, organisation_type, city, country_code, outreach_status, priority_score, created_at, updated_at",
      )
      .eq("owner_id", id)
      .order("updated_at", { ascending: false }),
    supabase.from("suppressions").select("organisation_id").eq("status", "active"),
    supabase
      .from("outreach_preferences")
      .select("preferred_geographic_reach, preferred_sectors, preferred_income_bands, updated_at")
      .eq("user_id", id)
      .maybeSingle(),
    supabase
      .from("outreach_messages")
      .select("id, sent_at")
      .eq("sent_by_user_id", id)
      .eq("send_status", "sent"),
    supabase
      .from("notes")
      .select("id, content, created_at, organisation_id, organisation:organisations(id, legal_name)")
      .eq("author_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.rpc("get_recent_team_activity", { p_limit: 60 }),
  ]);

  const user = userResult.data;
  if (userResult.error || !user) {
    notFound();
  }

  // Fetch inviter if present
  let inviterName: string | null = null;
  if (user.invited_by_user_id) {
    const { data: inviter } = await supabase
      .from("users")
      .select("full_name, email")
      .eq("id", user.invited_by_user_id)
      .maybeSingle();
    if (inviter) {
      inviterName = inviter.full_name || inviter.email;
    }
  }

  const suppressions = suppressionsResult.data ?? [];
  const suppressedSet = new Set(suppressions.map((s) => s.organisation_id));

  const rawClients = ownedClientsResult.data ?? [];
  const clients: AssignedClientItem[] = rawClients.map((c) => ({
    id: c.id,
    legal_name: c.legal_name,
    organisation_type: c.organisation_type,
    city: c.city,
    country_code: c.country_code,
    outreach_status: c.outreach_status,
    priority_score: c.priority_score,
    created_at: c.created_at,
    updated_at: c.updated_at,
    is_suppressed: suppressedSet.has(c.id),
  }));

  const preferences = preferencesResult.data;
  const sentMessages = sentMessagesResult.data ?? [];
  const recentNotes: MemberNoteItem[] = (notesResult.data ?? []).map((n) => ({
    id: n.id,
    content: n.content,
    createdAt: n.created_at,
    organisationId: n.organisation_id,
    organisationName:
      n.organisation && typeof n.organisation === "object" && "legal_name" in n.organisation
        ? (n.organisation.legal_name as string)
        : "Unknown organisation",
  }));

  const activities: MemberActivityItem[] = ((activitiesResult.data as RawTeamActivityRow[] | null) ?? [])
    .filter((a) => a.actor_user_id === id)
    .slice(0, 20)
    .map((row) => {
      const formatted = formatTeamActivity(row);
      return {
        id: row.id,
        sentence: formatted.sentence,
        relativeTime: formatted.relativeTime,
        targetHref: formatted.targetHref,
        actorName: formatted.actorName,
      };
    });

  const isSelf = authorization.actor.id === user.id;
  const isAdmin = authorization.actor.role === "admin";

  // Detailed Pipeline Breakdown
  const totalClients = clients.length;
  const discoveryCount = clients.filter((c) => c.outreach_status === "not_contacted").length;
  const outreachCount = clients.filter((c) =>
    ["initial_outreach_sent", "follow_up_1_sent", "follow_up_2_sent"].includes(c.outreach_status),
  ).length;
  const discussionCount = clients.filter((c) =>
    ["meeting_held", "proposal_requested", "proposal_submitted"].includes(c.outreach_status),
  ).length;
  const convertedCount = clients.filter((c) => c.outreach_status === "converted").length;
  const closedCount = clients.filter((c) =>
    ["stalled", "rejected", "unresponsive", "do_not_contact"].includes(c.outreach_status),
  ).length;

  const conversionRate = totalClients > 0 ? ((convertedCount / totalClients) * 100).toFixed(1) : "0.0";

  const stats = {
    totalClients,
    discoveryCount,
    outreachCount,
    discussionCount,
    convertedCount,
    closedCount,
    sentMessagesCount: sentMessages.length,
    notesCount: recentNotes.length,
    conversionRate,
  };

  const memberData: TeamMemberHeaderData = {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role as "cam" | "admin" | "viewer",
    isActive: user.is_active,
    deactivatedAt: user.deactivated_at,
    lastSeenAt: user.last_seen_at,
    createdAt: user.created_at,
    inviterName,
    isSelf,
    isAdmin,
    stats,
  };

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <div className="mx-auto w-full max-w-[1400px] space-y-6">
        <Stage className="space-y-6">
          <Rise>
            <TeamMemberHeader member={memberData} />
          </Rise>

          <TeamMemberView
            member={{
              id: user.id,
              email: user.email,
              fullName: user.full_name,
              role: user.role as "cam" | "admin" | "viewer",
              isActive: user.is_active,
              deactivatedAt: user.deactivated_at,
              lastSeenAt: user.last_seen_at,
              createdAt: user.created_at,
              inviterName,
              isSelf,
              isAdmin,
            }}
            clients={clients}
            recentNotes={recentNotes}
            activities={activities}
            preferences={preferences}
            stats={stats}
          />
        </Stage>
      </div>
    </div>
  );
}
