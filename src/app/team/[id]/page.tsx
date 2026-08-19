import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { formatLocation, formatOutreachStatus } from "@/lib/organisation-format";
import { Stage, Group, Rise } from "@/components/dashboard-stage";
import { formatTeamActivity, type RawTeamActivityRow } from "@/lib/team-activity";
import { Mail, Shield, User, ExternalLink, Building2, Compass, Briefcase, Calendar, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { OriginButton } from "@/components/ui/origin-button";

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
  return `Last seen ${new Date(lastSeenAt).toLocaleDateString()}`;
}

export default async function TeamMemberPage({ params }: { params: Params }) {
  const { id } = await params;
  const authorization = await getCurrentActor();
  if (!authorization.ok) {
    redirect("/login");
  }

  const supabase = await createClient();

  // Fetch target user profile
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, email, full_name, role, is_active, deactivated_at, last_seen_at, created_at, invited_at, invite_accepted_at, invited_by_user_id")
    .eq("id", id)
    .maybeSingle();

  if (userError || !user) {
    notFound();
  }

  // Fetch inviter if exists
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

  // Fetch owned organisations
  const { data: ownedClients } = await supabase
    .from("organisations")
    .select("id, legal_name, organisation_type, city, country_code, outreach_status, created_at, updated_at")
    .eq("owner_id", id)
    .order("updated_at", { ascending: false });

  // Fetch active suppressions
  const { data: suppressions } = await supabase
    .from("suppressions")
    .select("organisation_id")
    .eq("status", "active");

  const suppressedSet = new Set((suppressions ?? []).map((s) => s.organisation_id));
  const clients = ownedClients ?? [];

  // Fetch outreach preferences
  const { data: preferences } = await supabase
    .from("outreach_preferences")
    .select("preferred_geographic_reach, preferred_sectors, preferred_income_bands")
    .eq("user_id", id)
    .maybeSingle();

  // Fetch recent activity
  const { data: rawActivities } = await supabase.rpc("get_recent_team_activity", {
    p_limit: 50,
  });

  const memberActivities = ((rawActivities as RawTeamActivityRow[] | null) ?? [])
    .filter((a) => a.actor_user_id === id)
    .slice(0, 10)
    .map((row) => formatTeamActivity(row));

  const displayName = user.full_name?.trim() || user.email;
  const initials = getInitials(user.full_name, user.email);
  const isSelf = authorization.actor.id === user.id;
  const isAdmin = authorization.actor.role === "admin";

  const totalClients = clients.length;
  const activeOutreach = clients.filter((c) => c.outreach_status !== "not_contacted").length;
  const convertedCount = clients.filter((c) => c.outreach_status === "converted").length;

  const roleStyles = {
    admin: "bg-purple-100/70 text-purple-900 border-purple-200",
    cam: "bg-brand/10 text-brand-hover border-brand/20",
    viewer: "bg-blue-100/70 text-blue-900 border-blue-200",
  }[user.role as "admin" | "cam" | "viewer"] ?? "bg-black/5 text-foreground/75 border-black/10";

  const statusLabel = user.is_active
    ? "Active"
    : user.deactivated_at
      ? "Deactivated"
      : "Suspended";

  const statusStyles = user.is_active
    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
    : user.deactivated_at
      ? "bg-red-50 text-red-800 border-red-200"
      : "bg-amber-50 text-amber-800 border-amber-200";

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-5xl space-y-8">
        {/* Navigation Breadcrumb */}
        <Rise className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-foreground/60">
            <Link
              href="/team"
              className="font-bold hover:text-brand hover:underline"
            >
              Team
            </Link>
            <span>/</span>
            <span className="text-foreground font-semibold">{displayName}</span>
          </div>
          {isAdmin && (
            <Link
              href="/admin/users"
              className="text-xs font-bold text-brand hover:underline flex items-center gap-1"
            >
              Manage in Admin Users →
            </Link>
          )}
        </Rise>

        {/* Hero Card */}
        <Rise className="rounded-3xl border border-black/[0.06] bg-white p-6 sm:p-8 shadow-sm">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start sm:items-center gap-5">
              <div className="relative flex h-16 w-16 sm:h-20 sm:w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand/20 via-brand/10 to-transparent text-xl sm:text-2xl font-black text-brand-hover shadow-xs ring-1 ring-black/[0.08]">
                {initials}
                <span
                  className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-white ${
                    user.is_active ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                  title={statusLabel}
                />
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-2xl sm:text-3xl font-bold font-body leading-tight text-foreground">
                    {displayName}
                  </h1>
                  {isSelf && (
                    <span className="rounded-full bg-black/[0.05] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-foreground/60">
                      You
                    </span>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-bold uppercase tracking-wide ${roleStyles}`}>
                    <Shield className="h-3 w-3" />
                    {user.role}
                  </span>

                  <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-bold ${statusStyles}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${user.is_active ? "bg-emerald-600" : "bg-amber-600"}`} />
                    {statusLabel}
                  </span>

                  <span className="text-foreground/50">
                    · {lastActiveText(user.last_seen_at)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-2 sm:pt-0">
              <a
                href={`mailto:${user.email}`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 bg-white px-4 py-2 text-xs font-bold text-foreground transition-colors hover:border-black/25 hover:bg-black/[0.02]"
              >
                <Mail className="h-3.5 w-3.5 text-foreground/60" />
                Email
              </a>

              {isSelf ? (
                <OriginButton href="/profile" size="sm">
                  Edit preferences
                </OriginButton>
              ) : isAdmin && user.role === "cam" ? (
                <OriginButton href={`/admin/cam-settings?user=${user.id}`} size="sm">
                  Queue settings
                </OriginButton>
              ) : null}
            </div>
          </div>

          <div className="mt-6 border-t border-black/[0.06] pt-4 text-xs text-foreground/55 flex flex-wrap gap-x-6 gap-y-2">
            <span className="flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              {user.email}
            </span>
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              Joined {new Date(user.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
            </span>
            {inviterName && (
              <span className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" />
                Invited by {inviterName}
              </span>
            )}
          </div>
        </Rise>

        {/* Metrics Grid */}
        <Group className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Rise className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-foreground/45">
                Owned Clients
              </p>
              <Building2 className="h-4 w-4 text-brand" />
            </div>
            <p className="mt-2 text-2xl font-bold font-body text-foreground">
              {totalClients}
            </p>
            <p className="mt-0.5 text-xs text-foreground/50">
              {totalClients === 1 ? "1 client assigned" : `${totalClients} clients assigned`}
            </p>
          </Rise>

          <Rise className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-foreground/45">
                Active Outreach
              </p>
              <Briefcase className="h-4 w-4 text-amber-600" />
            </div>
            <p className="mt-2 text-2xl font-bold font-body text-foreground">
              {activeOutreach}
            </p>
            <p className="mt-0.5 text-xs text-foreground/50">
              Past discovery phase
            </p>
          </Rise>

          <Rise className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-foreground/45">
                Converted (Won)
              </p>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
            <p className="mt-2 text-2xl font-bold font-body text-foreground">
              {convertedCount}
            </p>
            <p className="mt-0.5 text-xs text-foreground/50">
              Successfully won
            </p>
          </Rise>

          <Rise className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-foreground/45">
                Recent Actions
              </p>
              <Clock className="h-4 w-4 text-purple-600" />
            </div>
            <p className="mt-2 text-2xl font-bold font-body text-foreground">
              {memberActivities.length}
            </p>
            <p className="mt-0.5 text-xs text-foreground/50">
              Activity log events
            </p>
          </Rise>
        </Group>

        {/* Outreach Preferences (if available) */}
        {preferences && (preferences.preferred_sectors?.length || preferences.preferred_geographic_reach?.length || preferences.preferred_income_bands?.length) ? (
          <Rise className="rounded-3xl border border-black/[0.06] bg-white p-6 sm:p-7 shadow-sm">
            <div className="flex items-center gap-2">
              <Compass className="h-4 w-4 text-brand" />
              <h2 className="text-base font-bold text-foreground">
                Outreach Focus & Queue Preferences
              </h2>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {preferences.preferred_sectors?.length ? (
                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-foreground/50">
                    Preferred Sectors
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {preferences.preferred_sectors.map((s: string) => (
                      <span key={s} className="rounded-md bg-brand/10 px-2 py-0.5 text-xs font-bold text-brand-hover">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {preferences.preferred_geographic_reach?.length ? (
                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-foreground/50">
                    Geographic Reach
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {preferences.preferred_geographic_reach.map((r: string) => (
                      <span key={r} className="rounded-md bg-black/[0.05] px-2 py-0.5 text-xs font-bold text-foreground/75 capitalize">
                        {r.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {preferences.preferred_income_bands?.length ? (
                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-foreground/50">
                    Income Bands
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {preferences.preferred_income_bands.map((b: string) => (
                      <span key={b} className="rounded-md bg-black/[0.05] px-2 py-0.5 text-xs font-bold text-foreground/75 uppercase">
                        {b.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </Rise>
        ) : null}

        {/* Owned Clients Section */}
        <Group className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <div>
              <h2 className="text-xl font-bold font-body text-foreground">
                Assigned Clients
              </h2>
              <p className="text-xs text-foreground/55">
                Organisations actively managed by {displayName}.
              </p>
            </div>
            {totalClients > 0 && (
              <Link
                href={`/clients?owner=${user.id}`}
                className="inline-flex items-center gap-1 text-xs font-bold text-brand hover:underline"
              >
                View in Clients Table
                <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>

          <Rise className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
            {clients.length === 0 ? (
              <div className="py-12 text-center">
                <Building2 className="mx-auto h-8 w-8 text-foreground/20" />
                <p className="mt-2 text-sm font-bold text-foreground/70">
                  No clients assigned
                </p>
                <p className="mt-1 text-xs text-foreground/50">
                  This team member does not currently own any client accounts.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-black/[0.06]">
                {clients.map((client) => {
                  const isSuppressed = suppressedSet.has(client.id);
                  const location = formatLocation({ city: client.city, country_code: client.country_code });
                  return (
                    <li key={client.id}>
                      <Link
                        href={`/clients/${client.id}`}
                        className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 px-5 transition-colors hover:bg-black/[0.02]"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-bold text-foreground group-hover:text-brand transition-colors">
                              {client.legal_name}
                            </span>
                            {isSuppressed && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                                <AlertCircle className="h-2.5 w-2.5" />
                                Suppressed
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-foreground/50 truncate">
                            {client.organisation_type} · {location}
                          </p>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <span className="rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-foreground/60">
                            {formatOutreachStatus(client.outreach_status)}
                          </span>
                          <span className="text-foreground/25 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground/50">
                            →
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Rise>
        </Group>

        {/* Recent Activity Timeline */}
        {memberActivities.length > 0 && (
          <Group className="space-y-4">
            <div className="px-1">
              <h2 className="text-xl font-bold font-body text-foreground">
                Recent Activity
              </h2>
              <p className="text-xs text-foreground/55">
                Actions and status updates logged by {displayName}.
              </p>
            </div>

            <Rise className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
              <ul className="divide-y divide-black/[0.06]">
                {memberActivities.map((item) => (
                  <li key={item.id} className="p-4 px-5 flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {item.sentence}
                      </p>
                      <p className="mt-0.5 text-xs text-foreground/45">
                        {item.relativeTime}
                      </p>
                    </div>
                    {item.targetHref && (
                      <Link
                        href={item.targetHref}
                        className="shrink-0 text-xs font-bold text-brand hover:underline flex items-center gap-1"
                      >
                        View client →
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </Rise>
          </Group>
        )}
      </Stage>
    </div>
  );
}
