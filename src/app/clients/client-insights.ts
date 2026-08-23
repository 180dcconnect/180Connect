/**
 * The shaping behind the two panels above the client list: the outreach funnel
 * (how far the whole book of clients has travelled) and the grouped top-N
 * breakdown under it ("clients sorted by city, descending").
 *
 * Pure, and kept out of the route for the same reason visible-clients.ts is —
 * it can be tested under plain `node --test` with no database.
 *
 * The funnel reads the F145 pipeline through the same definitions the dashboard
 * uses (@/lib/dashboard-metrics), not a second interpretation of them: "contacted"
 * has to mean the same thing on both screens or the two disagree in front of a CAM.
 */

import { hasResponded, isContacted, isConverted } from "../../lib/dashboard-metrics.ts";
import { formatOrganisationType } from "../../lib/organisation-format.ts";
import type { VisibleClient } from "./visible-clients.ts";

/** organisation_type → the label the source filter (F051 bar) matches on.
 * Kept for backward compat — new types (cic/cio/ngo/social_enterprise) fall
 * through to formatOrganisationType in the grouping code, but entries here
 * preserve historic source-mapped labels where they still apply. */
export const SOURCE_LABELS: Record<string, string> = {
  company: "Companies House",
  charity: "Charity Commission",
  cio: "CIO",
  cic: "CIC",
  social_enterprise: "Social enterprise",
  ngo: "NGO",
  both: "Dual-registered",
  other: "Other",
};

/* ─── Funnel ───────────────────────────────────────────────────────────── */

export type FunnelStageKey = "all" | "contacted" | "responded" | "converted";

export type FunnelStage = {
  key: FunnelStageKey;
  label: string;
  /** What the stage counts, in one line — the caption under the label. */
  caption: string;
  count: number;
  /** 0–1 of the first stage. Drives the bar width, so the taper is the data. */
  shareOfTotal: number;
  /** 0–1 of the stage above. `null` on the first stage, which has none. */
  shareOfPrevious: number | null;
};

type FunnelRow = Pick<VisibleClient, "outreach_status">;

const STAGE_TESTS: Record<FunnelStageKey, (status: string) => boolean> = {
  all: () => true,
  contacted: isContacted,
  responded: hasResponded,
  converted: isConverted,
};

const STAGE_COPY: Record<FunnelStageKey, { label: string; caption: string }> = {
  all: { label: "In the database", caption: "Every client on the working list" },
  contacted: { label: "Contacted", caption: "Outreach has gone out" },
  responded: { label: "Responded", caption: "They came back to us" },
  converted: { label: "Converted", caption: "Signed as a project" },
};

export const FUNNEL_STAGE_KEYS: FunnelStageKey[] = ["all", "contacted", "responded", "converted"];

/** `?stage=` is user input, so anything unrecognised falls back to the whole book. */
export function parseStage(value: string | null | undefined): FunnelStageKey {
  return FUNNEL_STAGE_KEYS.includes(value as FunnelStageKey) ? (value as FunnelStageKey) : "all";
}

export function clientsInStage<T extends FunnelRow>(clients: T[], stage: FunnelStageKey): T[] {
  const test = STAGE_TESTS[stage];
  return clients.filter((client) => test(client.outreach_status));
}

/**
 * The four stages, widest first. Each share is a fraction rather than a rounded
 * percentage so the caller decides the rounding; an empty book gives every stage
 * a share of 0 rather than a NaN-wide bar.
 */
export function pipelineFunnel(clients: FunnelRow[]): FunnelStage[] {
  const counts = FUNNEL_STAGE_KEYS.map((key) => clientsInStage(clients, key).length);
  const total = counts[0];

  return FUNNEL_STAGE_KEYS.map((key, index) => {
    const previous = index === 0 ? null : counts[index - 1];
    return {
      key,
      ...STAGE_COPY[key],
      count: counts[index],
      shareOfTotal: total === 0 ? 0 : counts[index] / total,
      shareOfPrevious: previous === null ? null : previous === 0 ? 0 : counts[index] / previous,
    };
  });
}

/* ─── Grouped breakdown ────────────────────────────────────────────────── */

export type BreakdownField = "city" | "type" | "status" | "owner";
export type SortDirection = "descending" | "ascending";

export type BreakdownRow = {
  key: string;
  label: string;
  /** The group's count at every funnel stage — the row reads across as a funnel. */
  counts: Record<FunnelStageKey, number>;
  /** The count in the stage the list is ranked by. */
  count: number;
  /** 0–1 of the biggest group in this list, so the leading bar always fills. */
  share: number;
  /**
   * The list filter this group corresponds to, or `null` when the group is not
   * expressible as one (clients with no city). The route turns it into a href —
   * which query parameter names a filter is the page's business, not this file's.
   */
  filter: { param: string; value: string } | null;
};

export const BREAKDOWN_FIELDS: { key: BreakdownField; label: string }[] = [
  { key: "city", label: "city" },
  { key: "type", label: "company type" },
  { key: "status", label: "outreach status" },
  { key: "owner", label: "owner" },
];

export const SORT_DIRECTIONS: SortDirection[] = ["descending", "ascending"];

export function parseField(value: string | null | undefined): BreakdownField {
  return BREAKDOWN_FIELDS.some((field) => field.key === value)
    ? (value as BreakdownField)
    : "city";
}

export function parseDirection(value: string | null | undefined): SortDirection {
  return value === "ascending" ? "ascending" : "descending";
}

export function fieldLabel(field: BreakdownField): string {
  return BREAKDOWN_FIELDS.find((entry) => entry.key === field)?.label ?? field;
}

type Grouped = { key: string; label: string; filter: BreakdownRow["filter"] };

function groupOf(client: VisibleClient, field: BreakdownField): Grouped {
  switch (field) {
    case "city": {
      const city = client.city?.trim();
      // No city is a real group — hiding those rows would make the counts lie —
      // but there is no `?city=` that selects them, so it carries no filter.
      return city
        ? { key: `city:${city.toLowerCase()}`, label: city, filter: { param: "city", value: city } }
        : { key: "city:none", label: "No city recorded", filter: null };
    }
    case "type": {
      // F053: the group's link now carries the stored type, not its label —
      // the filter matches on the enum, so a label here would match nothing.
      const label = formatOrganisationType(client.organisation_type);
      return {
        key: `type:${client.organisation_type}`,
        label,
        filter: { param: "type", value: client.organisation_type },
      };
    }
    case "status":
      return {
        key: `status:${client.outreachStatusLabel}`,
        label: client.outreachStatusLabel,
        // F056: likewise the stored status, not the formatted label.
        filter: { param: "status", value: client.outreach_status },
      };
    case "owner":
      return client.owner_id
        ? {
            key: `owner:${client.owner_id}`,
            label: client.ownerName ?? "A former team member",
            filter: { param: "owner", value: client.owner_id },
          }
        : { key: "owner:none", label: "Unassigned", filter: { param: "owner", value: "unassigned" } };
  }
}

const emptyCounts = (): Record<FunnelStageKey, number> => ({
  all: 0,
  contacted: 0,
  responded: 0,
  converted: 0,
});

/**
 * The top `limit` groups of `clients` by `field`, each carrying its own count at
 * every funnel stage — so a row reads across as that group's funnel, not as one
 * number in isolation.
 *
 * `rankBy` is the stage the top-N is chosen on: rank by "converted" and the table
 * answers "where have we actually landed work", rank by "all" and it answers
 * "where is the database concentrated". "descending" is most-first (the usual
 * reading of a top three); "ascending" is fewest-first, which is the one that
 * answers "where are we thin?". Ties break alphabetically either way, so the
 * order is stable between renders.
 */
export function breakdown(
  clients: VisibleClient[],
  field: BreakdownField,
  direction: SortDirection = "descending",
  rankBy: FunnelStageKey = "all",
  limit = 3,
): BreakdownRow[] {
  const groups = new Map<string, Grouped & { counts: Record<FunnelStageKey, number> }>();

  for (const client of clients) {
    const group = groupOf(client, field);
    let entry = groups.get(group.key);
    if (!entry) {
      entry = { ...group, counts: emptyCounts() };
      groups.set(group.key, entry);
    }
    for (const key of FUNNEL_STAGE_KEYS) {
      if (STAGE_TESTS[key](client.outreach_status)) entry.counts[key] += 1;
    }
  }

  const ranked = [...groups.values()]
    .map((group) => ({ ...group, count: group.counts[rankBy] }))
    .sort((a, b) =>
      direction === "descending"
        ? b.count - a.count || a.label.localeCompare(b.label)
        : a.count - b.count || a.label.localeCompare(b.label),
    )
    .slice(0, limit);

  // The bar is relative to the biggest group *shown*, not to the biggest group
  // overall: on "ascending" every bar would otherwise be a sliver.
  const largest = ranked.reduce((max, group) => Math.max(max, group.count), 0);

  return ranked.map((group) => ({
    key: group.key,
    label: group.label,
    counts: group.counts,
    count: group.count,
    share: largest === 0 ? 0 : group.count / largest,
    filter: group.filter,
  }));
}
