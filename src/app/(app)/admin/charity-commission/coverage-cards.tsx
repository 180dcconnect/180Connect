import type { SupabaseClient } from "@supabase/supabase-js";

import { SkeletonSectionCard } from "@/components/ui/skeleton";
import { reportError } from "@/lib/error-logging";
import {
  findBackfillTargets,
  MAX_BACKFILL,
} from "@/lib/charity-register/annual-return-backfill";
import {
  findCompanyNumberTargets,
  MAX_BACKFILL as MAX_COMPANY_BACKFILL,
} from "@/lib/charity-register/company-number-backfill";
import type { CharityIdentifierRow } from "@/lib/charity-register/coverage-reads";
import type {
  CoverageKind,
  CoverageSnapshot,
} from "@/lib/charity-register/coverage-snapshots";
import {
  findProfileTargets,
  MAX_BACKFILL as MAX_PROFILE_BACKFILL,
} from "@/lib/charity-register/profile-backfill";
import {
  findReachTargets,
  MAX_BACKFILL as MAX_REACH_BACKFILL,
} from "@/lib/charity-register/reach-backfill";
import { AnnualReturnCard } from "./annual-return-card";
import { CompanyNumberCard } from "./company-number-card";
import { RegisterProfileCard } from "./profile-card";
import { GeographicReachCard } from "./reach-card";

type CoverageCardProps = {
  admin: SupabaseClient;
  identifiers: Promise<CharityIdentifierRow[]>;
  readOnly: boolean;
};

/**
 * The normal path: render four persisted readings without doing any work.
 * Blank seeded rows are omitted until the after-response refresh has produced
 * a truthful value; a zero must never masquerade as a measurement.
 */
export function SnapshotCoverageCards({
  snapshots,
  readOnly,
}: {
  snapshots: ReadonlyMap<CoverageKind, CoverageSnapshot>;
  readOnly: boolean;
}) {
  const annualReturn = completeSnapshot(snapshots.get("annual_return"));
  const profile = completeSnapshot(snapshots.get("profile"));
  const reach = completeSnapshot(snapshots.get("reach"));
  const companyNumber = completeSnapshot(snapshots.get("company_number"));

  return (
    <>
      {annualReturn && annualReturn.charities > 0 && (
        <AnnualReturnCard
          charities={annualReturn.charities}
          covered={annualReturn.covered}
          pending={annualReturn.pending}
          pendingPeriods={annualReturn.pendingItems ?? 0}
          maxBatchSize={MAX_BACKFILL}
          readOnly={readOnly}
        />
      )}
      {profile && profile.charities > 0 && (
        <RegisterProfileCard
          charities={profile.charities}
          covered={profile.covered}
          pending={profile.pending}
          pendingFields={profile.pendingItems ?? 0}
          maxBatchSize={MAX_PROFILE_BACKFILL}
          readOnly={readOnly}
        />
      )}
      {reach && reach.charities > 0 && (
        <GeographicReachCard
          charities={reach.charities}
          covered={reach.covered}
          pending={reach.pending}
          maxBatchSize={MAX_REACH_BACKFILL}
          readOnly={readOnly}
        />
      )}
      {companyNumber && companyNumber.charities > 0 && (
        <CompanyNumberCard
          charities={companyNumber.charities}
          covered={companyNumber.covered}
          pending={companyNumber.pending}
          maxBatchSize={MAX_COMPANY_BACKFILL}
          readOnly={readOnly}
        />
      )}
    </>
  );
}

function completeSnapshot(snapshot: CoverageSnapshot | undefined): {
  charities: number;
  covered: number;
  pending: number;
  pendingItems: number | null;
} | null {
  if (
    !snapshot ||
    snapshot.calculatedAt === null ||
    snapshot.charities === null ||
    snapshot.covered === null ||
    snapshot.pending === null
  ) {
    return null;
  }
  return {
    charities: snapshot.charities,
    covered: snapshot.covered,
    pending: snapshot.pending,
    pendingItems: snapshot.pendingItems,
  };
}

/**
 * Rolling-deployment fallback only. Once the snapshot migration exists, the
 * page renders `SnapshotCoverageCards` above and these live whole-book readers
 * disappear from the request path. Until then, Suspense still lets the history
 * paint first and all four readers share one identifier scan.
 */
export async function AnnualReturnCoverageCard({
  admin,
  identifiers,
  readOnly,
}: CoverageCardProps) {
  const coverage = await annualReturnCoverageFor(admin, identifiers);
  if (!coverage || coverage.charities === 0) return null;

  return (
    <AnnualReturnCard
      charities={coverage.charities}
      covered={coverage.covered}
      pending={coverage.pending}
      pendingPeriods={coverage.pendingPeriods}
      maxBatchSize={MAX_BACKFILL}
      readOnly={readOnly}
    />
  );
}

export async function RegisterProfileCoverageCard({
  admin,
  identifiers,
  readOnly,
}: CoverageCardProps) {
  const coverage = await registerProfileCoverageFor(admin, identifiers);
  if (!coverage || coverage.charities === 0) return null;

  return (
    <RegisterProfileCard
      charities={coverage.charities}
      covered={coverage.covered}
      pending={coverage.pending}
      pendingFields={coverage.pendingFields}
      maxBatchSize={MAX_PROFILE_BACKFILL}
      readOnly={readOnly}
    />
  );
}

export async function GeographicReachCoverageCard({
  admin,
  identifiers,
  readOnly,
}: CoverageCardProps) {
  const coverage = await geographicReachCoverageFor(admin, identifiers);
  if (!coverage || coverage.charities === 0) return null;

  return (
    <GeographicReachCard
      charities={coverage.charities}
      covered={coverage.covered}
      pending={coverage.pending}
      maxBatchSize={MAX_REACH_BACKFILL}
      readOnly={readOnly}
    />
  );
}

export async function CompanyNumberCoverageCard({
  admin,
  identifiers,
  readOnly,
}: CoverageCardProps) {
  const coverage = await companyNumberCoverageFor(admin, identifiers);
  if (!coverage || coverage.charities === 0) return null;

  return (
    <CompanyNumberCard
      charities={coverage.charities}
      covered={coverage.covered}
      pending={coverage.pending}
      maxBatchSize={MAX_COMPANY_BACKFILL}
      readOnly={readOnly}
    />
  );
}

async function annualReturnCoverageFor(admin: SupabaseClient, identifiers: Promise<CharityIdentifierRow[]>) {
  try {
    return (await findBackfillTargets(admin, undefined, await identifiers)).coverage;
  } catch (error) {
    await reportError(error, { operation: "admin.charity_commission.annual_return_coverage" });
    return null;
  }
}

async function registerProfileCoverageFor(
  admin: SupabaseClient,
  identifiers: Promise<CharityIdentifierRow[]>,
) {
  try {
    return (await findProfileTargets(admin, undefined, await identifiers)).coverage;
  } catch (error) {
    await reportError(error, { operation: "admin.charity_commission.register_profile_coverage" });
    return null;
  }
}

async function geographicReachCoverageFor(
  admin: SupabaseClient,
  identifiers: Promise<CharityIdentifierRow[]>,
) {
  try {
    return (await findReachTargets(admin, undefined, await identifiers)).coverage;
  } catch (error) {
    await reportError(error, { operation: "admin.charity_commission.reach_coverage" });
    return null;
  }
}

async function companyNumberCoverageFor(
  admin: SupabaseClient,
  identifiers: Promise<CharityIdentifierRow[]>,
) {
  try {
    return (await findCompanyNumberTargets(admin, undefined, undefined, await identifiers)).coverage;
  } catch (error) {
    await reportError(error, { operation: "admin.charity_commission.company_number_coverage" });
    return null;
  }
}

/** Matches the shape of a coverage card without offering a temporary control. */
export function CoverageCardFallback() {
  return (
    <SkeletonSectionCard titleWidth="w-52" titleHeight="h-[25px]" hintWidth="w-80">
      <div className="mt-5 space-y-4">
        <div className="h-9 w-40 animate-pulse rounded bg-rule-soft" />
        <div className="h-2.5 w-full animate-pulse rounded-full bg-rule-soft" />
      </div>
    </SkeletonSectionCard>
  );
}
