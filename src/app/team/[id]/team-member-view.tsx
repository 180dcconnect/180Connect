"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  Building2,
  Clock,
  Compass,
  FileText,
  Send,
  Shield,
  TrendingUp,
} from "lucide-react";
import { Liquid } from "liquid-gooey";

import { Group, Rise } from "@/components/dashboard-stage";
import { Pill, SectionCard } from "@/app/clients/[id]/section-card";
import { formatLocation, formatOutreachStatus } from "@/lib/organisation-format";

import { AssignedClientsCard, type AssignedClientItem } from "./assigned-clients-card";

export type MemberActivityItem = {
  id: string;
  sentence: string;
  relativeTime: string;
  targetHref: string | null;
  actorName: string;
};

export type MemberNoteItem = {
  id: string;
  content: string;
  createdAt: string;
  organisationId: string;
  organisationName: string;
};

export type MemberPreferences = {
  preferred_sectors?: string[] | null;
  preferred_geographic_reach?: string[] | null;
  preferred_income_bands?: string[] | null;
  updated_at?: string | null;
} | null;

export type TeamMemberViewProps = {
  member: {
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
  };
  clients: AssignedClientItem[];
  recentNotes: MemberNoteItem[];
  activities: MemberActivityItem[];
  preferences: MemberPreferences;
  stats: {
    totalClients: number;
    discoveryCount: number;
    outreachCount: number;
    discussionCount: number;
    convertedCount: number;
    closedCount: number;
    sentMessagesCount: number;
    notesCount: number;
    conversionRate: string;
  };
};

const TABS = [
  { id: "overview", label: "Overview", countKey: null },
  { id: "clients", label: "Assigned Clients", countKey: "clients" },
  { id: "activity", label: "Activity", countKey: "activity" },
  { id: "governance", label: "Governance & Focus", countKey: null },
] as const;

type TabId = (typeof TABS)[number]["id"];
const TAB_WIDTH = 145;

function toneForStatus(status: string): "go" | "stop" | "neutral" | "hold" {
  if (status === "converted") return "go";
  if (["meeting_held", "proposal_requested", "proposal_submitted"].includes(status)) return "go";
  if (["initial_outreach_sent", "follow_up_1_sent", "follow_up_2_sent"].includes(status)) return "hold";
  if (["stalled", "rejected", "unresponsive", "do_not_contact"].includes(status)) return "stop";
  return "neutral";
}

export function TeamMemberView({
  member,
  clients,
  recentNotes,
  activities,
  preferences,
  stats,
}: TeamMemberViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  const displayName = member.fullName?.trim() || member.email;
  const activeIndex = TABS.findIndex((t) => t.id === activeTab);

  const inProgressCount = stats.outreachCount + stats.discussionCount;
  const inProgressPercent = stats.totalClients > 0 ? Math.round((inProgressCount / stats.totalClients) * 100) : 0;
  const convertedPercent = stats.totalClients > 0 ? Math.round((stats.convertedCount / stats.totalClients) * 100) : 0;
  const discoveryPercent = stats.totalClients > 0 ? Math.round((stats.discoveryCount / stats.totalClients) * 100) : 0;
  const closedPercent = stats.totalClients > 0 ? Math.round((stats.closedCount / stats.totalClients) * 100) : 0;

  const countsMap = {
    clients: clients.length,
    activity: activities.length,
  };

  return (
    <div className="space-y-6">
      {/* Sticky Liquid Tab Navigation Bar */}
      <nav
        aria-label="Sections of team member profile"
        className="sticky top-0 z-30 py-1"
      >
        <Liquid
          blur={5}
          contrast={18}
          fill="var(--lead)"
          shadow="0 2px 8px rgba(35, 64, 122, 0.25)"
          className="relative inline-flex max-w-full items-center overflow-x-auto rounded-full border border-lead/10 bg-lead-wash/50 p-1 backdrop-blur-xl backdrop-saturate-150 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <Liquid.Item effect="move" move={{ springiness: 0.6, trail: 0.5, stretch: 0.25 }}>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-1 bottom-1 left-1 rounded-full bg-lead transition-[transform,opacity] duration-300"
              style={{
                width: `${TAB_WIDTH}px`,
                transform: `translateX(${Math.max(activeIndex, 0) * TAB_WIDTH}px)`,
                opacity: activeIndex === -1 ? 0 : 1,
              }}
            />
          </Liquid.Item>

          <div className="relative z-10 flex items-center">
            {TABS.map((tab) => {
              const active = tab.id === activeTab;
              const count = tab.countKey ? countsMap[tab.countKey] : null;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  style={{ width: `${TAB_WIDTH}px` }}
                  className={`flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-[13px] font-semibold whitespace-nowrap transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lead-mid ${
                    active ? "text-white" : "text-dim hover:text-ink"
                  }`}
                >
                  <span>{tab.label}</span>
                  {count !== null && count > 0 && (
                    <span
                      className={`ml-1.5 font-mono text-[10.5px] tabular-nums ${
                        active ? "text-white/70" : "text-faint"
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Liquid>
      </nav>

      {/* ──────────────────────────────────────────────────────────────────────────
          TAB 1: OVERVIEW
      ────────────────────────────────────────────────────────────────────────── */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* 4 Metric KPI Cards */}
          <Group className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Rise className="rounded-panel border border-rule bg-white p-5 shadow-xs transition-shadow hover:shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wider text-dim">
                  Owned Portfolio
                </p>
                <Building2 aria-hidden="true" className="size-4 text-faint" />
              </div>
              <p className="mt-2.5 font-mono text-3xl font-bold tracking-tight text-ink">
                {stats.totalClients}
              </p>
              <p className="mt-1 text-[12px] text-dim">
                <strong className="text-ink font-medium">{inProgressCount}</strong> in active outreach
              </p>
            </Rise>

            <Rise className="rounded-panel border border-rule bg-white p-5 shadow-xs transition-shadow hover:shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wider text-dim">
                  Win Rate
                </p>
                <TrendingUp aria-hidden="true" className="size-4 text-go" />
              </div>
              <p className="mt-2.5 font-mono text-3xl font-bold tracking-tight text-ink">
                {stats.conversionRate}%
              </p>
              <p className="mt-1 text-[12px] text-dim">
                <strong className="text-go font-medium">{stats.convertedCount}</strong> {stats.convertedCount === 1 ? "client won" : "clients won"}
              </p>
            </Rise>

            <Rise className="rounded-panel border border-rule bg-white p-5 shadow-xs transition-shadow hover:shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wider text-dim">
                  Outreach Sent
                </p>
                <Send aria-hidden="true" className="size-4 text-lead" />
              </div>
              <p className="mt-2.5 font-mono text-3xl font-bold tracking-tight text-ink">
                {stats.sentMessagesCount}
              </p>
              <p className="mt-1 text-[12px] text-dim">
                Verified client sends
              </p>
            </Rise>

            <Rise className="rounded-panel border border-rule bg-white p-5 shadow-xs transition-shadow hover:shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wider text-dim">
                  Notes Authored
                </p>
                <FileText aria-hidden="true" className="size-4 text-faint" />
              </div>
              <p className="mt-2.5 font-mono text-3xl font-bold tracking-tight text-ink">
                {stats.notesCount}
              </p>
              <p className="mt-1 text-[12px] text-dim">
                Internal intelligence
              </p>
            </Rise>
          </Group>

          {/* Pipeline Health Progression Bar */}
          {stats.totalClients > 0 && (
            <Rise>
              <SectionCard
                headingId="pipeline-health-heading"
                title="Pipeline Progression"
                hint={`Progression breakdown of ${stats.totalClients} clients currently assigned to ${displayName}.`}
                icon={<Activity />}
                action={
                  <button
                    type="button"
                    onClick={() => setActiveTab("clients")}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-lead hover:underline cursor-pointer"
                  >
                    <span>Explore portfolio</span>
                    <ArrowUpRight className="size-3" />
                  </button>
                }
              >
                <div className="mt-4 space-y-3">
                  {/* Segmented Progression Bar */}
                  <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-paper border border-rule-soft">
                    {discoveryPercent > 0 && (
                      <div
                        style={{ width: `${discoveryPercent}%` }}
                        className="bg-faint/60 transition-all"
                        title={`Discovery: ${stats.discoveryCount} (${discoveryPercent}%)`}
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
                        title={`Won: ${stats.convertedCount} (${convertedPercent}%)`}
                      />
                    )}
                    {closedPercent > 0 && (
                      <div
                        style={{ width: `${closedPercent}%` }}
                        className="bg-stop/50 transition-all"
                        title={`Closed / Stalled: ${stats.closedCount} (${closedPercent}%)`}
                      />
                    )}
                  </div>

                  {/* Segment Legend */}
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="size-2.5 rounded-full bg-faint/60" />
                      <span className="text-dim">Discovery ({stats.discoveryCount})</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="size-2.5 rounded-full bg-lead" />
                      <span className="text-dim">Outreach & Discussion ({inProgressCount})</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="size-2.5 rounded-full bg-go" />
                      <span className="text-dim font-medium text-ink">Won ({stats.convertedCount})</span>
                    </div>
                    {stats.closedCount > 0 && (
                      <div className="flex items-center gap-1.5">
                        <span className="size-2.5 rounded-full bg-stop/50" />
                        <span className="text-dim">Closed / Stalled ({stats.closedCount})</span>
                      </div>
                    )}
                  </div>
                </div>
              </SectionCard>
            </Rise>
          )}

          {/* Overview Split: High Priority Active Clients & Recent Intelligence Notes */}
          <div className="grid items-start gap-6 lg:grid-cols-2">
            {/* Top Priority Clients Preview */}
            <Rise>
              <SectionCard
                headingId="top-clients-heading"
                title="Top Priority Clients"
                hint="Highest priority organisation accounts currently owned."
                icon={<Building2 />}
                action={
                  clients.length > 4 ? (
                    <button
                      type="button"
                      onClick={() => setActiveTab("clients")}
                      className="text-xs font-semibold text-lead hover:underline cursor-pointer"
                    >
                      View all ({clients.length})
                    </button>
                  ) : null
                }
              >
                {clients.length === 0 ? (
                  <p className="py-6 text-center text-xs text-dim">
                    No clients assigned yet.
                  </p>
                ) : (
                  <ul className="mt-3.5 divide-y divide-rule/40 rounded-panel border border-rule bg-white overflow-hidden">
                    {clients.slice(0, 4).map((c) => {
                      const tone = toneForStatus(c.outreach_status);
                      const location = formatLocation({ city: c.city, country_code: c.country_code ?? "GB" });
                      return (
                        <li key={c.id}>
                          <Link
                            href={`/clients/${c.id}`}
                            className="group flex items-center justify-between p-3.5 px-4 transition-colors hover:bg-paper/70"
                          >
                            <div className="min-w-0 flex-1 pr-3">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-[13.5px] font-semibold text-ink group-hover:text-lead transition-colors">
                                  {c.legal_name}
                                </span>
                                {c.priority_score !== null && (
                                  <span className="font-mono text-[10.5px] font-medium text-dim bg-paper px-1.5 py-0.2 rounded border border-rule-soft tabular-nums">
                                    Score {c.priority_score.toFixed(1)}
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 truncate text-[11.5px] text-dim">
                                {c.organisation_type}{location ? ` · ${location}` : ""}
                              </p>
                            </div>
                            <Pill tone={tone}>{formatOutreachStatus(c.outreach_status)}</Pill>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </SectionCard>
            </Rise>

            {/* Recent Notes & Touchpoint Intelligence */}
            <Rise>
              <SectionCard
                headingId="overview-notes-heading"
                title="Client Notes & Intelligence"
                hint={`Recent research and outreach notes authored by ${displayName}.`}
                icon={<FileText />}
                action={
                  recentNotes.length > 3 ? (
                    <button
                      type="button"
                      onClick={() => setActiveTab("activity")}
                      className="text-xs font-semibold text-lead hover:underline cursor-pointer"
                    >
                      View all notes
                    </button>
                  ) : null
                }
              >
                {recentNotes.length === 0 ? (
                  <p className="py-6 text-center text-xs text-dim">
                    No notes recorded yet.
                  </p>
                ) : (
                  <ul className="mt-3.5 divide-y divide-rule/40 rounded-panel border border-rule bg-white p-2 px-3 overflow-hidden">
                    {recentNotes.slice(0, 3).map((note) => (
                      <li key={note.id} className="py-3 first:pt-1 last:pb-1">
                        <div className="flex items-center justify-between gap-2">
                          <Link
                            href={`/clients/${note.organisationId}`}
                            className="text-[13px] font-semibold text-ink hover:text-lead transition-colors flex items-center gap-1"
                          >
                            <span>{note.organisationName}</span>
                            <ArrowUpRight className="size-3 text-faint" />
                          </Link>
                          <span className="text-[11px] text-faint">
                            {new Date(note.createdAt).toLocaleDateString("en-GB", {
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
                )}
              </SectionCard>
            </Rise>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          TAB 2: ASSIGNED CLIENTS
      ────────────────────────────────────────────────────────────────────────── */}
      {activeTab === "clients" && (
        <Rise>
          <AssignedClientsCard
            clients={clients}
            userId={member.id}
            displayName={displayName}
          />
        </Rise>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          TAB 3: ACTIVITY & AUDIT TIMELINE
      ────────────────────────────────────────────────────────────────────────── */}
      {activeTab === "activity" && (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          {/* Main Activity Timeline Feed */}
          <Rise>
            <SectionCard
              headingId="full-activity-heading"
              title="Team Member Activity Timeline"
              hint={`Audit log stream of actions, status transitions, and client outreach by ${displayName}.`}
              icon={<Clock />}
            >
              {activities.length === 0 ? (
                <div className="py-10 text-center text-xs text-dim">
                  No logged activity records found for this team member.
                </div>
              ) : (
                <ul className="mt-3.5 divide-y divide-rule/40 rounded-panel border border-rule bg-white p-2 px-3 overflow-hidden">
                  {activities.map((item) => (
                    <li key={item.id} className="py-3 first:pt-1.5 last:pb-1.5">
                      <p className="text-[13px] leading-snug font-medium text-ink">
                        {item.sentence}
                      </p>
                      <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-faint">
                        <span>{item.relativeTime}</span>
                        {item.targetHref && (
                          <Link
                            href={item.targetHref}
                            className="font-semibold text-lead hover:underline flex items-center gap-0.5"
                          >
                            <span>View client record</span>
                            <ArrowUpRight className="size-2.5" />
                          </Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </Rise>

          {/* All Authored Notes & Intelligence */}
          <Rise>
            <SectionCard
              headingId="all-notes-heading"
              title="Authored Client Notes"
              hint="All research findings and touchpoint updates authored by this member."
              icon={<FileText />}
            >
              {recentNotes.length === 0 ? (
                <p className="py-8 text-center text-xs text-dim">
                  No notes recorded yet.
                </p>
              ) : (
                <ul className="mt-3.5 divide-y divide-rule/40 rounded-panel border border-rule bg-white p-2 px-3 overflow-hidden">
                  {recentNotes.map((note) => (
                    <li key={note.id} className="py-3 first:pt-1 last:pb-1">
                      <div className="flex items-center justify-between gap-2">
                        <Link
                          href={`/clients/${note.organisationId}`}
                          className="text-[13px] font-semibold text-ink hover:text-lead transition-colors flex items-center gap-1"
                        >
                          <span>{note.organisationName}</span>
                          <ArrowUpRight className="size-3 text-faint" />
                        </Link>
                        <span className="text-[11px] text-faint">
                          {new Date(note.createdAt).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[12.5px] leading-relaxed text-dim">
                        {note.content}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </Rise>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          TAB 4: GOVERNANCE & OUTREACH FOCUS
      ────────────────────────────────────────────────────────────────────────── */}
      {activeTab === "governance" && (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          {/* Outreach Preferences & Automated Discovery Criteria */}
          <Rise>
            <SectionCard
              headingId="focus-preferences-heading"
              title="Outreach Focus & Queue Criteria"
              hint="Matching preferences used by automated client queueing and allocation."
              icon={<Compass />}
              action={
                member.isSelf ? (
                  <Link
                    href="/profile"
                    className="text-xs font-semibold text-lead hover:underline"
                  >
                    Edit preferences
                  </Link>
                ) : member.isAdmin && member.role === "cam" ? (
                  <Link
                    href={`/admin/cam-settings?user=${member.id}`}
                    className="text-xs font-semibold text-lead hover:underline"
                  >
                    Configure CAM queue
                  </Link>
                ) : null
              }
            >
              {preferences &&
              (preferences.preferred_sectors?.length ||
                preferences.preferred_geographic_reach?.length ||
                preferences.preferred_income_bands?.length) ? (
                <div className="mt-4 space-y-4 rounded-panel border border-rule bg-white p-4">
                  {preferences.preferred_sectors?.length ? (
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wider text-dim">
                        Preferred Sectors
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {preferences.preferred_sectors.map((s: string) => (
                          <span
                            key={s}
                            className="rounded-full bg-paper px-3 py-1 text-xs font-medium text-ink border border-rule-soft"
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
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {preferences.preferred_geographic_reach.map((r: string) => (
                          <span
                            key={r}
                            className="rounded-full bg-paper px-3 py-1 text-xs font-medium text-ink capitalize border border-rule-soft"
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
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {preferences.preferred_income_bands.map((b: string) => (
                          <span
                            key={b}
                            className="rounded-full bg-paper px-3 py-1 text-xs font-mono font-medium text-ink uppercase border border-rule-soft"
                          >
                            {b.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-dim">
                  No automated outreach preferences have been configured for this member.
                </div>
              )}
            </SectionCard>
          </Rise>

          {/* Account Governance & Security Card */}
          <Rise>
            <SectionCard
              headingId="security-governance-heading"
              title="Account Governance"
              hint="Security, role authorization, and organizational credentials."
              icon={<Shield />}
            >
              <dl className="mt-4 space-y-2 text-xs rounded-panel border border-rule bg-white p-4">
                <div className="flex justify-between py-1.5 border-b border-rule/30">
                  <dt className="text-dim">Role</dt>
                  <dd className="font-semibold uppercase text-ink">{member.role}</dd>
                </div>
                <div className="flex justify-between py-1.5 border-b border-rule/30">
                  <dt className="text-dim">Access State</dt>
                  <dd className="font-semibold text-ink">
                    {member.isActive ? "Active" : member.deactivatedAt ? "Deactivated" : "Suspended"}
                  </dd>
                </div>
                <div className="flex justify-between py-1.5 border-b border-rule/30">
                  <dt className="text-dim">Email Address</dt>
                  <dd className="font-mono text-ink/80 text-[11.5px] truncate max-w-[200px]">
                    {member.email}
                  </dd>
                </div>
                <div className="flex justify-between py-1.5 border-b border-rule/30">
                  <dt className="text-dim">Member Since</dt>
                  <dd className="font-medium text-ink">
                    {new Date(member.createdAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </dd>
                </div>
                {member.inviterName && (
                  <div className="flex justify-between py-1.5">
                    <dt className="text-dim">Invited By</dt>
                    <dd className="font-medium text-ink">{member.inviterName}</dd>
                  </div>
                )}
              </dl>
            </SectionCard>
          </Rise>
        </div>
      )}
    </div>
  );
}
