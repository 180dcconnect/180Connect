"use client";

import Link from "next/link";
import { ArrowRight, Check, Info, TriangleAlert } from "lucide-react";

import type { CharityPreview } from "@/lib/import/charity-preview";
import type { ListedCharity } from "./import-result";

/**
 * What a lookup found, before anything is saved.
 *
 * The point of the step is that a reader can recognise the charity — or fail to
 * — so this leads with the name and the registration number, then the verdict,
 * then the fields that distinguish one similarly-named trust from another. It
 * is not a full record: it shows what the import would write, and the record
 * itself is one click away afterwards.
 */

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : DATE.format(parsed);
}

/**
 * What saving would actually do, in the reader's words. Driven by the same
 * `checkClientCriteria` result the promote loop acts on, so the button below
 * can never promise an outcome the import will not deliver.
 */
const VERDICT = {
  meets: {
    surface: "bg-go-wash text-go",
    Icon: Check,
    headline: "This charity meets the client criteria and will join the client list.",
  },
  needs_review: {
    surface: "bg-hold-wash text-hold",
    Icon: TriangleAlert,
    headline: "This charity will be imported and held for review, not added to the client list.",
  },
  does_not_meet: {
    surface: "bg-hold-wash text-hold",
    Icon: TriangleAlert,
    headline: "This charity does not meet the client criteria, so importing will not add it.",
  },
} as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">{label}</dt>
      <dd className="mt-0.5 text-sm break-words text-ink">{children}</dd>
    </div>
  );
}

const NOT_ON_RECORD = <span className="text-faint">Not on the register</span>;

export function CharityPreviewCard({
  preview,
  alreadyListed,
}: {
  preview: CharityPreview;
  alreadyListed: ListedCharity | null;
}) {
  const verdict = VERDICT[preview.criteria.outcome];
  const { organisation, financialPeriod, registration } = preview;
  const location = [organisation.city, organisation.postcode].filter(Boolean).join(", ");

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-rule bg-white p-4">
        <p className="text-base font-semibold leading-tight text-ink">
          {organisation.legal_name || "This charity has no name on the register"}
        </p>
        <p className="mt-1 text-[13px] text-dim">
          Registered charity {preview.registeredNumber}
          {preview.companyIdentifier ? ` · company ${preview.companyIdentifier.identifierValue}` : ""}
          {registration.registeredOn ? ` · registered ${formatDate(registration.registeredOn)}` : ""}
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Type">{organisation.organisation_type}</Field>
          <Field label="Location">{location || NOT_ON_RECORD}</Field>
          <Field label="Website">{organisation.website || NOT_ON_RECORD}</Field>
          <Field label="Contact email">{organisation.contact_email || NOT_ON_RECORD}</Field>
          {financialPeriod ? (
            <>
              <Field label={`Income (year to ${formatDate(financialPeriod.periodEnd)})`}>
                {financialPeriod.totalIncome === null
                  ? NOT_ON_RECORD
                  : GBP.format(financialPeriod.totalIncome)}
              </Field>
              <Field label="Expenditure">
                {financialPeriod.totalExpenditure === null
                  ? NOT_ON_RECORD
                  : GBP.format(financialPeriod.totalExpenditure)}
              </Field>
            </>
          ) : (
            // Said out loud rather than left as two absent fields: "no accounts
            // filed" is a fact about the charity worth seeing before saving,
            // and an empty space reads as a page that failed to load.
            <div className="col-span-2">
              <Field label="Latest accounts">
                <span className="text-faint">
                  No filed year on the register response
                </span>
              </Field>
            </div>
          )}
        </dl>
      </div>

      {/* A charity struck off the register is the single most important thing to
          notice before adding it, and nothing else on this card would reveal it. */}
      {registration.status === "removed" && (
        <div className="flex items-start gap-2.5 rounded-xl bg-stop-wash p-3 text-stop" role="alert">
          <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.4} />
          <p className="text-sm font-semibold">
            This charity has been removed from the register
            {registration.removedOn ? ` (${formatDate(registration.removedOn)})` : ""}. It is no
            longer a registered charity.
          </p>
        </div>
      )}

      {alreadyListed ? (
        <div className="rounded-xl bg-lead-wash p-3 text-lead" role="status">
          <div className="flex items-start gap-2.5">
            <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.4} />
            <div className="space-y-1.5">
              <p className="text-sm font-semibold">
                {alreadyListed.name} is already on the client list.
              </p>
              <Link
                className="group inline-flex items-center gap-1 text-[13px] font-semibold underline underline-offset-2"
                href={`/clients/${alreadyListed.organisationId}`}
              >
                Open the record
                <ArrowRight
                  aria-hidden="true"
                  className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                />
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className={`rounded-xl p-3 ${verdict.surface}`} role="status">
          <div className="flex items-start gap-2.5">
            <verdict.Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.4} />
            <div className="space-y-1">
              <p className="text-sm font-semibold">{verdict.headline}</p>
              {preview.criteria.reasons.length > 0 && (
                <ul className="space-y-0.5 text-[13px] leading-[1.5] opacity-80">
                  {preview.criteria.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
