"use client";

import { useId, useState } from "react";

/**
 * Headcount as a dial — the people half of section 1.1.
 *
 * **Why a dial and not a number in the grid.** How many bodies an organisation
 * has is a scale measure in the way income is, and it is the one that tells a
 * £2m charity run by nine people apart from a £2m charity run by two hundred.
 * But the *composition* is the part a CAM actually acts on: 4,084 staff and
 * 28,920 volunteers is a different organisation to work with than 33,004 staff,
 * and as a fourth cell in a row of money figures that split had nowhere to go
 * except a caption reading "12% volunteers". The ring shows the split at a
 * glance and keeps the total in the middle, so neither has to be read as words.
 *
 * **A full circle, not the dashboard's 270° arc.** The arc on Queue quality is
 * a gauge: it has a start and an end because a queue is being filled up towards
 * something. This is a composition — two parts of one whole, with no low end and
 * no target — and drawing it with a gap invites the reader to look for what the
 * gap means. Same tick construction, same hover behaviour, closed.
 *
 * **Ticks rather than a donut path.** Two arcs meeting at a seam need a stroke
 * between them or they read as one shape; ticks separate themselves, and at a
 * 92% / 8% split the minority segment is still four visible marks rather than a
 * sliver of ring you cannot point at. It is also what the dashboard does, so the
 * two read as the same family.
 *
 * **A filed zero is a zero and an absent figure is not one.** A return that
 * published 40 volunteers and no staff count gives a total of 40 that is a
 * *floor*, so the caption names which half is missing rather than letting the
 * total imply both were filed.
 */

/** Ticks around the ring. Enough that a 3% segment still gets a mark. */
const TOTAL_TICKS = 48;
/** Twelve o'clock, going clockwise. */
const START_ANGLE_DEG = -90;

const CENTRE = 100;
const INNER_RADIUS = 66;
const OUTER_RADIUS = 84;

type Segment = {
  id: "employees" | "volunteers";
  name: string;
  value: number;
  /** A token, not a hex: these are read straight into `stroke`. */
  colour: string;
  /** What the figure actually is, said on hover. */
  note: string;
};

const round = (value: number) => Math.round(value * 1000) / 1000;

function tickPoints(index: number) {
  const angleRad = ((START_ANGLE_DEG + (index / TOTAL_TICKS) * 360) * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return {
    x1: round(CENTRE + INNER_RADIUS * cos),
    y1: round(CENTRE + INNER_RADIUS * sin),
    x2: round(CENTRE + OUTER_RADIUS * cos),
    y2: round(CENTRE + OUTER_RADIUS * sin),
  };
}

/** Precomputed tick line coordinates rounded to 3 decimal places to avoid SSR float mismatches. */
const TICKS = Array.from({ length: TOTAL_TICKS }, (_, index) => ({
  index,
  ...tickPoints(index),
}));

export function PeopleDial({
  employees,
  volunteers,
  /** The filed year these counts came from, which is not always the newest. */
  year,
}: {
  employees: number | null;
  volunteers: number | null;
  year: number | null;
}) {
  const dialId = useId().replace(/:/g, "");
  const [hovered, setHovered] = useState<Segment["id"] | null>(null);

  const total =
    employees === null && volunteers === null ? null : (employees ?? 0) + (volunteers ?? 0);
  const bothFiled = employees !== null && volunteers !== null;

  const caption =
    total === null
      ? "Not on the filed return"
      : !bothFiled
        ? employees === null
          ? "Volunteers only — no staff figure filed"
          : "Staff only — no volunteer figure filed"
        : volunteers === 0
          ? "All paid staff, no volunteers"
          : employees === 0
            ? "All volunteers, no paid staff"
            : `${Math.round(((volunteers ?? 0) / (total || 1)) * 100)}% volunteers`;

  // Nothing filed. Said plainly rather than drawn as an empty ring, which would
  // read as "zero people" — a claim the return does not make.
  if (total === null) {
    return (
      <div className="flex h-full flex-col justify-center py-4 text-center">
        <p className="font-mono text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">
          People
        </p>
        <p className="mt-2 font-mono text-[20px] text-faint">Not reported</p>
        <p className="mx-auto mt-1.5 max-w-[30ch] text-[11.5px] leading-[1.5] text-faint">
          The register asks for staff and volunteer counts only above its
          reporting threshold, so an entry-level return leaves them blank.
        </p>
      </div>
    );
  }

  const segments: Segment[] = [
    employees !== null && {
      id: "employees" as const,
      name: "Paid staff",
      value: employees,
      colour: "var(--lead)",
      note: "Employees at the year end, as filed on the annual return.",
    },
    volunteers !== null && {
      id: "volunteers" as const,
      name: "Volunteers",
      value: volunteers,
      colour: "var(--ink)",
      // Worth saying: a charity counting its volunteers is estimating, and the
      // round numbers in the register make that obvious once you look.
      note: "People giving time unpaid, as the charity counted them. Usually an estimate.",
    },
  ].filter((segment): segment is Segment => Boolean(segment));

  // A filed pair of zeroes would divide by nothing; the ring falls back to the
  // first segment so it draws as one flat colour rather than disappearing.
  const drawable = segments.filter((segment) => segment.value > 0);
  const ringSegments = drawable.length > 0 ? drawable : segments.slice(0, 1);
  const ringTotal = ringSegments.reduce((sum, segment) => sum + segment.value, 0) || 1;

  // Which segment each tick belongs to, walking the ring once.
  const bounds: { segment: Segment; end: number }[] = [];
  let accumulated = 0;
  for (const segment of ringSegments) {
    accumulated += segment.value;
    bounds.push({ segment, end: Math.round((accumulated / ringTotal) * TOTAL_TICKS) });
  }

  const active = segments.find((segment) => segment.id === hovered) ?? null;

  return (
    <div className="flex flex-col items-center">
      <p className="font-mono text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">
        People
      </p>

      <div className="relative mt-2 aspect-square w-full max-w-[240px] xl:max-w-[260px]">
        <svg viewBox="0 0 200 200" className="h-full w-full select-none" aria-hidden="true">
          {TICKS.map(({ index, x1, y1, x2, y2 }) => {
            const segment =
              bounds.find((bound) => index < bound.end)?.segment ??
              ringSegments[ringSegments.length - 1];
            const dimmed = hovered !== null && hovered !== segment.id;

            return (
              <line
                key={`${dialId}-${index}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={segment.colour}
                strokeWidth={hovered === segment.id ? 4 : 3}
                strokeLinecap="round"
                className="transition-all duration-200"
                opacity={dimmed ? 0.15 : 1}
                onPointerEnter={() => setHovered(segment.id)}
                onPointerLeave={() => setHovered(null)}
                style={{ pointerEvents: "stroke" }}
              />
            );
          })}
        </svg>

        {/* The total, and what it is made of. Ignores pointer events so the ring
            underneath stays hoverable across the whole disc. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-mono text-[30px] sm:text-[32px] leading-none font-bold tracking-tight tabular-nums text-ink">
            {total.toLocaleString("en-GB")}
          </span>
          <span className="mt-2 max-w-[13ch] sm:max-w-[14ch] text-[11.5px] sm:text-[12px] leading-[1.35] text-dim">
            {caption}
          </span>
        </div>
      </div>

      {/* The legend doubles as the hover target, because a 3% segment is a hard
          thing to point at and the rows are not. */}
      <div className="mt-3.5 w-full max-w-[260px] xl:max-w-[280px] space-y-1">
        {segments.map((segment) => (
          <button
            key={segment.id}
            type="button"
            onPointerEnter={() => setHovered(segment.id)}
            onPointerLeave={() => setHovered(null)}
            onFocus={() => setHovered(segment.id)}
            onBlur={() => setHovered(null)}
            aria-describedby={`${dialId}-note`}
            className={`flex w-full cursor-default items-center justify-between gap-3 rounded-inset px-2.5 py-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-lead-mid focus-visible:outline-none ${
              hovered === segment.id ? "bg-paper" : "hover:bg-paper/60"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ background: segment.colour }}
              />
              <span className="truncate text-[13px] text-dim">{segment.name}</span>
            </span>
            <span className="shrink-0 font-mono text-[13px] font-semibold tabular-nums text-ink">
              {segment.value.toLocaleString("en-GB")}
            </span>
          </button>
        ))}
      </div>

      {/* One line, and it changes rather than appearing — a tooltip that pops in
          over the dial covers the number it is explaining. Reserves its own
          height so hovering never nudges the layout. */}
      <p
        id={`${dialId}-note`}
        aria-live="polite"
        className="mt-2 min-h-[46px] max-w-[280px] px-1 text-center text-[12px] leading-[1.45] text-faint"
      >
        {active ? (
          <>
            <span className="font-medium text-dim">
              {Math.round((active.value / (total || 1)) * 100)}% of the total.
            </span>{" "}
            {active.note}
          </>
        ) : (
          <>
            Staff and volunteers as filed
            {year !== null && <> on the FY{String(year).slice(-2)} return</>}. Hover a
            row for what each figure counts.
          </>
        )}
      </p>
    </div>
  );
}
