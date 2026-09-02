import {
  Building2,
  Calendar,
  FileText,
  Mail,
  Send,
  Sliders,
  TrendingUp,
  User,
} from "lucide-react";

import { BackButton } from "@/components/ui/back-button";
import { Pill } from "@/app/clients/[id]/section-card";
import { OriginButton } from "@/components/ui/origin-button";

import { CopyProfileButton } from "./copy-profile-button";
import { TeamRoleEditor } from "./role-editor";
import { PerformanceDial } from "./performance-dial";

export type TeamMemberHeaderData = {
  id: string;
  email: string;
  fullName: string | null;
  role: "cam" | "admin" | "viewer";
  isActive: boolean;
  deactivatedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  inviterName: string | null;
  isSelf: boolean;
  isAdmin: boolean;
  stats: {
    totalClients: number;
    discoveryCount: number;
    outreachCount: number;
    discussionCount: number;
    convertedCount: number;
    closedCount: number;
    sentMessagesCount: number;
    notesCount: number;
  };
};

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

export function TeamMemberHeader({ member }: { member: TeamMemberHeaderData }) {
  const displayName = member.fullName?.trim() || member.email;
  const initials = getInitials(member.fullName, member.email);

  const statusTone: "go" | "stop" | "neutral" = member.isActive
    ? "go"
    : member.deactivatedAt
      ? "stop"
      : "neutral";

  const statusLabel = member.isActive
    ? "Active"
    : member.deactivatedAt
      ? "Deactivated"
      : "Suspended";

  const inProgressCount = member.stats.outreachCount + member.stats.discussionCount;

  return (
    <div className="relative rounded-panel border border-rule bg-white shadow-xs">
      {/* Top Bar: Back Button + Quick Actions */}
      <div className="flex items-center justify-between gap-3 border-b border-rule-soft px-5 py-2.5">
        <BackButton href="/admin/users" label="Team management" size="sm" className="min-w-[170px]" />

        <div className="flex flex-wrap items-center gap-2">
          <CopyProfileButton name={displayName} />

          <a
            href={`mailto:${member.email}`}
            className="inline-flex h-8.5 items-center gap-1.5 rounded-full border border-rule bg-white px-3.5 text-xs font-semibold text-ink transition-colors hover:border-faint hover:bg-paper focus-visible:outline-2 focus-visible:outline-lead-mid"
          >
            <Mail aria-hidden="true" className="size-3.5 text-faint" />
            <span>Email</span>
          </a>

          {member.isSelf ? (
            <OriginButton href="/profile" size="sm" variant="ink">
              Edit preferences
            </OriginButton>
          ) : member.isAdmin && member.role === "cam" ? (
            <OriginButton href={`/admin/cam-settings?user=${member.id}`} size="sm" variant="ink">
              <Sliders className="size-3.5 mr-1" />
              <span>Queue settings</span>
            </OriginButton>
          ) : null}
        </div>
      </div>

      {/* Main Hero Grid: Identity & Metadata + Performance Dial */}
      <div className="grid items-start gap-x-8 gap-y-6 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        {/* Left Column: Avatar, Name, Role, Metadata */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex items-start sm:items-center gap-4.5">
            {/* Monogram Avatar with Live Presence Indicator */}
            <div className="relative flex size-16 shrink-0 items-center justify-center rounded-2xl bg-paper-sunk font-mono text-xl font-bold tracking-tight text-ink border border-rule shadow-2xs">
              {initials}
              <span
                className={`absolute -bottom-1 -right-1 size-3.5 rounded-full border-2 border-white ${
                  member.isActive ? "bg-go" : "bg-stop"
                }`}
                title={statusLabel}
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="font-body text-[clamp(1.75rem,3.5vw,2.5rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-balance text-ink">
                  {displayName}
                </h1>
                {member.isSelf && (
                  <span className="rounded-full bg-paper px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-dim border border-rule-soft">
                    You
                  </span>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <TeamRoleEditor
                  userId={member.id}
                  userEmail={member.email}
                  initialRole={member.role}
                  isSelf={member.isSelf}
                  isAdmin={member.isAdmin}
                />

                <Pill tone={statusTone}>{statusLabel}</Pill>

                <span className="text-dim">
                  · {lastActiveText(member.lastSeenAt)}
                </span>
              </div>
            </div>
          </div>

          {/* Account Metadata Row */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px] text-dim pt-1">
            <a
              href={`mailto:${member.email}`}
              className="inline-flex items-center gap-1.5 hover:text-lead transition-colors"
            >
              <Mail aria-hidden="true" className="size-3.5 text-faint" />
              <span className="font-mono text-[12px]">{member.email}</span>
            </a>

            <span className="inline-flex items-center gap-1.5">
              <Calendar aria-hidden="true" className="size-3.5 text-faint" />
              <span>
                Joined{" "}
                {new Date(member.createdAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </span>

            {member.inviterName && (
              <span className="inline-flex items-center gap-1.5">
                <User aria-hidden="true" className="size-3.5 text-faint" />
                <span>Invited by <strong className="text-ink font-medium">{member.inviterName}</strong></span>
              </span>
            )}
          </div>
        </div>

        {/* Right Column: Performance & Win Rate Dial */}
        <div className="flex shrink-0 items-center justify-center self-center py-1">
          <PerformanceDial
            totalClients={member.stats.totalClients}
            convertedCount={member.stats.convertedCount}
            inProgressCount={inProgressCount}
            discoveryCount={member.stats.discoveryCount}
            closedCount={member.stats.closedCount}
          />
        </div>
      </div>

      {/* Bottom Status & Key Performance Summary Bar */}
      <div className="relative z-20 flex flex-wrap items-center gap-x-6 gap-y-2.5 border-t border-rule-soft bg-paper/40 px-5 py-3 text-xs">
        <div className="flex items-center gap-2">
          <Building2 className="size-3.5 text-faint" />
          <span className="text-dim">
            Portfolio: <strong className="text-ink font-semibold">{member.stats.totalClients}</strong> owned
          </span>
        </div>

        <span aria-hidden="true" className="text-rule">·</span>

        <div className="flex items-center gap-2">
          <TrendingUp className="size-3.5 text-go" />
          <span className="text-dim">
            Won: <strong className="text-go font-semibold">{member.stats.convertedCount}</strong> client{member.stats.convertedCount === 1 ? "" : "s"}
          </span>
        </div>

        <span aria-hidden="true" className="text-rule">·</span>

        <div className="flex items-center gap-2">
          <Send className="size-3.5 text-lead" />
          <span className="text-dim">
            Outreach: <strong className="text-ink font-semibold">{member.stats.sentMessagesCount}</strong> verified message{member.stats.sentMessagesCount === 1 ? "" : "s"}
          </span>
        </div>

        <span aria-hidden="true" className="text-rule">·</span>

        <div className="flex items-center gap-2">
          <FileText className="size-3.5 text-faint" />
          <span className="text-dim">
            Intelligence: <strong className="text-ink font-semibold">{member.stats.notesCount}</strong> note{member.stats.notesCount === 1 ? "" : "s"}
          </span>
        </div>

        {inProgressCount > 0 && (
          <div className="ml-auto hidden sm:flex items-center gap-1.5 text-dim">
            <span className="size-2 rounded-full bg-lead animate-pulse" />
            <span><strong className="text-ink font-semibold">{inProgressCount}</strong> active in discussion</span>
          </div>
        )}
      </div>
    </div>
  );
}
