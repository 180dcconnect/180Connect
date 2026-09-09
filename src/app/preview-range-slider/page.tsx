"use client";

import * as React from "react";
import Link from "next/link";
import { PriceRangeSlider } from "@/components/ui/range-slider";
import { PriceRangeSliderDemo } from "@/components/ui/demo";
import { Checkbox } from "@/components/animate-ui/components/radix/checkbox";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { BackButton } from "@/components/ui/back-button";
import { Stage, Rise } from "@/components/dashboard-stage";
import { SlidersHorizontal, Sparkles, Building2, PoundSterling } from "lucide-react";

const generateHistogramData = (length: number, seed = 7): number[] => {
  const data = Array.from({ length }, (_, i) => {
    const x = Math.sin(seed + i * 1.5) * 10000;
    return x - Math.floor(x);
  });
  for (let i = 1; i < length - 1; i++) {
    data[i] = (data[i - 1] + data[i] + data[i + 1]) / 3;
  }
  return data;
};

const formatGBP = (value: number) => {
  if (value >= 1_000_000) return `£${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `£${(value / 1_000).toFixed(0)}k`;
  return `£${value}`;
};

export default function PreviewRangeSliderPage() {
  const [charityRange, setCharityRange] = React.useState<[number, number]>([25_000, 2_500_000]);
  const [includeUnpublished, setIncludeUnpublished] = React.useState(true);
  const charityHistogram = React.useMemo(() => generateHistogramData(50), []);

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-4xl space-y-10">
        {/* Header Bar */}
        <Rise className="flex flex-wrap items-center justify-between gap-4 border-b border-black/[0.08] pb-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-brand/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-brand">
                Component Preview
              </span>
              <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-[11px] font-medium text-foreground/60">
                shadcn / UI
              </span>
            </div>
            <h1 className="mt-2 text-3xl font-black tracking-[-0.03em] text-foreground">
              PriceRangeSlider Component
            </h1>
            <p className="mt-1 text-sm text-foreground/60">
              Interactive dual-thumb range slider with histogram visualization, keyboard navigation, and custom formatters.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <BackButton
              variant="sliding-door"
              size="sm"
              tone="bone"
              href="/dashboard"
            />
          </div>
        </Rise>

        {/* Section 1: Standard Demo */}
        <Rise className="rounded-3xl border border-black/[0.08] bg-white p-6 sm:p-8 shadow-xs space-y-5">
          <div className="flex items-center justify-between border-b border-black/[0.06] pb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="flex size-5 items-center justify-center rounded-full bg-brand text-white text-[11px] font-black">
                  <Sparkles className="size-3" />
                </span>
                <h2 className="text-base font-bold text-foreground">
                  Default Demo (<code className="text-xs font-mono text-brand">PriceRangeSliderDemo</code>)
                </h2>
              </div>
              <p className="text-xs text-foreground/60">
                Rendered directly from <code className="font-mono text-foreground">@/components/ui/demo</code>.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-black/5 bg-[#fbfbfa] p-4 sm:p-6">
            <PriceRangeSliderDemo />
          </div>
        </Rise>

        {/* Section 2: Charity Commission In-Context Card with Stock Image */}
        <Rise className="rounded-3xl border border-black/[0.08] bg-white overflow-hidden shadow-xs space-y-0">
          {/* Card Image Banner */}
          <div className="relative h-48 w-full overflow-hidden bg-black/5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://images.unsplash.com/photo-1532629345422-7515f3d16bb6?w=1200&auto=format&fit=crop&q=80"
              alt="Charity & Community Funding"
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
            <div className="absolute bottom-4 left-6 right-6 text-white">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#e6f5c0]">
                <Building2 className="size-3.5" />
                Charity Commission Income Filter
              </div>
              <h3 className="text-xl font-bold">Annual Income Bracket Selector</h3>
              <p className="text-xs text-white/80">
                Refining non-profit organizations by published annual financial turnover.
              </p>
            </div>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand">
                <SlidersHorizontal className="size-3.5" />
                <span>Annual Income Range</span>
              </div>
              <div className="flex items-center gap-1 text-xs font-mono font-bold text-foreground/75 bg-[#f4f4ef] px-2.5 py-1 rounded-lg border border-black/5">
                <PoundSterling className="size-3" />
                <span>{formatGBP(charityRange[0])} – {formatGBP(charityRange[1])}</span>
              </div>
            </div>

            <PriceRangeSlider
              histogramHeight="h-36 sm:h-40"
              data={charityHistogram}
              min={0}
              max={5_000_000}
              step={25_000}
              value={charityRange}
              onValueChange={setCharityRange}
              formatValue={formatGBP}
              title={null}
              minLabel="Minimum Income"
              maxLabel="Maximum Income"
              minSubtitle={
                charityRange[0] === 0 ? "£0 (No minimum)" : `From ${formatGBP(charityRange[0])}`
              }
              maxSubtitle={
                charityRange[1] >= 5_000_000 ? "£5m+ (No maximum)" : `Up to ${formatGBP(charityRange[1])}`
              }
            />

            <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-black/[0.06] text-xs">
              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="preview-unpublished"
                  className="flex items-center gap-2.5 font-semibold text-foreground/80 cursor-pointer select-none"
                >
                  <Checkbox
                    id="preview-unpublished"
                    size="sm"
                    checked={includeUnpublished}
                    onCheckedChange={(checked) => setIncludeUnpublished(Boolean(checked))}
                    className="border-black/20 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-white"
                  />
                  <span>Include charities with no published income</span>
                </label>
                <InfoTooltip
                  content="The register publishes no income figure for some charities. That is not the same as a small charity, so they are included unless you say otherwise."
                  side="top"
                />
              </div>

              <Link
                href="/admin/charity-commission"
                className="font-bold text-brand hover:underline text-xs"
              >
                Go to Charity Commission Importer →
              </Link>
            </div>
          </div>
        </Rise>
      </Stage>
    </div>
  );
}
