"use client";

import Link from "next/link";
import { ArrowRight, Check, Info, TriangleAlert } from "lucide-react";

import type { CompanyPreview } from "@/lib/import/company-preview";
import type { ListedCompany } from "./import-result";

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

const VERDICT = {
  meets: {
    surface: "bg-go-wash text-go",
    Icon: Check,
    headline: "This company meets the client criteria and will join the client list.",
  },
  needs_review: {
    surface: "bg-hold-wash text-hold",
    Icon: TriangleAlert,
    headline: "This company will be imported and held for review, not added to the client list directly.",
  },
  does_not_meet: {
    surface: "bg-hold-wash text-hold",
    Icon: TriangleAlert,
    headline: "This company does not meet the client criteria, so importing will not add it.",
  },
} as const;

function formatTypeLabel(type: string, subtype?: string | null): string {
  if (subtype === "community-interest-company") return "Community Interest Company (CIC)";
  if (type === "cic") return "Community Interest Company (CIC)";
  if (type === "cio") return "Charitable Incorporated Organisation (CIO)";
  if (type === "social_enterprise") return "Social Enterprise";
  if (type === "company") return "Commercial Company";
  return type ? type.replace(/-/g, " ") : "Company";
}

function formatTierLabel(tier: string | null): string {
  if (tier === "A") return "Tier A · Definitive legal form";
  if (tier === "B") return "Tier B · Community Interest Company";
  if (tier === "C") return "Tier C · Mission-aligned SIC activity";
  return "Standard commercial company";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">{label}</dt>
      <dd className="mt-0.5 text-sm break-words text-ink">{children}</dd>
    </div>
  );
}

const NOT_ON_RECORD = <span className="text-faint">Not on the register</span>;

export function CompanyPreviewCard({
  preview,
  alreadyListed,
}: {
  preview: CompanyPreview;
  alreadyListed: ListedCompany | null;
}) {
  const verdict = VERDICT[preview.criteria.outcome];
  const { organisation, registration, tier } = preview;
  const location = [organisation.city, organisation.postcode].filter(Boolean).join(", ");

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-rule bg-white p-4">
        <p className="text-base font-semibold leading-tight text-ink">
          {organisation.legal_name || "This company has no name on the register"}
        </p>
        <p className="mt-1 text-[13px] text-dim">
          Company {preview.companyNumber}
          {registration.incorporatedOn ? ` · incorporated ${formatDate(registration.incorporatedOn)}` : ""}
          {preview.companySubtype ? ` · ${preview.companySubtype.replace(/-/g, " ")}` : ""}
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Type">
            {formatTypeLabel(organisation.organisation_type, preview.companySubtype)}
          </Field>
          <Field label="Status">
            <span className="capitalize">{registration.status}</span>
          </Field>
          <Field label="Location">{location || NOT_ON_RECORD}</Field>
          <Field label="Registered address">{organisation.address_line_1 || NOT_ON_RECORD}</Field>
          <Field label="Mission fit">{formatTierLabel(tier)}</Field>
          <Field label="SIC activities">
            {preview.sicCodes.length > 0 ? preview.sicCodes.join(", ") : NOT_ON_RECORD}
          </Field>
        </dl>
      </div>

      {!registration.isActive && (
        <div className="flex items-start gap-2.5 rounded-xl bg-stop-wash p-3 text-stop" role="alert">
          <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.4} />
          <p className="text-sm font-semibold">
            This company is {registration.status}
            {registration.dissolvedOn ? ` (${formatDate(registration.dissolvedOn)})` : ""}. It is not
            active on the Companies House register.
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
