import { Landmark } from "lucide-react";

import {
  buildFieldHistoryGroups,
  type FieldHistoryGroup,
  type FieldProvenance,
  type MissionHistoryRow,
  type StageEventRow,
} from "@/lib/field-sources";

import { SectionCard } from "./section-card";

/**
 * "What came from where" — per-field provenance on the Activity tab, the UI
 * half of F044 that the table shipped without. Three history streams, one
 * card, each read from the table that owns it:
 *
 *   Fields         FIELD_SOURCES, via groupFieldSources — every tracked
 *                  field's current value+source above the superseded ones
 *                  (AC2: "both values and their sources are visible").
 *   Mission        ENRICHMENT_RESULTS, append-only by design, so the mission's
 *                  own table is its history; the newest row is the live one.
 *   Pipeline stage audit_log's status_changed rows ({from, to}) — the same
 *                  events the timeline renders as prose.
 *
 * Nothing here is editable: this card is the record's memory, not another
 * control surface. Corrections happen where they always have — the inline
 * editor on Overview, the suggestion flow for CAMs.
 *
 * An empty card is a real statement and is rendered as one: no source has
 * recorded any value against this organisation, which for a pre-20260820
 * import (before FIELD_SOURCES existed) is an honest gap, not a claim that
 * the data came from nowhere.
 */

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function FieldLine({
  value,
  sourceLabel,
  recordedAt,
  recordedBy,
  isCurrent,
}: {
  value: string;
  sourceLabel: string | null;
  recordedAt: string;
  recordedBy: string | null;
  isCurrent: boolean;
}) {
  const when = formatDateTime(recordedAt);

  return (
    <div
      className={`flex flex-col gap-0.5 border-t border-rule-soft py-2.5 first:border-t-0 first:pt-0 ${
        isCurrent ? "" : "opacity-80"
      }`}
    >
      <p
        className={`text-sm leading-[1.55] break-words ${
          isCurrent ? "font-semibold text-ink" : "text-dim"
        }`}
      >
        {value}
      </p>
      <p className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-faint">
        {sourceLabel && <span className="font-medium">{sourceLabel}</span>}
        {recordedBy && <span>by {recordedBy}</span>}
        {when && <span>{when}</span>}
      </p>
    </div>
  );
}

function GroupBlock({ group }: { group: FieldHistoryGroup }) {
  return (
    <section aria-labelledby={`wfww-${group.key}-heading`} className="mt-3.5 first:mt-0">
      <h4
        id={`wfww-${group.key}-heading`}
        className="text-[12px] font-semibold tracking-[0.06em] text-faint uppercase"
      >
        {group.heading}
      </h4>
      <ul className="mt-1.5">
        {group.items.map((item) => (
          <li key={item.key} className="py-2.5 first:pt-0 last:pb-0">
            <p className="text-[13px] text-dim">{item.label}</p>
            <div className="mt-1">
              {item.lines.map((line, index) => (
                <FieldLine
                  key={`${item.key}-${line.recordedAt}-${index}`}
                  value={line.value}
                  sourceLabel={line.sourceLabel}
                  recordedAt={line.recordedAt}
                  recordedBy={line.recordedBy}
                  isCurrent={line.isCurrent}
                />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function WhatCameFromWhereCard({
  provenance,
  missionRows,
  stageEvents,
  error = false,
}: {
  provenance: FieldProvenance[];
  missionRows: MissionHistoryRow[];
  stageEvents: StageEventRow[];
  /** The provenance query failed — say so rather than showing an empty card. */
  error?: boolean;
}) {
  const groups = buildFieldHistoryGroups({ provenance, missionRows, stageEvents });

  return (
    <SectionCard
      headingId="wfww-heading"
      title="What came from where"
      hint="Every tracked value on this record, where it came from, and what it replaced."
      icon={<Landmark aria-hidden="true" />}
    >
      {error ? (
        <p className="mt-3.5 text-sm font-semibold text-stop" role="alert">
          The field history could not be loaded. Refresh and try again.
        </p>
      ) : groups.length === 0 ? (
        <p className="mt-3.5 text-sm leading-[1.6] text-dim">
          Nothing has recorded where this record&rsquo;s values came from yet. That is a
          gap in the record&rsquo;s own history — records imported before per-field
          provenance existed carry none until a field is next written.
        </p>
      ) : (
        <div>
          {groups.map((group) => (
            <GroupBlock key={group.key} group={group} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
