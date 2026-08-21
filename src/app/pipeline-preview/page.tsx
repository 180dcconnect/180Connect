/**
 * TEMPORARY preview route — delete once the pipeline report is signed off.
 *
 * A single card at a round, healthy set of numbers: 2,000 in the book, halving
 * at every step down to 250 converted. Staging is 1,734 organisations all still
 * `not_contacted`, so the live card cannot draw this shape yet — this is the
 * funnel at full stretch, every stage carrying weight.
 */

import { PipelineReport } from "../clients/pipeline-report";
import {
  FUNNEL_STAGE_KEYS,
  type BreakdownRow,
  type FunnelStage,
  type FunnelStageKey,
} from "../clients/client-insights";

const COUNTS: Record<FunnelStageKey, number> = {
  all: 2000,
  contacted: 1000,
  responded: 500,
  converted: 250,
};

const STAGE_COPY: Record<FunnelStageKey, { label: string; caption: string }> = {
  all: { label: "In the database", caption: "Every client on the working list" },
  contacted: { label: "Contacted", caption: "Outreach has gone out" },
  responded: { label: "Responded", caption: "They came back to us" },
  converted: { label: "Converted", caption: "Signed as a project" },
};

const stages: FunnelStage[] = FUNNEL_STAGE_KEYS.map((key, index) => {
  const count = COUNTS[key];
  const previousKey = index === 0 ? null : FUNNEL_STAGE_KEYS[index - 1];
  const previous = previousKey === null ? null : COUNTS[previousKey];
  return {
    key,
    ...STAGE_COPY[key],
    count,
    shareOfTotal: count / COUNTS.all,
    shareOfPrevious: previous === null ? null : previous === 0 ? 0 : count / previous,
  };
});

/**
 * The city split keeps staging's real proportions (57% of the book has no city
 * on it at all, then London, then Birmingham), scaled to 2,000 and halved down
 * the same way — so a row reads across as its own funnel, and the table's
 * columns stay consistent with the stage totals above them.
 */
const CITIES: { key: string; label: string; all: number; filterable: boolean }[] = [
  { key: "city:none", label: "No city recorded", all: 1139, filterable: false },
  { key: "city:london", label: "London", all: 153, filterable: true },
  { key: "city:birmingham", label: "Birmingham", all: 27, filterable: true },
];

const rows: BreakdownRow[] = CITIES.map((city) => ({
  key: city.key,
  label: city.label,
  counts: {
    all: city.all,
    contacted: Math.round(city.all / 2),
    responded: Math.round(city.all / 4),
    converted: Math.round(city.all / 8),
  },
  count: city.all,
  share: city.all / CITIES[0].all,
  filter: city.filterable ? { param: "city", value: city.label } : null,
}));

export default function PipelinePreviewPage() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <PipelineReport
          stages={stages}
          selected="all"
          stageHref={(stage) => `/pipeline-preview?stage=${stage}`}
          caption="All clients"
          field="city"
          direction="descending"
          rows={rows}
          rowHref={() => "/pipeline-preview"}
        />
      </div>
    </div>
  );
}
