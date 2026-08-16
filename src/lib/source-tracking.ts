export type OrganisationSourceRow = {
  source: string;
  source_record_id: string | null;
  source_registry_name: string | null;
  first_seen_at: string;
};

export type OrganisationSource = OrganisationSourceRow & {
  label: string;
};

// Exported so field-sources.ts (F044) can label the same source values without
// a second, potentially-drifting copy of this map.
export const SOURCE_LABELS: Readonly<Record<string, string>> = {
  charitybase: "CharityBase",
  companies_house: "Companies House",
  charity_commission: "Charity Commission",
  "360giving": "360Giving",
  find_that_charity: "Find That Charity",
  globalgiving: "GlobalGiving",
  candid: "Candid",
  manual: "Manual Entry",
};

/**
 * Converts database source metadata into a stable, human-readable list.
 *
 * The database normally returns one row per contributing source. De-duplicating
 * here is a defensive boundary for old or malformed data: the profile must not
 * show the same source twice, and the oldest link is the trustworthy first-seen
 * timestamp when duplicate rows do occur.
 */
export function formatOrganisationSources(
  rows: readonly OrganisationSourceRow[],
): OrganisationSource[] {
  const bySource = new Map<string, OrganisationSourceRow>();

  for (const row of rows) {
    const source = row.source?.trim().toLowerCase();
    if (!source || !row.first_seen_at || Number.isNaN(Date.parse(row.first_seen_at))) {
      continue;
    }

    const existing = bySource.get(source);
    if (!existing || Date.parse(row.first_seen_at) < Date.parse(existing.first_seen_at)) {
      bySource.set(source, { ...row, source });
    }
  }

  return [...bySource.values()]
    .sort((left, right) => Date.parse(left.first_seen_at) - Date.parse(right.first_seen_at))
    .map((row) => ({
      ...row,
      label: SOURCE_LABELS[row.source] ?? row.source_registry_name?.trim() ?? row.source,
    }));
}
