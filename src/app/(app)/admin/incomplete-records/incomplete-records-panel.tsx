"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Pill } from "@/app/(app)/clients/[id]/section-card";
import { VIEW_ONLY_CONTROL_NOTE } from "@/lib/auth/view-only";
import { adminDirectEditsAction } from "@/app/(app)/clients/[id]/admin-actions";
import { readMissionFromWebsiteAction } from "@/app/(app)/clients/[id]/mission-actions";
import {
  readSectorFromWebsiteAction,
  type SectorLookupState,
} from "@/app/(app)/clients/[id]/sector-actions";
import { SECTOR_CATEGORY_GROUPS } from "@/app/settings/outreach-preferences/constants";
import {
  SUGGESTED_LOCAL_AUTHORITIES,
  UK_REGIONAL_GROUPS,
} from "@/lib/charity-register/vocabulary";
import { displayPlaceName } from "@/lib/place-name";
import { looksLikePostcode, MIN_PLACE_SEARCH_LENGTH } from "@/lib/postcode-lookup";
import {
  lookupPostcodePlacesAction,
  searchPlacesByNameAction,
} from "./postcode-actions";
import { formatLocation, formatOrganisationType } from "@/lib/organisation-format";
import { PaginatedList } from "@/components/ui/paginated-list";
import { useToast } from "@/components/ui/toast";
import {
  SearchableSelect,
  type SearchableOptionGroup,
} from "@/components/ui/searchable-select";
import type { FilterTab, IncompleteClientRecord } from "./types";

/** The "proposed" arm of a website sector lookup — the only one the card holds. */
type SectorProposal = Extract<SectorLookupState, { kind: "proposed" }>;

/**
 * The sector picker's options ARE the app's taxonomy, not a shorter list of its
 * own.
 *
 * This card used to offer seven invented headings ("Poverty & hardship",
 * "Community & youth", "Arts, culture & sport"...). They looked right and
 * saved cleanly, but nothing else in the app knew those words: the scorer
 * matches against F197's taxonomy (`SECTOR_CATEGORY_GROUPS`) and so do CAM
 * sector preferences and the client-list filters. Three of the seven matched
 * nothing, so an admin closed the gap, the card said Saved, and the client went
 * on scoring a neutral 0.5 as though it still had no sector — invisible from
 * this screen. Offering the real taxonomy, grouped the way settings groups it,
 * makes a wrong answer impossible rather than merely rejected.
 */
/**
 * The location picker's places, from the same local-authority vocabulary the
 * outreach-preference places picker and the charity-import filters use
 * (`UK_REGIONAL_GROUPS`, the Charity Commission's 174 authorities), grouped by
 * region and led by the four the branch actually works in.
 *
 * Two things are reconciled here. The register names councils — "Sheffield
 * City", "City Of York" — while ORGANISATIONS.city holds the plain town every
 * record already uses ("Sheffield", "York"), so each option is stored through
 * `displayPlaceName`, the write-side twin of the `normalisePlaceName` the
 * scorer compares with. And the council list is a good list, not a complete
 * one: a client can sit in Worksop or Chesterfield, which are not authorities,
 * so the picker still takes a typed place as its last row rather than refusing
 * a real town.
 *
 * The council's own spelling rides along as a search keyword, so typing
 * "Sheffield City" finds Sheffield.
 */
const PLACE_SELECT_GROUPS: SearchableOptionGroup[] = (() => {
  const seen = new Set<string>();
  const optionFor = (authority: string) => ({
    value: displayPlaceName(authority),
    label: displayPlaceName(authority),
    keywords: [authority],
  });

  const suggested = {
    label: "Where the branch works",
    options: SUGGESTED_LOCAL_AUTHORITIES.map(optionFor),
  };
  for (const option of suggested.options) seen.add(option.value);

  const regions = UK_REGIONAL_GROUPS.map((group) => ({
    label: group.name,
    // An authority can belong to a region and one of its sub-regions; it is
    // offered once, where it is first reached, so the arrow keys never land on
    // the same place twice.
    options: group.authorities
      .map(optionFor)
      .filter((option) => {
        if (seen.has(option.value)) return false;
        seen.add(option.value);
        return true;
      }),
  })).filter((group) => group.options.length > 0);

  return [suggested, ...regions];
})();

const SECTOR_SELECT_GROUPS: SearchableOptionGroup[] = SECTOR_CATEGORY_GROUPS.map((group) => ({
  label: group.category,
  options: group.presets.map((preset) => ({ value: preset, label: preset })),
}));

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
 * Which gap the card puts in front of the admin first when a record has
 * several — ordered by what the gap *blocks*, not by how the record reads:
 *
 *   email    nothing can be sent to this client at all without it
 *   website  where the mission (and usually the address) is found, so filling
 *            it unblocks the two below
 *   mission  what outreach emails and booklets are written from
 *   sector   drives priority scoring and the filters CAMs search by
 *   location the same, one factor down
 *
 * One list, so every card agrees on what "first" means. Change the order here
 * and the whole screen follows.
 */
const FIX_ORDER = ["email", "website", "mission", "sector", "city"] as const;

type FieldKey = (typeof FIX_ORDER)[number];

/** Whether the record already holds each field, keyed the same as FIX_ORDER. */
function heldFields(record: IncompleteClientRecord): Record<FieldKey, boolean> {
  return {
    email: record.hasEmail,
    website: record.hasWebsite,
    mission: record.hasMission,
    sector: record.hasSector,
    city: record.hasCity,
  };
}

/** What each gap costs, in the words of the job. Shown where the gap is. */
const WHY_IT_MATTERS: Record<FieldKey, string> = {
  email:
    "Outreach has nowhere to go without this — it is the address emails to this client are sent to.",
  website:
    "The website is where a mission statement usually comes from, and often the contact address too.",
  mission: "Outreach emails and client booklets are written from the mission.",
  sector: "Sector drives priority scoring and the filters CAMs search the client list by.",
  city: "Location feeds priority scoring, and CAMs filtering by place never see a client without it.",
};

/**
 * What the toast says. It names the client, because the screen is a list of
 * cards and a bare "Saved" leaves the reader checking which one it meant — and
 * it names the detail, because a card is often three saves in a row.
 */
function savedMessage(label: string, client: string): string {
  return `${label} saved for ${client}`;
}

function failedMessage(label: string, client: string): string {
  return `${label} could not be saved for ${client}`;
}

const FIELD_LABEL: Record<FieldKey, string> = {
  email: "Contact email",
  website: "Website",
  mission: "Mission statement",
  sector: "Sector",
  city: "Location",
};

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

/**
 * One record, worked from the top down.
 *
 * The card used to print the same five fields in the same order on every
 * record, each missing one opened for editing at once — so the admin arrived
 * at a wall of five open inputs and had to work out for themselves which one
 * mattered. It now reads as one job:
 *
 *   1. who this is — the name, large, with what it is and where;
 *   2. **the gap to close first**, chosen by FIX_ORDER, alone in a panel with
 *      its editor already open and one line saying what it costs;
 *   3. anything else missing, listed but closed, each a click from its editor;
 *   4. the details already on file, underneath, readable and still editable.
 *
 * Saving the first gap promotes the next one into the panel, so a record with
 * three holes is three saves without ever choosing what to do next.
 */
function ClientCleaningCard({
  record,
  canEdit,
  onUpdate,
}: {
  record: IncompleteClientRecord;
  canEdit: boolean;
  onUpdate: (updated: Partial<IncompleteClientRecord> & { id: string }) => void;
}) {
  const { showToast } = useToast();

  // The gap this card opens on. Read once, from the record as it arrived, so
  // the editors below can start open on it — the live ordering is recomputed
  // every render further down.
  const openingGap = FIX_ORDER.find((key) => !heldFields(record)[key]) ?? null;

  // Sector state
  const [sectorInput, setSectorInput] = useState(
    record.sector && record.sector.toLowerCase() !== "unclassified" ? record.sector : "",
  );
  const [isEditingSector, setIsEditingSector] = useState(openingGap === "sector");
  const [isSavingSector, startSectorTransition] = useTransition();
  const [sectorMessage, setSectorMessage] = useState<string | null>(null);
  // What the website said, when the admin asked it. Held separately from
  // `sectorMessage` (which reports the save) so a proposal and a save error
  // never overwrite each other.
  const [isReadingSector, setIsReadingSector] = useState(false);
  const [sectorProposal, setSectorProposal] = useState<SectorProposal | null>(null);
  const [sectorLookupNote, setSectorLookupNote] = useState<string | null>(null);

  // Website state
  const [websiteInput, setWebsiteInput] = useState(record.website ?? "");
  const [isEditingWebsite, setIsEditingWebsite] = useState(openingGap === "website");
  const [isSavingWebsite, startWebsiteTransition] = useTransition();
  const [websiteMessage, setWebsiteMessage] = useState<string | null>(null);

  // Mission state
  const [missionInput, setMissionInput] = useState(record.mission ?? "");
  const [isEditingMission, setIsEditingMission] = useState(openingGap === "mission");
  const [isSavingMission, startMissionTransition] = useTransition();
  const [isFetchingMission, setIsFetchingMission] = useState(false);
  const [missionMessage, setMissionMessage] = useState<string | null>(null);
  const [missionStatus, setMissionStatus] = useState<"idle" | "proposed" | "error">("idle");

  // Email state
  const [emailInput, setEmailInput] = useState(record.contact_email ?? "");
  const [isEditingEmail, setIsEditingEmail] = useState(openingGap === "email");
  const [isSavingEmail, startEmailTransition] = useTransition();
  const [emailMessage, setEmailMessage] = useState<string | null>(null);

  // City state
  const [cityInput, setCityInput] = useState(record.city ?? "");
  const [isEditingCity, setIsEditingCity] = useState(openingGap === "city");
  const [isSavingCity, startCityTransition] = useTransition();
  const [cityMessage, setCityMessage] = useState<string | null>(null);
  // What the place picker is being searched for, and the last answer the
  // postcode service gave. Held here rather than inside the picker because
  // answering it is a server round trip, which is not the picker's business.
  //
  // The answer carries the postcode it answers, so "is this still the question
  // being asked" is a comparison at render rather than a second piece of state
  // to keep in step — which is also what keeps this effect free of the
  // synchronous setState the React Compiler rules out.
  const [placeQuery, setPlaceQuery] = useState("");
  const [postcodeAnswer, setPostcodeAnswer] = useState<{
    postcode: string;
    places: string[];
    message: string | null;
  } | null>(null);
  // The same shape for a name search: the answer carries the query it answers.
  const [nameAnswer, setNameAnswer] = useState<{
    query: string;
    places: { name: string; county: string | null }[];
    message: string | null;
  } | null>(null);

  // Opening an editor from the lists below. The "start here" panel needs no
  // entry here: it always shows its field's editor, and a save promotes the
  // next gap into it on the next render.
  const setEditing: Record<FieldKey, (open: boolean) => void> = {
    email: setIsEditingEmail,
    website: setIsEditingWebsite,
    mission: setIsEditingMission,
    sector: setIsEditingSector,
    city: setIsEditingCity,
  };

  const isEditing: Record<FieldKey, boolean> = {
    email: isEditingEmail,
    website: isEditingWebsite,
    mission: isEditingMission,
    sector: isEditingSector,
    city: isEditingCity,
  };

  // Read the sector off the client's own website — a proposal to check, never
  // a write. The words it matched come back with it, so a wrong answer reads as
  // wrong before it is saved rather than after.
  const handleReadSector = async () => {
    const urlToRead = websiteInput.trim() || record.website?.trim();
    if (!urlToRead) {
      setSectorProposal(null);
      setSectorLookupNote("Add a website first, then the sector can be read from it.");
      return;
    }

    setIsReadingSector(true);
    setSectorProposal(null);
    setSectorLookupNote(null);

    try {
      const res = await readSectorFromWebsiteAction({
        organisationId: record.id,
        url: urlToRead,
      });
      if (res.kind === "proposed") {
        setSectorProposal(res);
      } else {
        setSectorLookupNote(res.message);
      }
    } catch {
      setSectorLookupNote("That website could not be read. Pick a sector below instead.");
    } finally {
      setIsReadingSector(false);
    }
  };

  /** The postcode being asked about right now, or null when the search is a name. */
  const askedPostcode = looksLikePostcode(placeQuery)
    ? placeQuery.trim().toUpperCase().replace(/\s+/g, "")
    : null;

  /**
   * Whether what is typed could be a place at all.
   *
   * The picker's last row offers to take the search text as-is, for the towns
   * the council list does not have (Worksop, Chesterfield). A postcode is not
   * one of those: offering "Use S60 1DX" invites an admin to file a postcode in
   * the town field, where nothing reads it — the filters, the scorer and every
   * other record expect a place name. The test is "has a digit in it" rather
   * than "is a valid postcode", because a half-typed postcode is not a valid
   * one and is still not a town: no UK place name contains a digit.
   */
  const searchCouldBeAPlaceName = placeQuery.trim() !== "" && !/\d/.test(placeQuery);

  /**
   * A postcode typed into the place search is answered by the postcode service
   * — "S60" is Rotherham and Sheffield — and the answers are offered at the top
   * of the list like any other option.
   *
   * Debounced, and only for text that is already postcode-shaped, so typing a
   * place name by hand asks nobody anything. The cleanup drops a reply that
   * arrives after the search moved on, which is what keeps a slow answer to
   * "S6" from landing under a search for "S60".
   */
  useEffect(() => {
    if (!askedPostcode) return;

    let live = true;
    const timer = setTimeout(async () => {
      try {
        const res = await lookupPostcodePlacesAction({ query: askedPostcode });
        if (!live) return;
        setPostcodeAnswer(
          res.kind === "places"
            ? { postcode: askedPostcode, places: res.places, message: null }
            : { postcode: askedPostcode, places: [], message: res.message },
        );
      } catch {
        if (!live) return;
        setPostcodeAnswer({
          postcode: askedPostcode,
          places: [],
          message: "The postcode service could not be reached. Search by name instead.",
        });
      }
    }, 350);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [askedPostcode]);

  // Only an answer to the question currently being asked counts.
  const currentAnswer =
    askedPostcode && postcodeAnswer?.postcode === askedPostcode ? postcodeAnswer : null;
  const isLookingUpPostcode = askedPostcode !== null && currentAnswer === null;

  /** The postcode's councils, offered above the list under their own heading. */
  const postcodeGroups = useMemo<SearchableOptionGroup[]>(() => {
    if (!currentAnswer || currentAnswer.places.length === 0) return [];
    return [
      {
        label: `In postcode ${currentAnswer.postcode}`,
        options: currentAnswer.places.map((place) => ({
          value: displayPlaceName(place),
          label: displayPlaceName(place),
        })),
      },
    ];
  }, [currentAnswer]);

  /**
   * A name typed into the place search is looked up too.
   *
   * The council list is the Charity Commission's 174 authorities, and they are
   * the upper tier only — Essex, not Colchester; Kent, not Canterbury. Without
   * this, a postcode found Colchester and its own name did not, which is the
   * kind of inconsistency that makes a screen feel broken. Only asked once the
   * list itself has nothing to offer, so the common places still answer
   * instantly and offline.
   */
  const askedName =
    askedPostcode === null && placeQuery.trim().length >= MIN_PLACE_SEARCH_LENGTH
      ? placeQuery.trim()
      : null;

  const listHasAMatch = useMemo(() => {
    const needle = (askedName ?? "").toLowerCase();
    if (!needle) return true;
    return PLACE_SELECT_GROUPS.some((group) =>
      group.options.some((option) => option.label.toLowerCase().includes(needle)),
    );
  }, [askedName]);

  const nameToLookUp = listHasAMatch ? null : askedName;

  useEffect(() => {
    if (!nameToLookUp) return;

    let live = true;
    const timer = setTimeout(async () => {
      try {
        const res = await searchPlacesByNameAction({ query: nameToLookUp });
        if (!live) return;
        setNameAnswer(
          res.kind === "places"
            ? { query: nameToLookUp, places: res.places, message: null }
            : { query: nameToLookUp, places: [], message: res.message },
        );
      } catch {
        if (!live) return;
        setNameAnswer({
          query: nameToLookUp,
          places: [],
          message: "The place service could not be reached. Type the place instead.",
        });
      }
    }, 350);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [nameToLookUp]);

  const currentNameAnswer =
    nameToLookUp && nameAnswer?.query === nameToLookUp ? nameAnswer : null;
  const isSearchingPlaces = nameToLookUp !== null && currentNameAnswer === null;

  /** Towns and cities the service knows by that name, offered above the list. */
  const namedPlaceGroups = useMemo<SearchableOptionGroup[]>(() => {
    if (!currentNameAnswer || currentNameAnswer.places.length === 0) return [];
    return [
      {
        label: "Towns and cities",
        options: currentNameAnswer.places.map((place) => ({
          // The county is context for the reader — two Newports, one list — and
          // never part of what is written to the record.
          value: place.name,
          label: place.county ? `${place.name} — ${place.county}` : place.name,
          keywords: place.county ? [place.county] : undefined,
        })),
      },
    ];
  }, [currentNameAnswer]);

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
        showToast(savedMessage("Sector", record.legal_name));
        setIsEditingSector(false);
        setSectorProposal(null);
        setSectorLookupNote(null);
        onUpdate({ id: record.id, sector: sectorInput.trim(), hasSector: true });
      } else {
        setSectorMessage(res.message || "Failed to save sector");
        showToast(failedMessage("Sector", record.legal_name), "error");
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
        showToast(savedMessage("Website", record.legal_name));
        setIsEditingWebsite(false);
        onUpdate({ id: record.id, website: websiteInput.trim(), hasWebsite: true });
      } else {
        setWebsiteMessage(res.message || "Failed to save website");
        showToast(failedMessage("Website", record.legal_name), "error");
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
        showToast(savedMessage("Mission statement", record.legal_name));
        setMissionStatus("idle");
        setIsEditingMission(false);
        onUpdate({ id: record.id, mission: missionInput.trim(), hasMission: true });
      } else {
        setMissionMessage(res.message || "Failed to save mission");
        showToast(failedMessage("Mission statement", record.legal_name), "error");
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
        showToast(savedMessage("Contact email", record.legal_name));
        setIsEditingEmail(false);
        onUpdate({ id: record.id, contact_email: emailInput.trim(), hasEmail: true });
      } else {
        setEmailMessage(res.message || "Failed to save email");
        showToast(failedMessage("Contact email", record.legal_name), "error");
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
        showToast(savedMessage("Location", record.legal_name));
        setIsEditingCity(false);
        onUpdate({ id: record.id, city: cityInput.trim(), hasCity: true });
      } else {
        setCityMessage(res.message || "Failed to save location");
        showToast(failedMessage("Location", record.legal_name), "error");
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

  // ── The five editors, each written once and placed by the card below ──
  //
  // A field appears in exactly one of three places — the panel at the top, the
  // "also missing" list, or the details on file — so these are values, not
  // repeated JSX.

  const missionEditor = (
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
            title={activeWebsite ? `Fetch mission from ${activeWebsite}` : "Add website first"}
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
  );

  const sectorEditor = (
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
        <SearchableSelect
          id={sectorId}
          value={sectorInput}
          onChange={setSectorInput}
          groups={SECTOR_SELECT_GROUPS}
          placeholder="Select a sector…"
          searchPlaceholder="Search sectors…"
          emptyMessage="No sector matches that. Try a word the organisation uses about itself."
          unlistedLabel="not in the standard list"
          disabled={isSavingSector}
          ariaLabel="Sector"
          className="min-w-0 flex-1"
        />

        {record.hasSector && (
          <button
            type="button"
            onClick={() => {
              setSectorInput(record.sector ?? "");
              setIsEditingSector(false);
              setSectorMessage(null);
            }}
            className={QUIET_BUTTON}
          >
            Cancel
          </button>
        )}

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

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isReadingSector || isSavingSector}
          onClick={handleReadSector}
          title={activeWebsite ? `Read the sector from ${activeWebsite}` : "Add a website first"}
          className={OUTLINED_BUTTON}
        >
          {isReadingSector && <Loader2 className="size-3.5 animate-spin" />}
          {isReadingSector ? "Reading website…" : "Read from website"}
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

      {sectorLookupNote && (
        <p
          role="status"
          className="rounded-inset bg-paper px-3 py-2.5 text-[13px] leading-[1.55] text-dim"
        >
          {sectorLookupNote}
        </p>
      )}

      {/* What the website said, with the words that earned it. The evidence is
          quoted so a wrong reading ("matched: sport" on a hospice) is visible
          before it is saved, not after it has moved the client's score. */}
      {sectorProposal && (
        <div className="space-y-2 rounded-inset bg-lead-wash px-3 py-2.5">
          <p className="text-[13px] leading-[1.55] text-ink">
            Read from {sectorProposal.hostname}:{" "}
            <span className="font-semibold">{sectorProposal.sector}</span>
            <span className="text-dim"> · {sectorProposal.category}</span>. Matched{" "}
            {sectorProposal.matchedTerms.map((term, index) => (
              <span key={term}>
                {index > 0 && ", "}
                <span className="font-medium">{term}</span>
              </span>
            ))}
            .
          </p>
          <p className="text-[13px] leading-[1.55] text-dim">
            The site says: &ldquo;{sectorProposal.evidence}&rdquo;
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSectorInput(sectorProposal.sector)}
              className={OUTLINED_BUTTON}
            >
              Use this sector
            </button>
            <button
              type="button"
              onClick={() => setSectorProposal(null)}
              className={QUIET_BUTTON}
            >
              Doesn&apos;t fit
            </button>
          </div>
        </div>
      )}

      <p className={FOOTNOTE}>
        Not sure which fits? Read it from the website, or check the sources above — what the
        organisation filed usually makes the closest sector obvious. A wrong guess misplaces
        the client in scoring and filters, so leave it blank rather than force one.
      </p>

      {sectorMessage && (
        <p role="status" className={ERROR_NOTE}>
          {sectorMessage}
        </p>
      )}
    </div>
  );

  const websiteEditor = (
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

        {record.hasWebsite && (
          <button
            type="button"
            onClick={() => {
              setWebsiteInput(record.website ?? "");
              setIsEditingWebsite(false);
              setWebsiteMessage(null);
            }}
            className={QUIET_BUTTON}
          >
            Cancel
          </button>
        )}

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
  );

  const emailEditor = (
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

        {record.hasEmail && (
          <button
            type="button"
            onClick={() => {
              setEmailInput(record.contact_email ?? "");
              setIsEditingEmail(false);
              setEmailMessage(null);
            }}
            className={QUIET_BUTTON}
          >
            Cancel
          </button>
        )}

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

      {emailMessage && (
        <p role="status" className={ERROR_NOTE}>
          {emailMessage}
        </p>
      )}
    </div>
  );

  const cityEditor = (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <SearchableSelect
          id={cityId}
          value={cityInput}
          onChange={setCityInput}
          groups={PLACE_SELECT_GROUPS}
          placeholder="Select a town, city or council area…"
          searchPlaceholder="Search places…"
          emptyMessage="No council area matches that."
          allowCustom={searchCouldBeAPlaceName}
          customGroupLabel="Somewhere else"
          extraGroups={[...postcodeGroups, ...namedPlaceGroups]}
          onQueryChange={setPlaceQuery}
          searchHint={
            isLookingUpPostcode
              ? "Looking that postcode up…"
              : isSearchingPlaces
                ? "Looking that place up…"
                : (currentAnswer?.message ??
                  currentNameAnswer?.message ??
                  "Search by name, or type a postcode — S60 1DX — to find its council.")
          }
          disabled={isSavingCity}
          ariaLabel="Location"
          className="min-w-0 flex-1"
        />

        {record.hasCity && (
          <button
            type="button"
            onClick={() => {
              setCityInput(record.city ?? "");
              setIsEditingCity(false);
              setCityMessage(null);
            }}
            className={QUIET_BUTTON}
          >
            Cancel
          </button>
        )}

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

      {cityMessage && (
        <p role="status" className={ERROR_NOTE}>
          {cityMessage}
        </p>
      )}
    </div>
  );

  const editors: Record<FieldKey, React.ReactNode> = {
    email: emailEditor,
    website: websiteEditor,
    mission: missionEditor,
    sector: sectorEditor,
    city: cityEditor,
  };

  /** The input each field's label points at, so clicking it focuses the editor. */
  const inputIds: Record<FieldKey, string> = {
    email: emailId,
    website: websiteId,
    mission: missionId,
    sector: sectorId,
    city: cityId,
  };

  // ── What is on file, read as a sentence rather than an input ──

  const readings: Record<FieldKey, React.ReactNode> = {
    email: (
      <a
        href={`mailto:${record.contact_email}`}
        className="break-all text-sm font-medium text-lead hover:underline"
      >
        {record.contact_email}
      </a>
    ),
    website: websiteHref ? (
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
    ),
    mission: (
      <p className="rounded-inset bg-paper px-3.5 py-3 text-sm leading-[1.65] text-ink">
        {record.mission}
      </p>
    ),
    sector: (
      <p className="text-sm text-ink">
        {record.sector}
        {record.sub_sector?.trim() && <span className="text-dim"> · {record.sub_sector.trim()}</span>}
      </p>
    ),
    city: <p className="text-sm text-ink">{record.city}</p>,
  };

  const savedNotes: Record<FieldKey, string | null> = {
    email: emailMessage,
    website: websiteMessage,
    mission: missionMessage,
    sector: sectorMessage,
    city: cityMessage,
  };

  // Recomputed every render, so a save moves a field from one list to the
  // other and promotes the next gap without the card being rebuilt.
  const held = heldFields(record);
  const missingKeys = FIX_ORDER.filter((key) => !held[key]);
  const heldKeys = FIX_ORDER.filter((key) => held[key]);
  const [firstGap, ...remainingGaps] = missingKeys;

  return (
    <article className="rounded-panel border border-rule bg-white px-5 py-5 sm:px-6">
      {/* 1 — who this is */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <Link
            href={`/clients/${record.id}`}
            className="font-body text-[21px] font-semibold leading-[1.25] tracking-[-0.015em] text-ink hover:text-lead hover:underline"
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

        <div className="flex shrink-0 flex-wrap items-center gap-2.5">
          {missingKeys.length === 0 ? (
            <Pill tone="go">Complete</Pill>
          ) : (
            <Pill tone="hold">
              {missingKeys.length} of {FIX_ORDER.length} details missing
            </Pill>
          )}
          <Link
            href={`/clients/${record.id}`}
            className="text-[13px] font-medium text-lead hover:underline"
          >
            Open profile
          </Link>
        </div>
      </div>

      {/* 2 — the gap to close first, already open */}
      {firstGap && (
        <section className="mt-4 rounded-inset border border-rule bg-paper px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            {canEdit ? (
              <label
                htmlFor={inputIds[firstGap]}
                className="font-body text-[15px] font-semibold leading-[1.3] text-ink"
              >
                Add the {FIELD_LABEL[firstGap].toLowerCase()}
              </label>
            ) : (
              <h3 className="font-body text-[15px] font-semibold leading-[1.3] text-ink">
                No {FIELD_LABEL[firstGap].toLowerCase()} on file
              </h3>
            )}
            <span className="text-[13px] text-dim">Start here</span>
          </div>
          <p className="mt-1 text-[13px] leading-[1.55] text-dim">{WHY_IT_MATTERS[firstGap]}</p>
          <div className="mt-3">
            {canEdit ? editors[firstGap] : <p className={READ_ONLY_NOTE}>{VIEW_ONLY_CONTROL_NOTE}</p>}
          </div>
        </section>
      )}

      {/* 3 — anything else missing: named, closed, one click from its editor */}
      {remainingGaps.length > 0 && (
        <section className="mt-5">
          <h3 className="text-[13px] font-medium text-dim">Also missing</h3>
          <div className="mt-1">
            {remainingGaps.map((key) => (
              <div key={key} className="border-t border-rule-soft py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  {isEditing[key] && canEdit ? (
                    <label htmlFor={inputIds[key]} className="text-sm font-medium text-ink">
                      {FIELD_LABEL[key]}
                    </label>
                  ) : (
                    <span className="text-sm font-medium text-ink">{FIELD_LABEL[key]}</span>
                  )}
                  {canEdit && !isEditing[key] && (
                    <button
                      type="button"
                      onClick={() => setEditing[key](true)}
                      className={ROW_ACTION}
                    >
                      Add {FIELD_LABEL[key].toLowerCase()}
                    </button>
                  )}
                </div>
                <p className="mt-0.5 text-[13px] leading-[1.55] text-dim">{WHY_IT_MATTERS[key]}</p>
                {canEdit && isEditing[key] && <div className="mt-2.5">{editors[key]}</div>}
              </div>
            ))}
          </div>
          {!canEdit && (
            <p className={`mt-2 ${READ_ONLY_NOTE}`}>{VIEW_ONLY_CONTROL_NOTE}</p>
          )}
        </section>
      )}

      {/* 4 — what the record already holds */}
      {heldKeys.length > 0 && (
        <section className="mt-5">
          <h3 className="text-[13px] font-medium text-dim">On file</h3>
          <div className="mt-1">
            {heldKeys.map((key) => (
              <FieldRow
                key={key}
                label={FIELD_LABEL[key]}
                labelHtmlFor={isEditing[key] && canEdit ? inputIds[key] : undefined}
                action={
                  canEdit && !isEditing[key] ? (
                    <button
                      type="button"
                      onClick={() => setEditing[key](true)}
                      className={ROW_ACTION}
                    >
                      Change
                    </button>
                  ) : undefined
                }
              >
                {isEditing[key] && canEdit ? (
                  editors[key]
                ) : (
                  <div className="space-y-1.5">
                    {readings[key]}
                    {savedNotes[key] && (
                      <p role="status" className={SAVED_NOTE}>
                        {savedNotes[key]}
                      </p>
                    )}
                  </div>
                )}
              </FieldRow>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
