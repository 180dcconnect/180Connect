import { SOURCE_LABELS } from "./source-tracking.ts";
import { UNKNOWN_ACTOR, type AuditRow } from "./timeline.ts";
import { formatOutreachStatus } from "./organisation-format.ts";

export type FieldSourceRow = {
  field_name: string;
  value: string;
  source: string;
  raw_source_record_id: string | null;
  is_current: boolean;
  recorded_at: string;
  /** The user whose action produced this value (20260914100000). Null = pipeline. */
  recorded_by?: string | null;
  /** Resolved server-side by get_field_sources' join; absent on older callers. */
  recorded_by_name?: string | null;
};

export type FieldSourceEntry = {
  value: string;
  source: string;
  sourceLabel: string;
  recordedAt: string;
  /**
   * The person a manual attribution belongs to. Null is meaningful and rendered
   * as nothing: the value came from the ingestion pipeline, not from anyone.
   * A uuid whose user row is gone reads as the timeline's placeholder, never
   * as a raw id or a blank.
   */
  recordedBy: string | null;
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

// Same seven fields as write-organisations.ts's TRACKED_FIELD_SOURCES and the
// field_sources check constraint (organisation_type joined in 20260914100000) —
// kept in this fixed order (rather than deriving it from whatever rows happen
// to come back) so the card's field order doesn't reshuffle between
// organisations depending on which fields happen to have data.
const FIELD_LABELS: Readonly<Record<string, string>> = {
  legal_name: "Legal name",
  organisation_type: "Type",
  website: "Website",
  contact_email: "Contact email",
  address_line_1: "Address",
  city: "City",
  postcode: "Postcode",
};
const FIELD_ORDER = Object.keys(FIELD_LABELS);

function toEntry(row: FieldSourceRow): FieldSourceEntry {
  const source = row.source?.trim().toLowerCase() || row.source;
  const byName = row.recorded_by_name?.trim();
  return {
    value: row.value,
    source,
    sourceLabel: SOURCE_LABELS[source] ?? row.source,
    recordedAt: row.recorded_at,
    recordedBy: byName ? byName : row.recorded_by ? UNKNOWN_ACTOR : null,
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

// ---------------------------------------------------------------------------
// The Activity tab's "What came from where" card (20260914100000).
//
// Three provenance streams meet in one card, each from the table that actually
// owns that history:
//   - FIELD_SOURCES for the seven tracked fields (via groupFieldSources);
//   - ENRICHMENT_RESULTS for mission — append-only by design ("latest row
//     wins"), so its history already exists without a second tracking table;
//   - audit_log's status_changed rows for pipeline stage — set_outreach_status
//     already writes {from, to} with the actor, which is the stage's history.
// One model for all three, so the card renders them identically.
// ---------------------------------------------------------------------------

export type MissionHistoryRow = {
  id: string;
  mission_statement: string | null;
  enriched_at: string;
  confidence_score: number | null;
};

export type StageEventRow = {
  created_at: string;
  from: string | null;
  to: string | null;
  actorName: string | null;
};

/** One line in the card: a value, where it came from, when, and (if a person) who. */
export type FieldHistoryLine = {
  value: string;
  sourceLabel: string | null;
  recordedAt: string;
  recordedBy: string | null;
  /** The value live on the record right now — rendered stronger than the rest. */
  isCurrent: boolean;
};

export type FieldHistoryItem = {
  key: string;
  label: string;
  lines: FieldHistoryLine[];
};

export type FieldHistoryGroup = {
  key: "fields" | "mission" | "stage";
  heading: string;
  items: FieldHistoryItem[];
};

/**
 * Ingestion rewrites fields on every run, so a long-lived record can carry
 * dozens of superseded rows per field. The card shows the current value and
 * the recent trail — the full history stays queryable in FIELD_SOURCES; a
 * wall of twelve old postcodes is not something anyone reads.
 */
const MAX_LINES_PER_ITEM = 6;

/**
 * Mission rows carry no who-wrote-it column, so the label reads the same
 * signal every consumer of this table already uses: confidence 1 is the
 * hand-written insert (manual-entry approval, admin mission edit — both write
 * exactly 1), anything else came from the enrichment worker.
 */
function missionSourceLabel(confidence: number | null): string {
  return confidence === 1 ? "Manual entry" : "Enrichment";
}

function stageValue(from: string | null, to: string | null): string {
  // Same "—" the timeline renders for a status change missing a side.
  return `${from ? formatOutreachStatus(from) : "—"} → ${to ? formatOutreachStatus(to) : "—"}`;
}

/**
 * Merges the three streams into the card's render model, grouped Fields /
 * Mission / Pipeline stage, each item newest-first with the live value marked.
 * Returns only groups with content; the caller renders its empty state when
 * nothing has ever been recorded against this organisation.
 */
export function buildFieldHistoryGroups(input: {
  provenance: readonly FieldProvenance[];
  missionRows: readonly MissionHistoryRow[];
  stageEvents: readonly StageEventRow[];
}): FieldHistoryGroup[] {
  const groups: FieldHistoryGroup[] = [];

  const fieldItems: FieldHistoryItem[] = input.provenance.map((entry) => {
    const lines: FieldHistoryLine[] = [];
    if (entry.current) {
      lines.push({ ...entry.current, isCurrent: true });
    }
    for (const past of entry.history) {
      lines.push({ ...past, isCurrent: false });
    }
    return { key: `field-${entry.fieldName}`, label: entry.fieldLabel, lines: lines.slice(0, MAX_LINES_PER_ITEM) };
  });
  if (fieldItems.length > 0) {
    groups.push({ key: "fields", heading: "Fields", items: fieldItems });
  }

  const missionLines: FieldHistoryLine[] = input.missionRows
    .filter((row) => typeof row.mission_statement === "string" && row.mission_statement.trim())
    .sort((left, right) => Date.parse(right.enriched_at) - Date.parse(left.enriched_at))
    .slice(0, MAX_LINES_PER_ITEM)
    .map((row) => ({
      value: (row.mission_statement as string).trim(),
      sourceLabel: missionSourceLabel(row.confidence_score),
      recordedAt: row.enriched_at,
      recordedBy: null,
      // "Latest row wins" is the table's own rule, so its newest row is the
      // live mission — the same one the Overview panel shows.
      isCurrent: false,
    }));
  if (missionLines.length > 0) {
    missionLines[0].isCurrent = true;
    groups.push({
      key: "mission",
      heading: "Mission",
      items: [{ key: "mission", label: "Mission", lines: missionLines }],
    });
  }

  const stageLines: FieldHistoryLine[] = input.stageEvents
    .filter((event) => typeof event.created_at === "string" && event.created_at)
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    .slice(0, MAX_LINES_PER_ITEM)
    .map((event) => ({
      value: stageValue(event.from, event.to),
      sourceLabel: null,
      recordedAt: event.created_at,
      recordedBy: event.actorName,
      isCurrent: false,
    }));
  if (stageLines.length > 0) {
    stageLines[0].isCurrent = true;
    groups.push({
      key: "stage",
      heading: "Pipeline stage",
      items: [{ key: "stage", label: "Pipeline stage", lines: stageLines }],
    });
  }

  return groups;
}

/**
 * The stage events behind the card, out of the same audit rows the timeline
 * already reads — one query serves both. Actor names come from the same
 * resolved map the timeline uses, so a person reads as a person everywhere on
 * the tab and a deleted account reads as the placeholder, never a blank.
 */
export function stageEventsFromAudit(
  auditRows: readonly AuditRow[],
  names: ReadonlyMap<string, string | null>,
): StageEventRow[] {
  return auditRows
    .filter((row) => row.action === "status_changed")
    .map((row) => {
      const detail = row.detail && typeof row.detail === "object" ? (row.detail as Record<string, unknown>) : {};
      const from = typeof detail.from === "string" ? detail.from : null;
      const to = typeof detail.to === "string" ? detail.to : null;
      const name = row.actor_user_id ? names.get(row.actor_user_id)?.trim() : null;
      return {
        created_at: row.created_at,
        from,
        to,
        actorName: name ? name : row.actor_user_id ? UNKNOWN_ACTOR : null,
      };
    });
}
