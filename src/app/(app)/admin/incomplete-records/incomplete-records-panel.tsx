"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { VIEW_ONLY_CONTROL_NOTE } from "@/lib/auth/view-only";
import { adminDirectEditsAction } from "@/app/(app)/clients/[id]/admin-actions";
import { readMissionFromWebsiteAction } from "@/app/(app)/clients/[id]/mission-actions";
import { formatLocation, formatOrganisationType } from "@/lib/organisation-format";
import { PaginatedList } from "@/components/ui/paginated-list";
import type { FilterTab, IncompleteClientRecord } from "./types";

const CANONICAL_SECTORS = [
  "Health",
  "Education",
  "Environment & sustainability",
  "Poverty & hardship",
  "Community & youth",
  "Arts, culture & sport",
  "Justice & enterprise",
] as const;

export function IncompleteRecordsPanel({
  initialRecords,
  canEdit,
}: {
  initialRecords: IncompleteClientRecord[];
  canEdit: boolean;
}) {
  const [records, setRecords] = useState<IncompleteClientRecord[]>(initialRecords);
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const counts = {
    all: records.filter((r) => r.isIncomplete).length,
    mission: records.filter((r) => !r.hasMission).length,
    sector: records.filter((r) => !r.hasSector).length,
    website: records.filter((r) => !r.hasWebsite).length,
    email: records.filter((r) => !r.hasEmail).length,
  };

  const filteredRecords = records.filter((record) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchesName = record.legal_name.toLowerCase().includes(q);
      const matchesCity = record.city?.toLowerCase().includes(q) ?? false;
      if (!matchesName && !matchesCity) return false;
    }

    switch (activeTab) {
      case "all":
        return record.isIncomplete;
      case "mission":
        return !record.hasMission;
      case "sector":
        return !record.hasSector;
      case "website":
        return !record.hasWebsite;
      case "email":
        return !record.hasEmail;
      default:
        return true;
    }
  });

  const handleUpdateRecord = (updated: Partial<IncompleteClientRecord> & { id: string }) => {
    setRecords((prev) =>
      prev.map((item) => {
        if (item.id !== updated.id) return item;
        const merged = { ...item, ...updated };
        const isIncomplete = !merged.hasSector || !merged.hasMission || !merged.hasWebsite;
        return { ...merged, isIncomplete };
      }),
    );
  };

  return (
    <div className="mt-6 space-y-6">
      {/* Controls & Filter Tabs */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Incomplete records filters" className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === "all"
                ? "bg-lead text-paper"
                : "bg-white text-ink border border-rule hover:bg-paper"
            }`}
          >
            <span>All Incomplete</span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                activeTab === "all" ? "bg-white/20 text-white" : "bg-paper text-dim"
              }`}
            >
              {counts.all.toLocaleString()}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("mission")}
            className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === "mission"
                ? "bg-lead text-paper"
                : "bg-white text-ink border border-rule hover:bg-paper"
            }`}
          >
            <span>Missing Mission</span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                activeTab === "mission" ? "bg-white/20 text-white" : "bg-paper text-dim"
              }`}
            >
              {counts.mission.toLocaleString()}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("sector")}
            className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === "sector"
                ? "bg-lead text-paper"
                : "bg-white text-ink border border-rule hover:bg-paper"
            }`}
          >
            <span>Missing Sector</span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                activeTab === "sector" ? "bg-white/20 text-white" : "bg-paper text-dim"
              }`}
            >
              {counts.sector.toLocaleString()}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("website")}
            className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === "website"
                ? "bg-lead text-paper"
                : "bg-white text-ink border border-rule hover:bg-paper"
            }`}
          >
            <span>Missing Website</span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                activeTab === "website" ? "bg-white/20 text-white" : "bg-paper text-dim"
              }`}
            >
              {counts.website.toLocaleString()}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("email")}
            className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === "email"
                ? "bg-lead text-paper"
                : "bg-white text-ink border border-rule hover:bg-paper"
            }`}
          >
            <span>Missing Email</span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                activeTab === "email" ? "bg-white/20 text-white" : "bg-paper text-dim"
              }`}
            >
              {counts.email.toLocaleString()}
            </span>
          </button>
        </nav>

        {/* Search input */}
        <div className="w-full sm:w-64">
          <label htmlFor="incomplete-search" className="sr-only">
            Search incomplete clients
          </label>
          <input
            id="incomplete-search"
            type="search"
            placeholder="Search by client name or city..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-inset border border-rule bg-white px-3 py-1.5 text-xs text-ink placeholder:text-dim/60 focus:border-lead focus:outline-none focus:ring-1 focus:ring-lead"
          />
        </div>
      </div>

      {/* Record cards list */}
      {filteredRecords.length === 0 ? (
        <div className="rounded-panel border border-rule bg-white p-12 text-center">
          <p className="text-base font-semibold text-ink">All records up to date</p>
          <p className="mt-1 text-sm text-dim">
            {searchQuery
              ? "No client records matched your search."
              : activeTab === "all"
                ? "No client records are currently missing a mission statement, sector, or website."
                : `No client records are currently missing ${activeTab === "email" ? "a contact email" : activeTab === "website" ? "a website" : activeTab === "sector" ? "a sector" : "a mission statement"}.`}
          </p>
        </div>
      ) : (
        <PaginatedList
          items={filteredRecords}
          initialPageSize={10}
          render={(items) => (
            <div className="space-y-4">
              {items.map((record) => (
                <ClientCleaningCard
                  key={record.id}
                  record={record}
                  canEdit={canEdit}
                  onUpdate={handleUpdateRecord}
                />
              ))}
            </div>
          )}
        />
      )}
    </div>
  );
}

function ClientCleaningCard({
  record,
  canEdit,
  onUpdate,
}: {
  record: IncompleteClientRecord;
  canEdit: boolean;
  onUpdate: (updated: Partial<IncompleteClientRecord> & { id: string }) => void;
}) {
  // Sector state
  const [sectorInput, setSectorInput] = useState(
    record.sector && record.sector.toLowerCase() !== "unclassified" ? record.sector : "",
  );
  const [isEditingSector, setIsEditingSector] = useState(!record.hasSector);
  const [isSavingSector, startSectorTransition] = useTransition();
  const [sectorMessage, setSectorMessage] = useState<string | null>(null);

  // Website state
  const [websiteInput, setWebsiteInput] = useState(record.website ?? "");
  const [isEditingWebsite, setIsEditingWebsite] = useState(!record.hasWebsite);
  const [isSavingWebsite, startWebsiteTransition] = useTransition();
  const [websiteMessage, setWebsiteMessage] = useState<string | null>(null);

  // Mission state
  const [missionInput, setMissionInput] = useState(record.mission ?? "");
  const [isEditingMission, setIsEditingMission] = useState(!record.hasMission);
  const [isSavingMission, startMissionTransition] = useTransition();
  const [isFetchingMission, setIsFetchingMission] = useState(false);
  const [missionMessage, setMissionMessage] = useState<string | null>(null);
  const [missionStatus, setMissionStatus] = useState<"idle" | "proposed" | "error">("idle");

  // Email state
  const [emailInput, setEmailInput] = useState(record.contact_email ?? "");
  const [isEditingEmail, setIsEditingEmail] = useState(!record.hasEmail);
  const [isSavingEmail, startEmailTransition] = useTransition();
  const [emailMessage, setEmailMessage] = useState<string | null>(null);

  // Save Sector
  const handleSaveSector = () => {
    if (!sectorInput.trim()) return;
    setSectorMessage(null);
    startSectorTransition(async () => {
      const res = await adminDirectEditsAction({
        organisationId: record.id,
        changes: [{ fieldName: "sector", value: sectorInput.trim() }],
      });
      if (res.kind === "success") {
        setSectorMessage("Saved");
        setIsEditingSector(false);
        onUpdate({ id: record.id, sector: sectorInput.trim(), hasSector: true });
      } else {
        setSectorMessage(res.message || "Failed to save sector");
      }
    });
  };

  // Save Website
  const handleSaveWebsite = () => {
    if (!websiteInput.trim()) return;
    setWebsiteMessage(null);
    startWebsiteTransition(async () => {
      const res = await adminDirectEditsAction({
        organisationId: record.id,
        changes: [{ fieldName: "website", value: websiteInput.trim() }],
      });
      if (res.kind === "success") {
        setWebsiteMessage("Saved");
        setIsEditingWebsite(false);
        onUpdate({ id: record.id, website: websiteInput.trim(), hasWebsite: true });
      } else {
        setWebsiteMessage(res.message || "Failed to save website");
      }
    });
  };

  // Fetch Mission from Website
  const handleFetchMission = async () => {
    const urlToFetch = websiteInput.trim() || record.website?.trim();
    if (!urlToFetch) {
      setMissionMessage("Add a website first to fetch mission automatically.");
      setMissionStatus("error");
      return;
    }

    setIsFetchingMission(true);
    setMissionMessage(null);
    setMissionStatus("idle");

    try {
      const res = await readMissionFromWebsiteAction({
        organisationId: record.id,
        url: urlToFetch,
      });

      if (res.kind === "proposed") {
        setMissionInput(res.mission);
        setMissionStatus("proposed");
        setMissionMessage(`Found mission from ${res.hostname}. Review below and save.`);
        setIsEditingMission(true);
      } else if (res.kind === "skipped") {
        setMissionStatus("error");
        setMissionMessage(res.message);
      } else {
        setMissionStatus("error");
        setMissionMessage(res.message);
      }
    } catch {
      setMissionStatus("error");
      setMissionMessage("Failed to fetch mission from website.");
    } finally {
      setIsFetchingMission(false);
    }
  };

  // Save Mission
  const handleSaveMission = () => {
    if (!missionInput.trim()) return;
    setMissionMessage(null);
    startMissionTransition(async () => {
      const res = await adminDirectEditsAction({
        organisationId: record.id,
        changes: [{ fieldName: "mission_statement", value: missionInput.trim() }],
      });
      if (res.kind === "success") {
        setMissionMessage("Saved");
        setMissionStatus("idle");
        setIsEditingMission(false);
        onUpdate({ id: record.id, mission: missionInput.trim(), hasMission: true });
      } else {
        setMissionMessage(res.message || "Failed to save mission");
        setMissionStatus("error");
      }
    });
  };

  // Save Email
  const handleSaveEmail = () => {
    if (!emailInput.trim()) return;
    setEmailMessage(null);
    startEmailTransition(async () => {
      const res = await adminDirectEditsAction({
        organisationId: record.id,
        changes: [{ fieldName: "contact_email", value: emailInput.trim() }],
      });
      if (res.kind === "success") {
        setEmailMessage("Saved");
        setIsEditingEmail(false);
        onUpdate({ id: record.id, contact_email: emailInput.trim(), hasEmail: true });
      } else {
        setEmailMessage(res.message || "Failed to save email");
      }
    });
  };

  const activeWebsite = (websiteInput.trim() || record.website?.trim()) ?? "";
  const websiteHref = activeWebsite
    ? activeWebsite.startsWith("http://") || activeWebsite.startsWith("https://")
      ? activeWebsite
      : `https://${activeWebsite}`
    : null;

  return (
    <article className="rounded-panel border border-rule bg-white p-5">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/clients/${record.id}`}
              className="font-bold text-ink hover:text-lead hover:underline text-base"
            >
              {record.legal_name}
            </Link>
            <span className="rounded-full bg-paper px-2 py-0.5 text-[11px] font-medium text-dim">
              {formatOrganisationType(record.organisation_type)}
            </span>
          </div>

          <p className="mt-1 text-xs text-dim">
            Location: <span className="text-ink font-medium">{formatLocation(record)}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {!record.hasMission && (
            <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
              Missing mission
            </span>
          )}
          {!record.hasSector && (
            <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
              Missing sector
            </span>
          )}
          {!record.hasWebsite && (
            <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
              Missing website
            </span>
          )}
          {!record.hasEmail && (
            <span className="inline-flex items-center rounded-full bg-paper-sunk px-2 py-0.5 text-[11px] font-medium text-dim">
              No email
            </span>
          )}
          {!record.isIncomplete && record.hasEmail && (
            <span className="inline-flex items-center rounded-full bg-go-wash px-2 py-0.5 text-[11px] font-semibold text-go">
              Complete ✓
            </span>
          )}

          <Link
            href={`/clients/${record.id}`}
            className="ml-2 text-xs font-semibold text-lead hover:underline"
          >
            Open profile →
          </Link>
        </div>
      </div>

      {/* Cleaning Workstation Grid */}
      <div className="mt-4 grid gap-4 border-t border-rule-soft pt-4 sm:grid-cols-2">
        {/* Sector Column */}
        <div className="rounded-inset bg-paper p-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-dim">
                Sector
              </span>
              {canEdit && !isEditingSector && (
                <button
                  type="button"
                  onClick={() => setIsEditingSector(true)}
                  className="text-xs font-semibold text-lead hover:underline"
                >
                  Change
                </button>
              )}
            </div>

            <div className="mt-2">
              {!isEditingSector && record.hasSector ? (
                <div className="flex items-center gap-2">
                  <span className="inline-block rounded-inset border border-rule bg-white px-2.5 py-1 text-xs font-semibold text-ink">
                    {record.sector}
                  </span>
                  {sectorMessage && (
                    <span className="text-xs font-semibold text-go">{sectorMessage}</span>
                  )}
                </div>
              ) : canEdit ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <select
                      value={sectorInput}
                      onChange={(e) => setSectorInput(e.target.value)}
                      className="w-full rounded-inset border border-rule bg-white px-2.5 py-1.5 text-xs text-ink focus:border-lead focus:outline-none focus:ring-1 focus:ring-lead"
                    >
                      <option value="">Select a sector...</option>
                      {CANONICAL_SECTORS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      disabled={isSavingSector || !sectorInput.trim()}
                      onClick={handleSaveSector}
                      className="shrink-0 rounded-inset bg-lead px-3 py-1.5 text-xs font-semibold text-paper hover:bg-lead-mid disabled:opacity-50"
                    >
                      {isSavingSector ? "Saving..." : "Save sector"}
                    </button>
                  </div>

                  {sectorMessage && (
                    <p className="text-xs font-medium text-dim">{sectorMessage}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  <span className="text-xs text-faint italic">No sector recorded</span>
                  <p className="text-[11px] text-dim italic">{VIEW_ONLY_CONTROL_NOTE}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Website Column */}
        <div className="rounded-inset bg-paper p-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-dim">
                Website
              </span>
              {canEdit && !isEditingWebsite && (
                <button
                  type="button"
                  onClick={() => setIsEditingWebsite(true)}
                  className="text-xs font-semibold text-lead hover:underline"
                >
                  Change
                </button>
              )}
            </div>

            <div className="mt-2">
              {!isEditingWebsite && record.hasWebsite ? (
                <div className="flex flex-wrap items-center gap-2">
                  {websiteHref && (
                    <a
                      href={websiteHref}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-inset border border-rule bg-white px-2.5 py-1 text-xs font-semibold text-lead hover:underline"
                    >
                      <span>{record.website}</span>
                      <span aria-hidden="true">↗</span>
                    </a>
                  )}
                  {websiteMessage && (
                    <span className="text-xs font-semibold text-go">{websiteMessage}</span>
                  )}
                </div>
              ) : canEdit ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="url"
                      placeholder="https://example.org"
                      value={websiteInput}
                      onChange={(e) => setWebsiteInput(e.target.value)}
                      className="w-full rounded-inset border border-rule bg-white px-2.5 py-1.5 text-xs text-ink placeholder:text-dim/60 focus:border-lead focus:outline-none focus:ring-1 focus:ring-lead"
                    />

                    <button
                      type="button"
                      disabled={isSavingWebsite || !websiteInput.trim()}
                      onClick={handleSaveWebsite}
                      className="shrink-0 rounded-inset bg-lead px-3 py-1.5 text-xs font-semibold text-paper hover:bg-lead-mid disabled:opacity-50"
                    >
                      {isSavingWebsite ? "Saving..." : "Save website"}
                    </button>
                  </div>

                  {websiteMessage && (
                    <p className="text-xs font-medium text-dim">{websiteMessage}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  <span className="text-xs text-faint italic">No website recorded</span>
                  <p className="text-[11px] text-dim italic">{VIEW_ONLY_CONTROL_NOTE}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mission Statement (Full Width) */}
        <div className="sm:col-span-2 rounded-inset bg-paper p-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-dim">
                Mission Statement
              </span>
              {!record.hasMission && (
                <span className="text-[11px] text-amber-700 font-medium">(Missing)</span>
              )}
            </div>

            {canEdit && !isEditingMission && (
              <button
                type="button"
                onClick={() => setIsEditingMission(true)}
                className="text-xs font-semibold text-lead hover:underline"
              >
                Edit mission
              </button>
            )}
          </div>

          <div className="mt-2">
            {!isEditingMission && record.hasMission ? (
              <div className="space-y-1.5">
                <p className="text-xs leading-relaxed text-ink bg-white p-3 rounded-inset border border-rule">
                  {record.mission}
                </p>
                {missionMessage && (
                  <span className="text-xs font-semibold text-go">{missionMessage}</span>
                )}
              </div>
            ) : canEdit ? (
              <div className="space-y-2">
                <textarea
                  rows={3}
                  placeholder="Enter or paste the organisation's mission statement..."
                  value={missionInput}
                  onChange={(e) => setMissionInput(e.target.value)}
                  className="w-full rounded-inset border border-rule bg-white p-2.5 text-xs text-ink placeholder:text-dim/60 focus:border-lead focus:outline-none focus:ring-1 focus:ring-lead leading-relaxed"
                />

                {missionMessage && (
                  <div
                    className={`rounded-inset p-2 text-xs font-medium ${
                      missionStatus === "error"
                        ? "bg-stop-wash text-stop border border-stop/20"
                        : missionStatus === "proposed"
                          ? "bg-lead-wash text-lead border border-lead/20"
                          : "bg-go-wash text-go border border-go/20"
                    }`}
                  >
                    {missionMessage}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isFetchingMission}
                      onClick={handleFetchMission}
                      className="inline-flex items-center gap-1.5 rounded-inset border border-rule bg-white px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-paper-sunk disabled:opacity-50"
                      title={activeWebsite ? `Fetch mission from ${activeWebsite}` : "Add website first"}
                    >
                      <span>⚡</span>
                      <span>{isFetchingMission ? "Reading website..." : "Fetch from website"}</span>
                    </button>

                    {websiteHref && (
                      <a
                        href={websiteHref}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-inset border border-rule bg-white px-2.5 py-1.5 text-xs font-semibold text-lead hover:underline"
                      >
                        <span>Visit website</span>
                        <span aria-hidden="true">↗</span>
                      </a>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {record.hasMission && (
                      <button
                        type="button"
                        onClick={() => {
                          setMissionInput(record.mission ?? "");
                          setIsEditingMission(false);
                          setMissionMessage(null);
                        }}
                        className="rounded-inset px-2.5 py-1.5 text-xs font-medium text-dim hover:text-ink"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={isSavingMission || !missionInput.trim()}
                      onClick={handleSaveMission}
                      className="rounded-inset bg-lead px-3.5 py-1.5 text-xs font-semibold text-paper hover:bg-lead-mid disabled:opacity-50"
                    >
                      {isSavingMission ? "Saving..." : "Save mission"}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <span className="text-xs text-faint italic">No mission statement on file</span>
                <p className="text-[11px] text-dim italic">{VIEW_ONLY_CONTROL_NOTE}</p>
              </div>
            )}
          </div>
        </div>

        {/* Contact Email Column */}
        <div className="sm:col-span-2 rounded-inset bg-paper p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-dim">
              Contact Email
            </span>
            {canEdit && !isEditingEmail && (
              <button
                type="button"
                onClick={() => setIsEditingEmail(true)}
                className="text-xs font-semibold text-lead hover:underline"
              >
                Change
              </button>
            )}
          </div>

          <div className="mt-2">
            {!isEditingEmail && record.hasEmail ? (
              <div className="flex items-center gap-2">
                <a
                  href={`mailto:${record.contact_email}`}
                  className="inline-flex items-center gap-1 rounded-inset border border-rule bg-white px-2.5 py-1 text-xs font-semibold text-lead hover:underline"
                >
                  <span>{record.contact_email}</span>
                </a>
                {emailMessage && (
                  <span className="text-xs font-semibold text-go">{emailMessage}</span>
                )}
              </div>
            ) : canEdit ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    placeholder="contact@example.org"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="w-full max-w-md rounded-inset border border-rule bg-white px-2.5 py-1.5 text-xs text-ink placeholder:text-dim/60 focus:border-lead focus:outline-none focus:ring-1 focus:ring-lead"
                  />

                  <button
                    type="button"
                    disabled={isSavingEmail || !emailInput.trim()}
                    onClick={handleSaveEmail}
                    className="shrink-0 rounded-inset bg-lead px-3 py-1.5 text-xs font-semibold text-paper hover:bg-lead-mid disabled:opacity-50"
                  >
                    {isSavingEmail ? "Saving..." : "Save email"}
                  </button>
                </div>

                {emailMessage && (
                  <p className="text-xs font-medium text-dim">{emailMessage}</p>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                <span className="text-xs text-faint italic">No contact email recorded</span>
                <p className="text-[11px] text-dim italic">{VIEW_ONLY_CONTROL_NOTE}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
