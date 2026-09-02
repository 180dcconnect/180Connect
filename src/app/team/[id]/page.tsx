import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Activity,
  ArrowUpRight,
  Building2,
  Calendar,
  Clock,
  Compass,
  FileText,
  Mail,
  Send,
  Shield,
  TrendingUp,
  User,
} from "lucide-react";

import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { Stage, Group, Rise } from "@/components/dashboard-stage";
import { Pill, SectionCard } from "@/app/clients/[id]/section-card";
import { OriginButton } from "@/components/ui/origin-button";
import { formatTeamActivity, type RawTeamActivityRow } from "@/lib/team-activity";
import { BackButton } from "@/components/ui/back-button";

import { TeamRoleEditor } from "./role-editor";
import { CopyProfileButton } from "./copy-profile-button";
import { AssignedClientsCard, type AssignedClientItem } from "./assigned-clients-card";

type Params = Promise<{ id: string }>;

function getInitials(name: string | null, email: string): string {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function lastActiveText(lastSeenAt: string | null): string {
  if (!lastSeenAt) return "Never active";
  const elapsedMs = Date.now() - new Date(lastSeenAt).getTime();
  if (elapsedMs < 60_000) return "Active just now";
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `Active ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Active ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Active ${days}d ago`;
  return `Last seen ${new Date(lastSeenAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

export default async function TeamMemberPage({ params }: { params: Params }) {
  const { id } = await params;
  const authorization = await getCurrentActor();
  if (!authorization.ok) {
    redirect("/login");
  }

  const supabase = await createClient();

  // Run all profile and activity queries concurrently
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
      .limit(6),
    supabase.rpc("get_recent_team_activity", { p_limit: 50 }),
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
  const recentNotes = (notesResult.data ?? []).map((n) => ({
    id: n.id,
    content: n.content,
    created_at: n.created_at,
    organisationId: n.organisation_id,
    organisationName:
      n.organisation && typeof n.organisation === "object" && "legal_name" in n.organisation
        ? (n.organisation.legal_name as string)
        : "Unknown organisation",
  }));

  const memberActivities = ((activitiesResult.data as RawTeamActivityRow[] | null) ?? [])
    .filter((a) => a.actor_user_id === id)
    .slice(0, 10)
    .map((row) => formatTeamActivity(row));

  const displayName = user.full_name?.trim() || user.email;
  const initials = getInitials(user.full_name, user.email);
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
  const inProgressCount = outreachCount + discussionCount;
  const inProgressPercent = totalClients > 0 ? Math.round((inProgressCount / totalClients) * 100) : 0;
  const convertedPercent = totalClients > 0 ? Math.round((convertedCount / totalClients) * 100) : 0;
  const discoveryPercent = totalClients > 0 ? Math.round((discoveryCount / totalClients) * 100) : 0;
  const closedPercent = totalClients > 0 ? Math.round((closedCount / totalClients) * 100) : 0;

  const statusTone: "go" | "stop" | "neutral" = user.is_active
    ? "go"
    : user.deactivated_at
      ? "stop"
      : "neutral";

  const statusLabel = user.is_active
    ? "Active"
    : user.deactivated_at
      ? "Deactivated"
      : "Suspended";

  return (
    <div className="min-h-screen bg-bone px-4 py-8 sm:px-8 sm:py-10">
      <Stage className="mx-auto w-full max-w-5xl space-y-6">
        {/* Navigation Header */}
        <Rise className="flex items-center justify-between text-xs">
          <BackButton href="/admin/users" label="Team management" size="sm" className="min-w-[170px]" />

          <div className="flex items-center gap-2">
            <CopyProfileButton name={displayName} />
          </div>
        </Rise>

        {/* Hero Identity Card */}
        <Rise className="rounded-panel border border-rule bg-white p-6 sm:p-7 shadow-xs">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            {/* Identity & Status */}
            <div className="flex items-start sm:items-center gap-4.5">
              {/* Monogram Avatar with Live Status Indicator */}
              <div className="relative flex size-15 shrink-0 items-center justify-center rounded-2xl bg-paper-sunk font-mono text-xl font-bold tracking-tight text-ink border border-rule">
                {initials}
                <span
                  className={`absolute -bottom-1 -right-1 size-3.5 rounded-full border-2 border-white ${
                    user.is_active ? "bg-go" : "bg-stop"
                  }`}
                  title={statusLabel}
                />
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-xl sm:text-2xl font-bold tracking-[-0.02em] text-ink">
                    {displayName}
                  </h1>
                  {isSelf && (
                    <span className="rounded-full bg-paper px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-dim border border-rule-soft">
                      You
                    </span>
                  )}
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                  <TeamRoleEditor
                    userId={user.id}
                    userEmail={user.email}
                    initialRole={user.role as "cam" | "admin" | "viewer"}
                    isSelf={isSelf}
                    isAdmin={isAdmin}
                  />

                  <Pill tone={statusTone}>{statusLabel}</Pill>

                  <span className="text-dim">
                    · {lastActiveText(user.last_seen_at)}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex flex-wrap items-center gap-2 pt-1 sm:pt-0">
              <a
                href={`mailto:${user.email}`}
                className="inline-flex h-8.5 items-center gap-1.5 rounded-full border border-rule bg-white px-3.5 text-xs font-semibold text-ink transition-colors hover:border-faint hover:bg-paper"
              >
                <Mail aria-hidden="true" className="size-3.5 text-faint" />
                <span>Email</span>
              </a>

              {isSelf ? (
                <OriginButton href="/profile" size="sm" variant="ink">
                  Edit preferences
                </OriginButton>
              ) : isAdmin && user.role === "cam" ? (
                <OriginButton href={`/admin/cam-settings?user=${user.id}`} size="sm" variant="ink">
                  Queue settings
                </OriginButton>
              ) : null}
            </div>
          </div>

          {/* Account Metadata Bar */}
          <div className="mt-5 border-t border-rule/50 pt-3.5 text-[11.5px] text-dim flex flex-wrap items-center gap-x-6 gap-y-1.5">
            <span className="flex items-center gap-1.5">
              <Mail aria-hidden="true" className="size-3.5 text-faint" />
              <span>{user.email}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Calendar aria-hidden="true" className="size-3.5 text-faint" />
              <span>
                Joined{" "}
                {new Date(user.created_at).toLocaleDateString("en-GB", {
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </span>
            {inviterName && (
              <span className="flex items-center gap-1.5">
                <User aria-hidden="true" className="size-3.5 text-faint" />
                <span>Invited by {inviterName}</span>
              </span>
            )}
          </div>
        </Rise>

        {/* 4 Performance Metric Cards */}
        <Group className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          <Rise className="rounded-panel border border-rule bg-white p-4.5 shadow-xs">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wider text-dim">
                Owned Clients
              </p>
              <Building2 aria-hidden="true" className="size-4 text-faint" />
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight text-ink">
              {totalClients}
            </p>
            <p className="mt-0.5 text-[11.5px] text-dim">
              {inProgressCount} in active outreach
            </p>
          </Rise>

          <Rise className="rounded-panel border border-rule bg-white p-4.5 shadow-xs">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wider text-dim">
                Conversion Rate
              </p>
              <TrendingUp aria-hidden="true" className="size-4 text-go" />
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight text-ink">
              {conversionRate}%
            </p>
            <p className="mt-0.5 text-[11.5px] text-dim">
              {convertedCount} {convertedCount === 1 ? "client won" : "clients won"}
            </p>
          </Rise>

          <Rise className="rounded-panel border border-rule bg-white p-4.5 shadow-xs">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wider text-dim">
                Outreach Sent
              </p>
              <Send aria-hidden="true" className="size-4 text-lead" />
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight text-ink">
              {sentMessages.length}
            </p>
            <p className="mt-0.5 text-[11.5px] text-dim">
              Verified client sends
            </p>
          </Rise>

          <Rise className="rounded-panel border border-rule bg-white p-4.5 shadow-xs">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wider text-dim">
                Notes Logged
              </p>
              <FileText aria-hidden="true" className="size-4 text-faint" />
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight text-ink">
              {recentNotes.length}
            </p>
            <p className="mt-0.5 text-[11.5px] text-dim">
              Internal intelligence
            </p>
          </Rise>
        </Group>

        {/* Visual Pipeline Progression Segmented Bar */}
        {totalClients > 0 && (
          <Rise>
            <SectionCard
              headingId="pipeline-health-heading"
              title="Pipeline Distribution"
              hint={`Progression of ${totalClients} client accounts owned by ${displayName}.`}
              icon={<Activity />}
            >
              <div className="mt-3.5 space-y-3">
                {/* Segmented Bar */}
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-paper border border-rule-soft">
                  {discoveryPercent > 0 && (
                    <div
                      style={{ width: `${discoveryPercent}%` }}
                      className="bg-faint/60 transition-all"
                      title={`Discovery: ${discoveryCount} (${discoveryPercent}%)`}
                    />
                  )}
                  {inProgressPercent > 0 && (
                    <div
                      style={{ width: `${inProgressPercent}%` }}
                      className="bg-lead transition-all"
                      title={`In Outreach / Discussion: ${inProgressCount} (${inProgressPercent}%)`}
                    />
                  )}
                  {convertedPercent > 0 && (
                    <div
                      style={{ width: `${convertedPercent}%` }}
                      className="bg-go transition-all"
                      title={`Won: ${convertedCount} (${convertedPercent}%)`}
                    />
                  )}
                  {closedPercent > 0 && (
                    <div
                      style={{ width: `${closedPercent}%` }}
                      className="bg-stop/50 transition-all"
                      title={`Closed / Stalled: ${closedCount} (${closedPercent}%)`}
                    />
                  )}
                </div>

                {/* Segment Legend Badges */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full bg-faint/60" />
                    <span className="text-dim">Discovery ({discoveryCount})</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full bg-lead" />
                    <span className="text-dim">Outreach & Discussion ({inProgressCount})</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full bg-go" />
                    <span className="text-dim font-medium text-ink">Won ({convertedCount})</span>
                  </div>
                  {closedCount > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="size-2.5 rounded-full bg-stop/50" />
                      <span className="text-dim">Closed / Stalled ({closedCount})</span>
                    </div>
                  )}
                </div>
              </div>
            </SectionCard>
          </Rise>
        )}

        {/* Main Content Two-Column Split */}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          {/* Left Column: Assigned Clients Portfolio + Notes */}
          <Group className="space-y-6">
            <Rise>
              <AssignedClientsCard
                clients={clients}
                userId={user.id}
                displayName={displayName}
              />
            </Rise>

            {/* Recent Notes & Intelligence Logged by this Member */}
            {recentNotes.length > 0 && (
              <Rise>
                <SectionCard
                  headingId="recent-notes-heading"
                  title="Client Notes & Intelligence"
                  hint={`Research and touchpoint notes authored by ${displayName}.`}
                  icon={<FileText />}
                >
                  <ul className="mt-3.5 divide-y divide-rule/40">
                    {recentNotes.map((note) => (
                      <li key={note.id} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-center justify-between gap-2">
                          <Link
                            href={`/clients/${note.organisationId}`}
                            className="text-[13px] font-semibold text-ink hover:text-lead transition-colors flex items-center gap-1"
                          >
                            <span>{note.organisationName}</span>
                            <ArrowUpRight className="size-3 text-faint" />
                          </Link>
                          <span className="text-[11px] text-faint">
                            {new Date(note.created_at).toLocaleDateString("en-GB", {
                              day: "numeric",
                              month: "short",
                            })}
                          </span>
                        </div>
                        <p className="mt-1 text-[12.5px] leading-relaxed text-dim line-clamp-2">
                          {note.content}
                        </p>
                      </li>
                    ))}
                  </ul>
                </SectionCard>
              </Rise>
            )}
          </Group>

          {/* Right Column: Preferences + Recent Activity + Governance */}
          <Group className="space-y-6">
            {/* Outreach Focus & Matching Preferences */}
            {preferences &&
            (preferences.preferred_sectors?.length ||
              preferences.preferred_geographic_reach?.length ||
              preferences.preferred_income_bands?.length) ? (
              <Rise>
                <SectionCard
                  headingId="preferences-heading"
                  title="Outreach Focus & Queue"
                  hint="Automated client discovery & queue matching criteria."
                  icon={<Compass />}
                  action={
                    isSelf ? (
                      <Link
                        href="/profile"
                        className="text-xs font-semibold text-lead hover:underline"
                      >
                        Edit
                      </Link>
                    ) : null
                  }
                >
                  <div className="mt-3.5 space-y-3.5">
                    {preferences.preferred_sectors?.length ? (
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wider text-dim">
                          Preferred Sectors
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {preferences.preferred_sectors.map((s: string) => (
                            <span
                              key={s}
                              className="rounded-full bg-paper px-2.5 py-0.5 text-xs font-medium text-ink border border-rule-soft"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {preferences.preferred_geographic_reach?.length ? (
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wider text-dim">
                          Geographic Reach
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {preferences.preferred_geographic_reach.map((r: string) => (
                            <span
                              key={r}
                              className="rounded-full bg-paper px-2.5 py-0.5 text-xs font-medium text-ink capitalize border border-rule-soft"
                            >
                              {r.replace(/_/g, " ")}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {preferences.preferred_income_bands?.length ? (
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wider text-dim">
                          Target Income Bands
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {preferences.preferred_income_bands.map((b: string) => (
                            <span
                              key={b}
                              className="rounded-full bg-paper px-2.5 py-0.5 text-xs font-mono font-medium text-ink uppercase border border-rule-soft"
                            >
                              {b.replace(/_/g, " ")}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </SectionCard>
              </Rise>
            ) : null}

            {/* Recent Activity Timeline Feed */}
            {memberActivities.length > 0 && (
              <Rise>
                <SectionCard
                  headingId="recent-activity-heading"
                  title="Recent Activity"
                  hint={`Audit stream of actions performed by ${displayName}.`}
                  icon={<Clock />}
                >
                  <ul className="mt-3.5 divide-y divide-rule/40">
                    {memberActivities.map((item) => (
                      <li key={item.id} className="py-2.5 first:pt-0 last:pb-0">
                        <p className="text-[12.5px] leading-snug font-medium text-ink">
                          {item.sentence}
                        </p>
                        <div className="mt-1 flex items-center justify-between text-[11px] text-faint">
                          <span>{item.relativeTime}</span>
                          {item.targetHref && (
                            <Link
                              href={item.targetHref}
                              className="font-semibold text-lead hover:underline flex items-center gap-0.5"
                            >
                              <span>View client</span>
                              <ArrowUpRight className="size-2.5" />
                            </Link>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </SectionCard>
              </Rise>
            )}

            {/* Account Governance & Security Card */}
            <Rise>
              <SectionCard
                headingId="governance-heading"
                title="Account Governance"
                hint="Security and organizational credentials."
                icon={<Shield />}
              >
                <dl className="mt-3.5 space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-rule/30">
                    <dt className="text-dim">Role</dt>
                    <dd className="font-semibold uppercase text-ink">{user.role}</dd>
                  </div>
                  <div className="flex justify-between py-1 border-b border-rule/30">
                    <dt className="text-dim">Access State</dt>
                    <dd className="font-semibold text-ink">{statusLabel}</dd>
                  </div>
                  <div className="flex justify-between py-1">
                    <dt className="text-dim">Email Address</dt>
                    <dd className="font-mono text-ink/80 text-[11px] truncate max-w-[180px]">{user.email}</dd>
                  </div>
                </dl>
              </SectionCard>
            </Rise>
          </Group>
        </div>
      </Stage>
    </div>
  );
}
