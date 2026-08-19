import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { Stage, Group, Rise } from "@/components/dashboard-stage";
import { Shield, Building2, Users } from "lucide-react";

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

function lastActiveLabel(lastSeenAt: string | null): string {
  if (!lastSeenAt) return "Never";
  const elapsedMs = Date.now() - new Date(lastSeenAt).getTime();
  if (elapsedMs < 60_000) return "Just now";
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(lastSeenAt).toLocaleDateString();
}

export default async function TeamDirectoryPage() {
  const authorization = await getCurrentActor();
  if (!authorization.ok) {
    redirect("/login");
  }

  const supabase = await createClient();

  const { data: users } = await supabase
    .from("users")
    .select("id, email, full_name, role, is_active, deactivated_at, last_seen_at, created_at")
    .order("full_name");

  // Fetch owned client counts
  const { data: owned } = await supabase
    .from("organisations")
    .select("id, owner_id")
    .not("owner_id", "is", null);

  const ownedCounts = new Map<string, number>();
  for (const row of owned ?? []) {
    if (!row.owner_id) continue;
    ownedCounts.set(row.owner_id, (ownedCounts.get(row.owner_id) ?? 0) + 1);
  }

  const members = users ?? [];
  const isAdmin = authorization.actor.role === "admin";

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-5xl space-y-8">
        <Rise className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
              Team
            </h1>
            <p className="mt-3 text-sm text-foreground/65">
              Everyone with access to 180Connect. Tap any team member to view their profile, client portfolio, and activity.
            </p>
          </div>
          {isAdmin && (
            <Link
              href="/admin/users"
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-bold shadow-xs ring-1 ring-black/10 transition-shadow hover:shadow text-brand"
            >
              <Users className="h-3.5 w-3.5" />
              Manage team & invites →
            </Link>
          )}
        </Rise>

        <Group className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((member) => {
            const displayName = member.full_name?.trim() || member.email;
            const initials = getInitials(member.full_name, member.email);
            const clientCount = ownedCounts.get(member.id) ?? 0;
            const isSelf = authorization.actor.id === member.id;

            const roleStyles = {
              admin: "bg-purple-100/70 text-purple-900 border-purple-200",
              cam: "bg-brand/10 text-brand-hover border-brand/20",
              viewer: "bg-blue-100/70 text-blue-900 border-blue-200",
            }[member.role as "admin" | "cam" | "viewer"] ?? "bg-black/5 text-foreground/75 border-black/10";

            return (
              <Rise key={member.id}>
                <Link
                  href={`/team/${member.id}`}
                  className="group relative flex flex-col justify-between rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-brand/30"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-sm font-black text-brand-hover ring-1 ring-black/[0.06]">
                          {initials}
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${
                              member.is_active ? "bg-emerald-500" : "bg-amber-500"
                            }`}
                          />
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="truncate text-sm font-bold text-foreground group-hover:text-brand transition-colors">
                              {displayName}
                            </p>
                            {isSelf && (
                              <span className="rounded-full bg-black/[0.05] px-1.5 py-0.2 text-[10px] font-bold text-foreground/60">
                                You
                              </span>
                            )}
                          </div>
                          <p className="truncate text-xs text-foreground/50">
                            {member.email}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-1.5">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${roleStyles}`}>
                        <Shield className="h-2.5 w-2.5" />
                        {member.role}
                      </span>

                      <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] font-bold text-foreground/60">
                        <Building2 className="h-2.5 w-2.5" />
                        {clientCount} {clientCount === 1 ? "client" : "clients"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 border-t border-black/[0.05] pt-3 flex items-center justify-between text-[11px] text-foreground/45">
                    <span>Active {lastActiveLabel(member.last_seen_at)}</span>
                    <span className="font-bold text-brand group-hover:underline flex items-center gap-0.5">
                      View profile →
                    </span>
                  </div>
                </Link>
              </Rise>
            );
          })}
        </Group>
      </Stage>
    </div>
  );
}
