/**
 * Filing timeliness and governance health calculations.
 *
 * Registered charities in England and Wales must file their annual return
 * and accounts within 10 months (approx 305 days) of their financial year end
 * (Charities Act 2011).
 *
 * This module computes how promptly an organisation files, whether it files
 * right against the deadline, and whether past or current returns are overdue.
 */

export const STATUTORY_DEADLINE_DAYS = 305; // 10 calendar months (~300–305 days)

export type FilingSpeed = "prompt" | "on_time" | "near_deadline" | "late";

export type PeriodFilingRecord = {
  periodEnd: string;
  filingDate: string | null;
  daysToFiling: number | null;
  speed: FilingSpeed | null;
};

export type FilingTimelinessSummary = {
  /** All evaluated periods with filing data, newest first. */
  records: PeriodFilingRecord[];
  /** Total periods with a known filing date. */
  totalWithFilingDate: number;
  /** Average calendar days from period end to submission date. */
  averageDays: number | null;
  /** Number of filings that took longer than the 10-month statutory limit. */
  lateCount: number;
  /** Number of filings submitted within ~6 months (180 days). */
  promptCount: number;
  /** Latest period's filing speed, or null if unfiled/unknown. */
  latestSpeed: FilingSpeed | null;
  /** Latest period's days to file. */
  latestDays: number | null;
  /** Overall governance health rating. */
  healthTone: "go" | "neutral" | "hold" | "stop";
  healthBadge: string;
  headline: string;
  insight: string;
  /** Current filing status from the regulator (e.g. "Submission Received", "Overdue"). */
  reportingStatus: string | null;
  isOverdue: boolean;
};

export function classifyFilingSpeed(days: number): FilingSpeed {
  if (days <= 180) return "prompt";
  if (days <= 270) return "on_time";
  if (days <= STATUTORY_DEADLINE_DAYS) return "near_deadline";
  return "late";
}

export function computeFilingTimeliness({
  periods,
  reportingStatus,
  now = new Date(),
}: {
  periods: readonly { period_end: string; filing_date?: string | null }[];
  reportingStatus?: string | null;
  registeredOn?: string | null;
  now?: Date;
}): FilingTimelinessSummary | null {
  if (!periods || periods.length === 0) return null;

  const records: PeriodFilingRecord[] = [];
  let daysSum = 0;
  let validDaysCount = 0;
  let lateCount = 0;
  let promptCount = 0;

  for (const p of periods) {
    if (!p.period_end) continue;
    const endMs = Date.parse(`${p.period_end.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(endMs)) continue;

    let daysToFiling: number | null = null;
    let speed: FilingSpeed | null = null;

    if (p.filing_date) {
      const filedMs = Date.parse(`${p.filing_date.slice(0, 10)}T00:00:00Z`);
      if (!Number.isNaN(filedMs)) {
        daysToFiling = Math.max(0, Math.round((filedMs - endMs) / 86_400_000));
        speed = classifyFilingSpeed(daysToFiling);
        daysSum += daysToFiling;
        validDaysCount += 1;
        if (speed === "late") lateCount += 1;
        if (speed === "prompt") promptCount += 1;
      }
    }

    records.push({
      periodEnd: p.period_end,
      filingDate: p.filing_date ?? null,
      daysToFiling,
      speed,
    });
  }

  const averageDays = validDaysCount > 0 ? Math.round(daysSum / validDaysCount) : null;
  const latestRecord = records[0] ?? null;
  const latestSpeed = latestRecord?.speed ?? null;
  const latestDays = latestRecord?.daysToFiling ?? null;

  const isExplicitlyOverdue = Boolean(
    reportingStatus && reportingStatus.toLowerCase().includes("overdue"),
  );

  // Check if latest period is currently overdue even if no status text says so:
  // If period ended > 305 days ago and has no filing_date.
  let isCurrentPeriodOverdue = false;
  if (latestRecord && !latestRecord.filingDate) {
    const endMs = Date.parse(`${latestRecord.periodEnd.slice(0, 10)}T00:00:00Z`);
    if (!Number.isNaN(endMs)) {
      const elapsedDays = Math.round((now.getTime() - endMs) / 86_400_000);
      if (elapsedDays > STATUTORY_DEADLINE_DAYS) {
        isCurrentPeriodOverdue = true;
      }
    }
  }

  const isOverdue = isExplicitlyOverdue || isCurrentPeriodOverdue;

  // Derive tone and badges
  let healthTone: FilingTimelinessSummary["healthTone"] = "neutral";
  let healthBadge = "On time";
  let headline = "";
  let insight = "";

  if (isOverdue) {
    healthTone = "stop";
    healthBadge = "Overdue";
    headline = "Accounts overdue with the regulator";
    insight =
      "The charity has missed its 10-month statutory filing deadline. Often signals acute administrative backlog, auditor disputes, or leadership transition.";
  } else if (lateCount > 0) {
    healthTone = "hold";
    healthBadge = "Filing delay";
    headline = `${lateCount} of ${validDaysCount} returns filed past deadline`;
    insight =
      "Past filings exceeded the 10-month regulatory window. Suggests periodic capacity bottlenecks in finance or reporting operations.";
  } else if (averageDays !== null && averageDays <= 180) {
    healthTone = "go";
    healthBadge = "Prompt filer";
    headline = `Files promptly (avg. ${averageDays} days after year-end)`;
    insight = `Accounts consistently submitted ~${Math.round(
      averageDays / 30.4,
    )} months after year end, well ahead of the 10-month deadline. Demonstrates proactive governance and a healthy finance function.`;
  } else if (averageDays !== null && averageDays <= 270) {
    healthTone = "neutral";
    healthBadge = "On time";
    headline = `Filed on time (avg. ${averageDays} days after year-end)`;
    insight =
      "Regularly submits accounts within standard statutory timeframes with a comfortable buffer before the 10-month deadline.";
  } else if (averageDays !== null) {
    healthTone = "hold";
    healthBadge = "Near deadline";
    headline = `Files close to deadline (avg. ${averageDays} days)`;
    insight =
      "Submits accounts right against the 10-month wire. While compliant, it often indicates an overstretched administrative team running at full capacity.";
  } else {
    // No filing dates recorded (API-only imports)
    healthTone = "neutral";
    healthBadge = reportingStatus ?? "Registered";
    headline = reportingStatus ? `Status: ${reportingStatus}` : "Filing dates not published";
    insight =
      "Charity Commission details confirm standard registration. Individual submission timestamps are published only in the annual return register extract.";
  }

  return {
    records,
    totalWithFilingDate: validDaysCount,
    averageDays,
    lateCount,
    promptCount,
    latestSpeed,
    latestDays,
    healthTone,
    healthBadge,
    headline,
    insight,
    reportingStatus: reportingStatus ?? null,
    isOverdue,
  };
}
