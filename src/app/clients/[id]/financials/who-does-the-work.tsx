import type { FinancialSeries, FinancialYear } from "@/lib/financials/financial-series";
import { formatGbp } from "@/lib/income-band";

import { INCOME, percent, SeriesTable, share, StatBlock, StatFigure, StatMissing, SURPLUS } from "./chart-parts";

/**
 * Who actually does the work, and what that means for an engagement.
 *
 * **Why this is a section and not a caption.** A £400k charity run by two
 * employees and ninety volunteers is a different engagement from a £400k charity
 * with twelve employees and none — same income, same band, same priority score,
 * completely different project. Income cannot tell them apart and this is the
 * only place on the record that can. It spent a while as a one-line row at the
 * foot of section 1, under three money figures, which is why nobody read it.
 *
 * **What the one-line version could not say.** Three things, and each is a
 * question a CAM actually asks. What the *balance* is — a bar reads paid-versus-
 * unpaid at a glance where two counts side by side do not. How much income there
 * is *per member of staff* — the figure that says whether there is anyone to
 * hand a project over to at the end. And the whole filed history rather than a
 * 54px sparkline, because headcount moving from 4 to 11 over three years is the
 * story, not the 11.
 *
 * **A filed zero is a zero.** "No paid staff" is a real and useful answer — it
 * is arguably *the* answer this section exists to give — so every check is
 * against `null`, never falsiness. Absence of a figure is the only thing that
 * suppresses a line.
 *
 * **The newest year that reported, not the newest year.** The latest return is
 * often a totals-only filing while the one before it carries the counts, and
 * "no headcount published this year" is not the claim "no employees".
 *
 * **Why so many clients see nothing here.** Entry-level annual returns file
 * totals only; the register asks for headcount further up. The empty state is
 * `SectionUnavailable` on the page, which keeps the number.
 */

/** The people bar. Paid and unpaid on one track, because the question is the
 *  balance between them and two separate bars make that a subtraction the
 *  reader has to do. */
function PeopleBar({
  employees,
  volunteers,
}: {
  employees: number;
  volunteers: number;
}) {
  const total = employees + volunteers;
  if (total <= 0) return null;

  return (
    <div className="mt-4">
      <div
        aria-hidden="true"
        className="flex h-[6px] w-full overflow-hidden rounded-full bg-paper-sunk"
      >
        <span
          className="h-full"
          style={{
            width: `${percent(employees, total)}%`,
            backgroundColor: INCOME,
            minWidth: employees > 0 ? 2 : 0,
          }}
        />
        <span
          className="h-full"
          style={{
            width: `${percent(volunteers, total)}%`,
            backgroundColor: SURPLUS,
            minWidth: volunteers > 0 ? 2 : 0,
          }}
        />
      </div>
      <p className="mt-2 text-[12.5px] leading-[1.55] text-dim">
        {volunteers === 0
          ? "Every person on the return is paid staff."
          : employees === 0
            ? "Entirely volunteer-run — no paid staff on the return."
            : `${share(volunteers / total)} of the people on the return are volunteers.`}
      </p>
    </div>
  );
}

export function WhoDoesTheWork({ series }: { series: FinancialSeries }) {
  const reported = [...series.years]
    .reverse()
    .find((year) => year.employees !== null || year.volunteers !== null);
  if (!reported) return null;

  // Only the years that published a figure. A gap year left in would draw as a
  // dive to zero, which is the one thing the register does not say.
  const withCounts = series.years.filter(
    (year) => year.employees !== null || year.volunteers !== null,
  );

  const { employees, volunteers, income } = reported;
  const perEmployee =
    income !== null && employees !== null && employees > 0 ? income / employees : null;

  return (
    <div className="mt-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatBlock
          caption={
            employees === null
              ? "Not on this return"
              : employees === 1
                ? "Paid employee"
                : "Paid employees"
          }
          label="Employees"
          value={
            employees === null ? (
              <StatMissing />
            ) : (
              <StatFigure>{employees.toLocaleString("en-GB")}</StatFigure>
            )
          }
        />
        <StatBlock
          caption={
            volunteers === null
              ? "Not on this return"
              : volunteers === 1
                ? "Unpaid volunteer"
                : "Unpaid volunteers"
          }
          label="Volunteers"
          value={
            volunteers === null ? (
              <StatMissing />
            ) : (
              <StatFigure>{volunteers.toLocaleString("en-GB")}</StatFigure>
            )
          }
        />
        <StatBlock
          className="col-span-2 sm:col-span-1"
          caption={
            perEmployee === null
              ? "Needs both income and a headcount"
              : "Income per member of staff"
          }
          label="Income per employee"
          value={
            perEmployee === null ? (
              <StatMissing />
            ) : (
              <StatFigure>{formatGbp(Math.round(perEmployee))}</StatFigure>
            )
          }
        />
      </div>

      {employees !== null && volunteers !== null && (
        <PeopleBar employees={employees} volunteers={volunteers} />
      )}

      <p className="mt-3 text-[11.5px] leading-[1.5] text-faint">
        From the {reported.label} annual return
        {withCounts.length > 1
          ? `, the newest of ${withCounts.length} filed years that published a headcount.`
          : " — the only filed year that published a headcount."}{" "}
        The register asks for these counts above its reporting threshold, so an
        entry-level return leaves them blank rather than reporting nobody.
      </p>

      {withCounts.length > 1 && (
        <SeriesTable
          columns={[
            { header: "Employees", cell: countCell("employees") },
            { header: "Volunteers", cell: countCell("volunteers") },
          ]}
          years={withCounts}
        />
      )}
    </div>
  );
}

/** Not reported and zero are different claims, and the table is the one place
 *  a reader can check which of the two a blank chart cell meant. */
function countCell(field: "employees" | "volunteers") {
  return (year: FinancialYear) => {
    const value = year[field];
    return value === null ? "Not reported" : value.toLocaleString("en-GB");
  };
}
