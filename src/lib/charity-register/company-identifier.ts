// The second registration number behind a Charity Commission one.
//
// A charity that is also a company carries two numbers, and the register
// publishes both: a charitable company and a CIO are both "dual-registered".
// The import path files both — `write-organisations.ts` writes a `uk_charity`
// and a `uk_company` identifier for exactly this case — but a *hand-entered*
// charity was filed with the one number the CAM typed, so the record could not
// answer "is this also a company" and the grant lookup could only ask 360Giving
// about the charity number.
//
// This is the register's own answer, read from the file the deployment holds.
// Kept here rather than inline in the form's check and the save action because
// both need it and they must agree: the sentence under the number field and the
// identifier on the record have to be the same fact from the same read.
//
// ── Only one direction exists ──
//
// Charity number → company number, never the reverse. The companies slice we
// hold carries no charity numbers at all, and the charity file has no index on
// `company_number`, so the reverse question is a full scan of 171,800 rows on
// every keystroke of a check. The form asks in the direction that can answer.

import { charityByRegisteredNumber } from "./sqlite.ts";
import { normaliseRegistrationNumber, type RegisterId } from "../registration-number.ts";

/**
 * The register read, injectable so this is testable without the register file —
 * the same shape every other adapter in this codebase takes.
 */
export type CharityCompanyLookup = (
  registeredNumber: number,
) => { companyNumber?: string | null } | null;

/**
 * The Companies House number the register holds for this charity, or null.
 *
 * Null is the honest answer to four different questions — not a charity
 * register, not a number, not in the file, not a company — and the caller says
 * nothing in every one of them, because "the register says this charity has no
 * company number" and "the register does not know this charity" are different
 * claims and only one of them is ever true here.
 *
 * The register must be the England and Wales one. A six- or seven-digit number
 * entered against Companies House is a *company* number, and asking the charity
 * file about it would match a different organisation entirely — the reason this
 * takes the register rather than trusting the caller to have checked.
 */
export function companyNumberForRegisteredCharity(
  register: RegisterId | null | undefined,
  registeredNumber: string | number | null | undefined,
  lookup: CharityCompanyLookup = charityByRegisteredNumber,
): string | null {
  if (register !== "ccew") return null;

  const text = String(registeredNumber ?? "").trim();
  if (!/^\d{6,7}$/.test(text)) return null;

  const entry = lookup(Number(text));
  const raw = entry?.companyNumber?.trim();
  if (!raw) return null;

  // In the app's canonical company-number form — upper-cased and zero-padded to
  // eight digits — so it compares equal to the identifier the import path would
  // have written for the same company, and to the column's CHECK constraint.
  const normalised = normaliseRegistrationNumber("companies_house", raw);
  return normalised.ok ? normalised.value : null;
}
