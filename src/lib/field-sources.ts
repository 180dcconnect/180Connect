import { SOURCE_LABELS } from "./source-tracking.ts";

export type FieldSourceRow = {
  field_name: string;
  value: string;
  source: string;
  raw_source_record_id: string | null;
  is_current: boolean;
  recorded_at: string;
};

export type FieldSourceEntry = {
  value: string;
  source: string;
  sourceLabel: string;
  recordedAt: string;
};

export type FieldProvenance = {
  fieldName: string;
  fieldLabel: string;
  /** The value+source currently live on the organisation for this field, if any. */
  current: FieldSourceEntry | null;
  /**
   * Every superseded value+source for this field, newest first — AC2: "both
   * values and their sources are visible, not only the one that happened to be
   * saved."
   */
  history: FieldSourceEntry[];
};

// Same six fields as write-organisations.ts's TRACKED_FIELD_SOURCES and the
// field_sources/field_discrepancies check constraints — kept in this fixed order
// (rather than deriving it from whatever rows happen to come back) so the panel's
// field order doesn't reshuffle between organisations depending on which fields
// happen to have data.
const FIELD_LABELS: Readonly<Record<string, string>> = {
  legal_name: "Legal name",
  website: "Website",
  contact_email: "Contact email",
  address_line_1: "Address",
  city: "City",
  postcode: "Postcode",
};
const FIELD_ORDER = Object.keys(FIELD_LABELS);

function toEntry(row: FieldSourceRow): FieldSourceEntry {
  const source = row.source?.trim().toLowerCase() || row.source;
  return {
    value: row.value,
    source,
    sourceLabel: SOURCE_LABELS[source] ?? row.source,
    recordedAt: row.recorded_at,
  };
}

/**
 * Groups get_field_sources' flat row list into one entry per tracked field —
 * AC1 (current source per field) and AC2 (conflicting values + their sources,
 * not only the saved one) from a single query result. Only returns fields that
 * have at least one recorded row; a field nothing has ever written to (e.g. no
 * source populated postcode) is omitted rather than shown empty.
 */
export function groupFieldSources(rows: readonly FieldSourceRow[]): FieldProvenance[] {
  const byField = new Map<string, FieldSourceRow[]>();
  for (const row of rows) {
    if (!row.field_name || !row.value) continue;
    const existing = byField.get(row.field_name);
    if (existing) existing.push(row);
    else byField.set(row.field_name, [row]);
  }

  const result: FieldProvenance[] = [];
  for (const fieldName of FIELD_ORDER) {
    const fieldRows = byField.get(fieldName);
    if (!fieldRows) continue;

    const currentRow = fieldRows.find((row) => row.is_current) ?? null;
    const historyRows = fieldRows
      .filter((row) => !row.is_current)
      .sort((left, right) => Date.parse(right.recorded_at) - Date.parse(left.recorded_at));

    result.push({
      fieldName,
      fieldLabel: FIELD_LABELS[fieldName],
      current: currentRow ? toEntry(currentRow) : null,
      history: historyRows.map(toEntry),
    });
  }
  return result;
}
