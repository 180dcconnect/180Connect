"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  hasConfiguredPreferences,
  getGeographicReachLabels,
  getIncomeBandLabels,
  getSanitizedSectors,
  type CamUser,
  type CamOutreachPreferences,
} from "@/lib/cam-settings";
import { Rise, Group } from "@/components/dashboard-stage";

function displayName(user: CamUser) {
  return user.full_name?.trim() || user.email;
}

function formatTimestamp(isoString?: string | null): string {
  if (!isoString) return "Never";
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CamSettingsPanel({
  users,
  preferencesMap,
  initialSelectedUserId,
}: {
  users: CamUser[];
  preferencesMap: Record<string, CamOutreachPreferences>;
  initialSelectedUserId?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Find valid user ID from props, query params, or default to first CAM / first user
  const effectiveInitialUserId = useMemo(() => {
    const fromQuery = searchParams.get("user");
    if (fromQuery && users.some((u) => u.id === fromQuery)) {
      return fromQuery;
    }
    if (initialSelectedUserId && users.some((u) => u.id === initialSelectedUserId)) {
      return initialSelectedUserId;
    }
    // Prefer CAMs first
    const firstCam = users.find((u) => u.role === "cam");
    return firstCam?.id ?? users[0]?.id ?? "";
  }, [users, searchParams, initialSelectedUserId]);

  const [selectedUserId, setSelectedUserId] = useState<string>(effectiveInitialUserId);

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId),
    [users, selectedUserId],
  );

  const selectedPreferences = selectedUserId
    ? preferencesMap[selectedUserId] ?? null
    : null;

  const isConfigured = hasConfiguredPreferences(selectedPreferences);

  const geoLabels = getGeographicReachLabels(
    selectedPreferences?.preferred_geographic_reach,
  );
  const incomeLabels = getIncomeBandLabels(
    selectedPreferences?.preferred_income_bands,
  );
  const sectorList = getSanitizedSectors(
    selectedPreferences?.preferred_sectors,
  );

  function handleUserChange(userId: string) {
    setSelectedUserId(userId);
    router.replace(`/admin/cam-settings?user=${userId}`, { scroll: false });
  }

  if (users.length === 0) {
    return (
      <div className="rounded-2xl border border-black/[0.06] bg-white p-8 text-center shadow-sm">
        <h2 className="text-lg font-bold text-foreground/80">No team members found</h2>
        <p className="mt-2 text-sm text-foreground/60">
          Invite CAMs from the User Management workspace to inspect their queue configuration.
        </p>
        <div className="mt-6">
          <Link
            href="/admin/users"
            className="inline-flex rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white shadow hover:bg-brand/90"
          >
            Go to User management
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* CAM Selection & Quick Overview Card */}
      <Rise>
        <div className="rounded-2xl border border-black/[0.06] bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <label
                htmlFor="cam-selector"
                className="text-xs font-bold uppercase tracking-[0.12em] text-foreground/50"
              >
                Select team member
              </label>
              <div className="pt-1">
                <Select value={selectedUserId} onValueChange={handleUserChange}>
                  <SelectTrigger
                    id="cam-selector"
                    aria-label="Select team member"
                    className="w-full min-w-[260px] bg-white font-medium sm:w-auto"
                  >
                    <SelectValue placeholder="Choose a member…" />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((user) => {
                      const userPrefs = preferencesMap[user.id];
                      const configured = hasConfiguredPreferences(userPrefs);
                      return (
                        <SelectItem key={user.id} value={user.id}>
                          <span className="font-semibold">{displayName(user)}</span>
                          <span className="ml-2 text-xs text-foreground/50">
                            ({user.role.toUpperCase()})
                            {configured ? " · Customised" : " · Default queue"}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {selectedUser && (
              <div className="flex flex-wrap items-center gap-3 border-t border-black/5 pt-4 sm:border-t-0 sm:pt-0">
                <span className="rounded-full bg-black/5 px-3 py-1 text-xs font-bold uppercase tracking-wider text-foreground/70">
                  Role: {selectedUser.role.toUpperCase()}
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    selectedUser.is_active
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-red-50 text-red-700 border border-red-200"
                  }`}
                >
                  {selectedUser.is_active ? "Active" : "Inactive"}
                </span>
                <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-bold text-brand">
                  {isConfigured ? "Custom queue filters" : "Default queue"}
                </span>
              </div>
            )}
          </div>
        </div>
      </Rise>

      {/* Queue Settings Detail Cards */}
      {selectedUser && (
        <Group className="space-y-6">
          <Rise>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-foreground">
                  {displayName(selectedUser)}&apos;s queue configuration
                </h2>
                <p className="text-xs text-foreground/55">
                  Last updated:{" "}
                  <span className="font-semibold text-foreground/75">
                    {formatTimestamp(selectedPreferences?.updated_at)}
                  </span>
                </p>
              </div>
            </div>
          </Rise>

          {!isConfigured && (
            <Rise>
              <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-5 text-sm text-blue-900 shadow-sm">
                <p className="font-bold">No custom outreach preferences configured</p>
                <p className="mt-1 text-blue-800/80">
                  This CAM has not saved specific sector, geographic, or size filters. Their prospect queue receives standard default weighting across all locations, organisation sizes, and causes.
                </p>
              </div>
            </Rise>
          )}

          <div className="grid gap-6 md:grid-cols-3">
            {/* Geographic Reach Card */}
            <Rise>
              <div className="flex h-full flex-col rounded-2xl border border-black/[0.06] bg-white p-6 shadow-sm">
                <div className="mb-4">
                  <h3 className="text-base font-bold text-foreground">Geographic focus</h3>
                  <p className="text-xs text-foreground/55">
                    Prioritised geographic regions in the CAM&apos;s queue.
                  </p>
                </div>
                <div className="flex-1">
                  {geoLabels.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {geoLabels.map((label) => (
                        <span
                          key={label}
                          className="inline-flex items-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl bg-black/[0.03] p-3 text-xs text-foreground/60">
                      <span className="font-semibold text-foreground/80">All geographies included</span>
                      <p className="mt-0.5">Local, regional, national, and international charities all appear.</p>
                    </div>
                  )}
                </div>
              </div>
            </Rise>

            {/* Size / Income Bands Card */}
            <Rise>
              <div className="flex h-full flex-col rounded-2xl border border-black/[0.06] bg-white p-6 shadow-sm">
                <div className="mb-4">
                  <h3 className="text-base font-bold text-foreground">Organisation size</h3>
                  <p className="text-xs text-foreground/55">
                    Target annual income bands prioritized in their queue.
                  </p>
                </div>
                <div className="flex-1">
                  {incomeLabels.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {incomeLabels.map((label) => (
                        <span
                          key={label}
                          className="inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl bg-black/[0.03] p-3 text-xs text-foreground/60">
                      <span className="font-semibold text-foreground/80">All sizes included</span>
                      <p className="mt-0.5">Charities across all income ranges appear without size filtering.</p>
                    </div>
                  )}
                </div>
              </div>
            </Rise>

            {/* Sectors Card */}
            <Rise>
              <div className="flex h-full flex-col rounded-2xl border border-black/[0.06] bg-white p-6 shadow-sm">
                <div className="mb-4">
                  <h3 className="text-base font-bold text-foreground">Sector preferences</h3>
                  <p className="text-xs text-foreground/55">
                    Targeted charity causes and focus areas.
                  </p>
                </div>
                <div className="flex-1">
                  {sectorList.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {sectorList.map((sector) => (
                        <span
                          key={sector}
                          className="inline-flex items-center rounded-lg border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-semibold text-purple-800"
                        >
                          {sector}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl bg-black/[0.03] p-3 text-xs text-foreground/60">
                      <span className="font-semibold text-foreground/80">All sectors included</span>
                      <p className="mt-0.5">No specific sector filters set; all charity causes are eligible.</p>
                    </div>
                  )}
                </div>
              </div>
            </Rise>
          </div>
        </Group>
      )}
    </div>
  );
}
