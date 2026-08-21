export type OrganisationSourceRow = {
  source: string;
  source_record_id: string | null;
  source_registry_name: string | null;
  first_seen_at: string;
  source_actor_user_id?: string | null;
  source_actor_name?: string | null;
};

export type OrganisationSource = OrganisationSourceRow & {
  label: string;
};

const SOURCE_LABELS: Readonly<Record<string, string>> = {
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

/** Row shape of `get_organisation_import_origin` (F037 AC8/AC12). */
export type ImportOriginRow = {
  source_url: string | null;
  imported_field_paths: unknown;
  imported_at: string | null;
};

export type ImportOrigin = {
  sourceUrl: string;
  /**
   * Passed through for future use, never required: nothing renders it yet, so a
   * missing or unparseable timestamp must not throw away the source URL and
   * field list the CAM does read.
   */
  importedAt: string | null;
  fieldLabels: string[];
};

// manual_entry_records columns F037's import can populate, in the order a CAM
// reads the client profile — matches BasicInfoPanel's field order where the two
// overlap, so a field means the same thing here as it does there.
const IMPORT_FIELD_LABELS: Readonly<Record<string, string>> = {
  legal_name: "Name",
  mission_statement: "Mission",
  organisation_type: "Type",
  contact_email: "Email",
  address_line_1: "Address",
  city: "City",
  postcode: "Postcode",
  country_code: "Country",
  website: "Website",
  registry_name: "Registry name",
  registry_number: "Registry number",
};

/**
 * F044/F069 AC3: which fields on this record came from the source URL, not just
 * that a source URL exists. `row` is null when the organisation was never built
 * from a URL import — every field is either hand-typed or came from an API match,
 * both already covered by `formatOrganisationSources`.
 */
export function formatImportOrigin(row: ImportOriginRow | null | undefined): ImportOrigin | null {
  if (!row) return null;
  const sourceUrl = row.source_url?.trim();
  if (!sourceUrl) return null;

  const paths = Array.isArray(row.imported_field_paths)
    ? row.imported_field_paths.filter((path): path is string => typeof path === "string")
    : [];

  return {
    sourceUrl,
    importedAt: row.imported_at,
    fieldLabels: paths.map((path) => IMPORT_FIELD_LABELS[path] ?? path),
  };
}
