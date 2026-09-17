"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Pill } from "@/app/(app)/clients/[id]/section-card";
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

/**
 * Filed Record voice (`docs/app-design-system.md`), following the settings
 * screens: the card and its action zone follow
 * `admin/charity-commission/annual-return-card.tsx`, controls follow
 * `app/settings/styles.ts`. Class strings are repeated here rather than
 * imported from settings so this workspace stays self-contained.
 */
const INPUT =
  "h-10 w-full rounded-inset border border-rule bg-white px-3 text-sm text-ink outline-none placeholder:text-faint focus-visible:border-lead focus-visible:ring-2 focus-visible:ring-lead/20 disabled:opacity-50";

const TEXTAREA =
  "min-h-24 w-full rounded-inset border border-rule bg-white px-3 py-2.5 text-sm leading-[1.65] text-ink outline-none placeholder:text-faint focus-visible:border-lead focus-visible:ring-2 focus-visible:ring-lead/20 disabled:opacity-50";

const PRIMARY_BUTTON =
  "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-inset border border-lead bg-lead px-2.5 py-1 text-[13px] font-medium text-white transition-colors hover:bg-lead-mid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30 disabled:pointer-events-none disabled:opacity-50";

const QUIET_BUTTON =
  "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-inset px-2.5 py-1 text-[13px] font-medium text-dim transition-colors hover:bg-paper hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30 disabled:pointer-events-none disabled:opacity-50";

const OUTLINED_BUTTON =
  "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-inset border border-rule bg-white px-2.5 py-1 text-[13px] font-medium text-ink transition-colors hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30 disabled:pointer-events-none disabled:opacity-50";

/** The in-row "Edit" / "Change" link — lead, because it is a link-weight action. */
const ROW_ACTION =
  "cursor-pointer rounded-inset px-2 py-0.5 text-[13px] font-medium text-lead transition-colors hover:bg-lead-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30";

const SAVED_NOTE = "text-[13px] font-medium text-go";
const ERROR_NOTE = "text-[13px] font-medium text-stop";
const FOOTNOTE = "text-[13px] leading-[1.55] text-dim";
const READ_ONLY_NOTE = "text-[13px] text-dim";

const TABS: { value: FilterTab; label: string; missing: string }[] = [
  { value: "all", label: "All", missing: "all incomplete records" },
  { value: "mission", label: "Mission", missing: "records missing a mission statement" },
  { value: "sector", label: "Sector", missing: "records missing a sector" },
  { value: "website", label: "Website", missing: "records missing a website" },
  { value: "email", label: "Email", missing: "records missing a contact email" },
  { value: "city", label: "Location", missing: "records missing a location" },
];

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

  const counts: Record<FilterTab, number> = {
    all: records.filter((r) => r.isIncomplete).length,
    mission: records.filter((r) => !r.hasMission).length,
    sector: records.filter((r) => !r.hasSector).length,
    website: records.filter((r) => !r.hasWebsite).length,
    email: records.filter((r) => !r.hasEmail).length,
    city: records.filter((r) => !r.hasCity).length,
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
      case "city":
        return !record.hasCity;
      default:
        return true;
    }
  });

  const handleUpdateRecord = (updated: Partial<IncompleteClientRecord> & { id: string }) => {
    setRecords((prev) =>
      prev.map((item) => {
        if (item.id !== updated.id) return item;
        const merged = { ...item, ...updated };
        const isIncomplete =
          !merged.hasSector ||
          !merged.hasMission ||
          !merged.hasWebsite ||
          !merged.hasEmail ||
          !merged.hasCity;
        return { ...merged, isIncomplete };
      }),
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <nav aria-label="Incomplete records filters" className="flex flex-wrap items-center gap-1.5">
          {TABS.map((tab) => {
            const active = activeTab === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setActiveTab(tab.value)}
                aria-pressed={active}
                aria-label={`Show ${tab.missing}`}
                className={`rounded-full px-3.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30 ${
                  active
                    ? "bg-lead font-semibold text-white"
                    : "font-semibold text-dim hover:bg-paper hover:text-ink"
                }`}
              >
                {tab.label}{" "}
                <span className={`tabular-nums ${active ? "text-white/75" : "text-faint"}`}>
                  {counts[tab.value].toLocaleString()}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="w-full lg:w-72">
          <label htmlFor="incomplete-search" className="sr-only">
            Search incomplete clients
          </label>
          <input
            id="incomplete-search"
            type="search"
            placeholder="Search by client name or city…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={INPUT}
          />
        </div>
      </div>

      {filteredRecords.length === 0 ? (
        <div className="rounded-panel border border-rule bg-white px-5 py-10 text-center sm:px-6">
          <p className="font-body text-[19px] leading-[1.3] font-normal tracking-[-0.01em] text-ink">
            All records complete
          </p>
          <p className="mt-1.5 text-[13px] leading-[1.55] text-dim">
            {searchQuery
              ? "No client records matched your search."
              : activeTab === "all"
                ? "No client records are currently missing a mission statement, sector, website, email, or location."
                : `No client records are currently ${TABS.find((tab) => tab.value === activeTab)?.missing ?? "incomplete"}.`}
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

/**
 * One field inside a card: the settings row shape — label and action on a
 * shared baseline, content underneath — with the label wired to the editor's
 * input wherever one is open.
 */
function FieldRow({
  label,
  labelHtmlFor,
  action,
  children,
}: {
  label: string;
  labelHtmlFor?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-rule-soft py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1">
        {labelHtmlFor ? (
          <label htmlFor={labelHtmlFor} className="text-[13px] font-medium text-dim">
            {label}
          </label>
        ) : (
          <span className="text-[13px] font-medium text-dim">{label}</span>
        )}
        {action}
      </div>
      <div className="mt-2.5">{children}</div>
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

  // City state
  const [cityInput, setCityInput] = useState(record.city ?? "");
  const [isEditingCity, setIsEditingCity] = useState(!record.hasCity);
  const [isSavingCity, startCityTransition] = useTransition();
  const [cityMessage, setCityMessage] = useState<string | null>(null);

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

  // Save City — also refreshes the priority score, since geography is a
  // scoring factor (handled inside adminDirectEditsAction).
  const handleSaveCity = () => {
    if (!cityInput.trim()) return;
    setCityMessage(null);
    startCityTransition(async () => {
      const res = await adminDirectEditsAction({
        organisationId: record.id,
        changes: [{ fieldName: "city", value: cityInput.trim() }],
      });
      if (res.kind === "success") {
        setCityMessage("Saved");
        setIsEditingCity(false);
        onUpdate({ id: record.id, city: cityInput.trim(), hasCity: true });
      } else {
        setCityMessage(res.message || "Failed to save location");
      }
    });
  };

  const activeWebsite = (websiteInput.trim() || record.website?.trim()) ?? "";
  const websiteHref = activeWebsite
    ? activeWebsite.startsWith("http://") || activeWebsite.startsWith("https://")
      ? activeWebsite
      : `https://${activeWebsite}`
    : null;

  // Where this record came from, for checking a gap at its origin rather than
  // guessing. Links only — readings, so viewers see them too.
  const charityDigits = record.charity_number?.replace(/\D/g, "") || null;
  const charityRegisterHref = charityDigits
    ? `https://register-of-charities.charitycommission.gov.uk/en/charity-search/-/charity-details/${charityDigits}`
    : null;
  const companyNumber = record.company_number?.trim() || null;
  const companiesHouseHref = companyNumber
    ? `https://find-and-update.company-information.service.gov.uk/company/${companyNumber}`
    : null;
  const sourceLinks = [
    charityRegisterHref && { href: charityRegisterHref, label: "Charity Commission register" },
    companiesHouseHref && { href: companiesHouseHref, label: "Companies House" },
    websiteHref && { href: websiteHref, label: "Website" },
  ].filter((link): link is { href: string; label: string } => Boolean(link));

  const sectorId = `incomplete-sector-${record.id}`;
  const websiteId = `incomplete-website-${record.id}`;
  const missionId = `incomplete-mission-${record.id}`;
  const emailId = `incomplete-email-${record.id}`;
  const cityId = `incomplete-city-${record.id}`;

  return (
    <article className="rounded-panel border border-rule bg-white px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <Link
            href={`/clients/${record.id}`}
            className="font-body text-[18px] font-semibold leading-[1.3] tracking-[-0.01em] text-ink hover:text-lead hover:underline"
          >
            {record.legal_name}
          </Link>
          <p className="mt-1 text-[13.5px] text-dim">
            {formatOrganisationType(record.organisation_type)} · {formatLocation(record)}
          </p>
          {sourceLinks.length > 0 && (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-dim">
              <span>Check the source:</span>
              {sourceLinks.map((link, index) => (
                <span key={link.href} className="flex items-center gap-x-2">
                  {index > 0 && (
                    <span aria-hidden="true" className="text-faint">
                      ·
                    </span>
                  )}
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-lead hover:underline"
                  >
                    {link.label}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </span>
              ))}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {!record.hasMission && <Pill tone="hold">Missing mission</Pill>}
          {!record.hasSector && <Pill tone="hold">Missing sector</Pill>}
          {!record.hasWebsite && <Pill tone="hold">Missing website</Pill>}
          {!record.hasEmail && <Pill tone="hold">Missing email</Pill>}
          {!record.hasCity && <Pill tone="hold">Missing location</Pill>}
          {!record.isIncomplete && <Pill tone="go">Complete</Pill>}
          <Link
            href={`/clients/${record.id}`}
            className="ml-1 text-[13px] font-medium text-lead hover:underline"
          >
            Open profile
          </Link>
        </div>
      </div>

      <div className="mt-2">
        <FieldRow
          label="Mission statement"
          labelHtmlFor={isEditingMission && canEdit ? missionId : undefined}
          action={
            canEdit && !isEditingMission ? (
              <button type="button" onClick={() => setIsEditingMission(true)} className={ROW_ACTION}>
                Edit
              </button>
            ) : undefined
          }
        >
          {!isEditingMission && record.hasMission ? (
            <div className="space-y-1.5">
              <p className="rounded-inset bg-paper px-3.5 py-3 text-sm leading-[1.65] text-ink">
                {record.mission}
              </p>
              {missionMessage && (
                <p role="status" className={SAVED_NOTE}>
                  {missionMessage}
                </p>
              )}
            </div>
          ) : canEdit ? (
            <div className="space-y-2.5">
              <textarea
                id={missionId}
                rows={3}
                placeholder="Enter or paste the organisation's mission statement…"
                value={missionInput}
                onChange={(e) => setMissionInput(e.target.value)}
                disabled={isSavingMission}
                className={TEXTAREA}
              />

              {missionMessage &&
                (missionStatus === "idle" ? (
                  <p role="status" className={SAVED_NOTE}>
                    {missionMessage}
                  </p>
                ) : (
                  <p
                    role="status"
                    className={`rounded-inset px-3 py-2.5 text-[13px] leading-[1.55] ${
                      missionStatus === "error" ? "bg-stop-wash text-stop" : "bg-lead-wash text-ink"
                    }`}
                  >
                    {missionMessage}
                  </p>
                ))}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isFetchingMission || isSavingMission}
                    onClick={handleFetchMission}
                    title={
                      activeWebsite ? `Fetch mission from ${activeWebsite}` : "Add website first"
                    }
                    className={OUTLINED_BUTTON}
                  >
                    {isFetchingMission && <Loader2 className="size-3.5 animate-spin" />}
                    {isFetchingMission ? "Reading website…" : "Fetch from website"}
                  </button>

                  {websiteHref && (
                    <a
                      href={websiteHref}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[13px] font-medium text-lead hover:underline"
                    >
                      Visit website
                      <span className="sr-only"> (opens in a new tab)</span>
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
                      className={QUIET_BUTTON}
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isSavingMission || !missionInput.trim()}
                    aria-busy={isSavingMission || undefined}
                    onClick={handleSaveMission}
                    className={PRIMARY_BUTTON}
                  >
                    {isSavingMission && <Loader2 className="size-3.5 animate-spin" />}
                    {isSavingMission ? "Saving…" : "Save mission"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <p className={READ_ONLY_NOTE}>No mission statement on file.</p>
              <p className={READ_ONLY_NOTE}>{VIEW_ONLY_CONTROL_NOTE}</p>
            </div>
          )}
        </FieldRow>

        <FieldRow
          label="Sector"
          labelHtmlFor={isEditingSector && canEdit ? sectorId : undefined}
          action={
            canEdit && !isEditingSector ? (
              <button type="button" onClick={() => setIsEditingSector(true)} className={ROW_ACTION}>
                Change
              </button>
            ) : undefined
          }
        >
          {!isEditingSector && record.hasSector ? (
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <p className="text-sm text-ink">
                {record.sector}
                {record.sub_sector?.trim() && (
                  <span className="text-dim"> · {record.sub_sector.trim()}</span>
                )}
              </p>
              {sectorMessage && (
                <p role="status" className={SAVED_NOTE}>
                  {sectorMessage}
                </p>
              )}
            </div>
          ) : canEdit ? (
            <div className="space-y-2.5">
              {record.suggested_sector && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-inset bg-lead-wash px-3 py-2.5">
                  <p className="text-[13px] leading-[1.55] text-ink">
                    Suggested from this record&apos;s details:{" "}
                    <span className="font-semibold">{record.suggested_sector}</span>
                    {record.suggested_sub_sector && (
                      <span className="text-dim"> · {record.suggested_sub_sector}</span>
                    )}
                    . Check it before applying.
                  </p>
                  <button
                    type="button"
                    onClick={() => setSectorInput(record.suggested_sector ?? "")}
                    className={OUTLINED_BUTTON}
                  >
                    Use suggestion
                  </button>
                </div>
              )}

              <div className="flex items-center gap-2">
                <select
                  id={sectorId}
                  value={sectorInput}
                  onChange={(e) => setSectorInput(e.target.value)}
                  disabled={isSavingSector}
                  className={`${INPUT} cursor-pointer`}
                >
                  <option value="">Select a sector…</option>
                  {CANONICAL_SECTORS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  {/* A suggestion (or an older free-text sector) may sit outside
                      the seven common picks. Render it so the select can show
                      what is actually chosen rather than going blank. */}
                  {sectorInput &&
                    !(CANONICAL_SECTORS as readonly string[]).includes(sectorInput) && (
                      <option value={sectorInput}>{sectorInput}</option>
                    )}
                </select>

                <button
                  type="button"
                  disabled={isSavingSector || !sectorInput.trim()}
                  aria-busy={isSavingSector || undefined}
                  onClick={handleSaveSector}
                  className={PRIMARY_BUTTON}
                >
                  {isSavingSector && <Loader2 className="size-3.5 animate-spin" />}
                  {isSavingSector ? "Saving…" : "Save sector"}
                </button>
              </div>

              <p className={FOOTNOTE}>
                Not sure which fits? Check the sources above — what the organisation filed
                usually makes the closest sector obvious. A wrong guess misplaces the client
                in scoring and filters, so leave it blank rather than force one.
              </p>

              {sectorMessage && (
                <p role="status" className={ERROR_NOTE}>
                  {sectorMessage}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <p className={READ_ONLY_NOTE}>No sector recorded.</p>
              {record.suggested_sector && (
                <p className={READ_ONLY_NOTE}>
                  Pipeline suggestion: {record.suggested_sector}
                  {record.suggested_sub_sector && ` · ${record.suggested_sub_sector}`}.
                </p>
              )}
              <p className={READ_ONLY_NOTE}>{VIEW_ONLY_CONTROL_NOTE}</p>
            </div>
          )}
        </FieldRow>

        <FieldRow
          label="Website"
          labelHtmlFor={isEditingWebsite && canEdit ? websiteId : undefined}
          action={
            canEdit && !isEditingWebsite ? (
              <button
                type="button"
                onClick={() => setIsEditingWebsite(true)}
                className={ROW_ACTION}
              >
                Change
              </button>
            ) : undefined
          }
        >
          {!isEditingWebsite && record.hasWebsite ? (
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              {websiteHref ? (
                <a
                  href={websiteHref}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-sm font-medium text-lead hover:underline"
                >
                  {record.website}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                <p className="text-sm text-ink">{record.website}</p>
              )}
              {websiteMessage && (
                <p role="status" className={SAVED_NOTE}>
                  {websiteMessage}
                </p>
              )}
            </div>
          ) : canEdit ? (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2">
                <input
                  id={websiteId}
                  type="url"
                  placeholder="https://example.org"
                  value={websiteInput}
                  onChange={(e) => setWebsiteInput(e.target.value)}
                  disabled={isSavingWebsite}
                  className={INPUT}
                />

                <button
                  type="button"
                  disabled={isSavingWebsite || !websiteInput.trim()}
                  aria-busy={isSavingWebsite || undefined}
                  onClick={handleSaveWebsite}
                  className={PRIMARY_BUTTON}
                >
                  {isSavingWebsite && <Loader2 className="size-3.5 animate-spin" />}
                  {isSavingWebsite ? "Saving…" : "Save website"}
                </button>
              </div>

              {websiteMessage && (
                <p role="status" className={ERROR_NOTE}>
                  {websiteMessage}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <p className={READ_ONLY_NOTE}>No website recorded.</p>
              <p className={READ_ONLY_NOTE}>{VIEW_ONLY_CONTROL_NOTE}</p>
            </div>
          )}
        </FieldRow>

        <FieldRow
          label="Contact email"
          labelHtmlFor={isEditingEmail && canEdit ? emailId : undefined}
          action={
            canEdit && !isEditingEmail ? (
              <button type="button" onClick={() => setIsEditingEmail(true)} className={ROW_ACTION}>
                Change
              </button>
            ) : undefined
          }
        >
          {!isEditingEmail && record.hasEmail ? (
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <a
                href={`mailto:${record.contact_email}`}
                className="break-all text-sm font-medium text-lead hover:underline"
              >
                {record.contact_email}
              </a>
              {emailMessage && (
                <p role="status" className={SAVED_NOTE}>
                  {emailMessage}
                </p>
              )}
            </div>
          ) : canEdit ? (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2">
                <input
                  id={emailId}
                  type="email"
                  placeholder="contact@example.org"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  disabled={isSavingEmail}
                  className={INPUT}
                />

                <button
                  type="button"
                  disabled={isSavingEmail || !emailInput.trim()}
                  aria-busy={isSavingEmail || undefined}
                  onClick={handleSaveEmail}
                  className={PRIMARY_BUTTON}
                >
                  {isSavingEmail && <Loader2 className="size-3.5 animate-spin" />}
                  {isSavingEmail ? "Saving…" : "Save email"}
                </button>
              </div>

              <p className={FOOTNOTE}>
                Without an email nothing can be sent to this client — this is the address
                outreach goes to.
              </p>

              {emailMessage && (
                <p role="status" className={ERROR_NOTE}>
                  {emailMessage}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <p className={READ_ONLY_NOTE}>No contact email recorded.</p>
              <p className={READ_ONLY_NOTE}>{VIEW_ONLY_CONTROL_NOTE}</p>
            </div>
          )}
        </FieldRow>

        <FieldRow
          label="Location"
          labelHtmlFor={isEditingCity && canEdit ? cityId : undefined}
          action={
            canEdit && !isEditingCity ? (
              <button type="button" onClick={() => setIsEditingCity(true)} className={ROW_ACTION}>
                Change
              </button>
            ) : undefined
          }
        >
          {!isEditingCity && record.hasCity ? (
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <p className="text-sm text-ink">{record.city}</p>
              {cityMessage && (
                <p role="status" className={SAVED_NOTE}>
                  {cityMessage}
                </p>
              )}
            </div>
          ) : canEdit ? (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2">
                <input
                  id={cityId}
                  type="text"
                  placeholder="Sheffield"
                  value={cityInput}
                  onChange={(e) => setCityInput(e.target.value)}
                  disabled={isSavingCity}
                  className={INPUT}
                />

                <button
                  type="button"
                  disabled={isSavingCity || !cityInput.trim()}
                  aria-busy={isSavingCity || undefined}
                  onClick={handleSaveCity}
                  className={PRIMARY_BUTTON}
                >
                  {isSavingCity && <Loader2 className="size-3.5 animate-spin" />}
                  {isSavingCity ? "Saving…" : "Save location"}
                </button>
              </div>

              <p className={FOOTNOTE}>
                The city feeds priority scoring and the city filters — without it the client
                sits at neutral and CAMs filtering by place never see it.
              </p>

              {cityMessage && (
                <p role="status" className={ERROR_NOTE}>
                  {cityMessage}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <p className={READ_ONLY_NOTE}>No location recorded.</p>
              <p className={READ_ONLY_NOTE}>{VIEW_ONLY_CONTROL_NOTE}</p>
            </div>
          )}
        </FieldRow>
      </div>
    </article>
  );
}
