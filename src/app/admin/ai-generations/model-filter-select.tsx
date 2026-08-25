"use client";

import { useRouter } from "next/navigation";

/**
 * F213/F113 — the explicit "filter by model" control, distinct from clicking a
 * bar in ModelBreakdown: a CAM/admin scanning the page should find a filter
 * without first having to notice the bars are clickable. Both write the same
 * `?model=` param, so they can never disagree about what "filtered" means.
 */
export function ModelFilterSelect({
  models,
  activeModel,
  basePath,
}: {
  models: readonly string[];
  activeModel: string | null;
  basePath: string;
}) {
  const router = useRouter();

  if (models.length === 0) return null;

  return (
    <label className="flex items-center gap-2 text-sm font-bold text-foreground/60">
      Filter by model
      <select
        className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-sm font-bold text-foreground focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        onChange={(event) => {
          const value = event.target.value;
          router.push(value ? `${basePath}?model=${encodeURIComponent(value)}` : basePath);
        }}
        value={activeModel ?? ""}
      >
        <option value="">All models</option>
        {models.map((model) => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
      </select>
    </label>
  );
}
