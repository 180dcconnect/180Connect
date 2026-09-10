// F214 — Natural Language Charity Search (#209): saying out loud what the model
// decided.
//
// A search a CAM cannot see the workings of is one they cannot trust or correct.
// Every part of a resolved plan becomes a chip here, and every chip carries the
// filter parameter it corresponds to — so the same list both explains the
// interpretation and builds the "convert to filters" link that turns it into
// ordinary, editable F053-F058 filters. That link is also AC3's escape hatch in
// its calmest form: not a fallback after a failure, but the CAM deciding the
// interpretation was close enough to keep and adjust by hand.

import {
  priorityScoreFilterLabel,
  SECTOR_FILTER_LABELS,
} from "../../app/clients/visible-clients.ts";
import { INCOME_BAND_LABELS, type IncomeBand } from "../income-band.ts";
import { formatOrganisationType, formatOutreachStatus } from "../organisation-format.ts";
import type { ResolvedNlPlan } from "./nl-search-apply.ts";

export type PlanChip = {
  /** What the chip says. */
  label: string;
  /** What it means, in one word, so a chip reads "City · Leeds". */
  category: string;
  /** The list's query parameter this maps onto, or null for the parts of a plan
   *  no manual filter can express (keywords, which only affect ranking). */
  param: string | null;
  value: string;
};

export function describeResolvedPlan(plan: ResolvedNlPlan): PlanChip[] {
  const chips: PlanChip[] = [];
  for (const city of plan.cities) {
    chips.push({ label: city, category: "City", param: "city", value: city });
  }
  for (const code of plan.countries) {
    chips.push({ label: code, category: "Country", param: "country", value: code });
  }
  for (const sector of plan.sectors) {
    chips.push({
      label: SECTOR_FILTER_LABELS[sector] ?? sector,
      category: "Sector",
      param: "sector",
      value: sector,
    });
  }
  for (const type of plan.types) {
    chips.push({
      label: formatOrganisationType(type),
      category: "Type",
      param: "type",
      value: type,
    });
  }
  for (const status of plan.statuses) {
    chips.push({
      label: formatOutreachStatus(status),
      category: "Status",
      param: "status",
      value: status,
    });
  }
  for (const band of plan.incomeBands) {
    chips.push({
      label: INCOME_BAND_LABELS[band as IncomeBand] ?? band,
      category: "Income",
      // No manual income-band filter exists on the list (F053-F058 never added
      // one), so this part of an interpretation cannot be handed over as a chip.
      // Saying so beats pretending: converting to filters keeps everything else
      // and the CAM can see what they lost.
      param: null,
      value: band,
    });
  }
  for (const band of plan.scoreBands) {
    chips.push({
      label: priorityScoreFilterLabel(band),
      category: "Priority",
      param: "score",
      value: band,
    });
  }
  for (const keyword of plan.keywords) {
    chips.push({
      label: keyword,
      // Ranking only — never narrows, so it has no filter to convert into.
      category: "Ranked on",
      param: null,
      value: keyword,
    });
  }
  return chips;
}

/**
 * The filter parameters a "convert to filters" link should carry. Only the parts
 * a manual filter can actually hold: converting must produce a list the CAM can
 * fully drive by hand afterwards, so anything that would silently keep applying
 * from the interpretation is left out rather than smuggled along.
 */
export function planFilterParams(plan: ResolvedNlPlan): Record<string, string[]> {
  const params: Record<string, string[]> = {};
  const add = (param: string, values: string[]) => {
    if (values.length > 0) params[param] = values;
  };
  add("city", plan.cities);
  add("country", plan.countries);
  add("sector", plan.sectors);
  add("type", plan.types);
  add("status", plan.statuses);
  add("score", plan.scoreBands);
  return params;
}

/** True when converting would lose part of the interpretation, so the UI can say so. */
export function planHasUnconvertibleParts(plan: ResolvedNlPlan): boolean {
  return plan.incomeBands.length > 0 || plan.keywords.length > 0;
}
