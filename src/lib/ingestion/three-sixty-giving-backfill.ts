/**
 * The 360Giving backfill queue, and the job that drains it.
 *
 * ── Why a queue rather than a walk ──
 *
 * 360Giving enrichment asks one question per organisation we already hold, so
 * the work is O(our client list). 360Giving documents a limit of 2 requests per
 * second and the adapter paces at 600ms, which puts a full pass over the 1,915
 * identifiers on staging at roughly 16 minutes. The platform ceiling is 300
 * seconds.
 *
 * That gap cannot be closed by raising a timeout — 300s buys a few hundred
 * organisations, the floor belongs to someone else's rate limit, and every
 * import widens the gap. Nor by concurrency: the limit is per user, so parallel
 * requests earn 429s, not throughput.
 *
 * So the pass becomes resumable. `organisations.grants_fetched_at` is the
 * cursor: null means never asked, a timestamp means asked at that moment. Each
 * run takes the oldest slice that fits comfortably inside one invocation, walks
 * it, and stamps it. Nothing else has to remember anything.
 *
 * ── Failure is a no-op, on purpose ──
 *
 * Organisations are stamped only *after* their batch has been fetched and
 * promoted. A run that dies halfway stamps nothing, so the next run picks up the
 * same slice. Re-fetching is close to free — the ingestion runner deduplicates
 * by payload checksum, so a repeated grant is skipped rather than rewritten.
 *
 * Choosing the opposite (stamp first, fetch after) would lose organisations
 * silently on any crash, and losing them is invisible: an organisation with no
 * grants and an organisation never asked about look identical on screen.
 */

import { z } from "zod";

import { createThreeSixtyGivingAdapter, type OrganisationIdentifier } from "./sources/threesixtygiving.ts";
import { runIngestion } from "./runner.ts";
import { promotePendingThreeSixtyGivingRecords } from "../standardize/three-sixty-giving.ts";
import { buildAdminClient } from "../supabase/admin-client-factory.ts";
import { boundedInt, safeValidate } from "../validation.ts";
import type { RunTrigger } from "./type.ts";

/**
 * How many organisations one run walks.
 *
 * Arithmetic, not taste: the adapter sleeps 600ms after each organisation and
 * the request itself costs a few hundred milliseconds more, so roughly one
 * second each. At 200 that is around 200 seconds of fetching inside a 300s
 * ceiling, leaving headroom for promotion and the writes.
 *
 * Deliberately small and frequent rather than large and rare. A big batch that
 * overruns loses the whole batch; a small one that overruns loses little, and
 * the schedule catches up within the hour.
 */
export const BACKFILL_BATCH_SIZE = 200;

/**
 * How many organisations the admin "Run the next batch now" button walks.
 *
 * Deliberately much smaller than BACKFILL_BATCH_SIZE. The button runs as a
 * Server Action behind `useActionState`, which only has a pending boolean —
 * no progress events — so a 200-org slice (~3 minutes of 600ms-paced
 * requests) looks exactly like a hung button. At ~1s per organisation, 25
 * finishes in under ~30s, inside what anyone will wait for a button, while
 * the 15-minute cron keeps draining 200 a slice in the background.
 */
export const MANUAL_BACKFILL_BATCH_SIZE = 25;

/**
 * Largest slice the admin button may take in one press.
 *
 * Arithmetic, not taste: at ~1s per organisation, 100 is around two minutes
 * of fetching inside a 300s ceiling — the most anyone should wait behind a
 * button, even one with a live count. Anything bigger belongs to the
 * 15-minute schedule, which drains BACKFILL_BATCH_SIZE a slice unattended.
 */
export const MANUAL_BACKFILL_MAX = 100;

const manualBatchSchema = z.object({
  batchSize: boundedInt(1, MANUAL_BACKFILL_MAX),
});

/**
 * Reads the admin button's requested slice size (a FormData string) and
 * clamps it to the safe range. Anything missing, malformed or out of range —
 * including a tampered value above the max — falls back to the default
 * rather than erroring: every value in 1..MAX is safe to run, so there is
 * nothing worth rejecting loudly here.
 */
export function resolveManualBatchSize(input: unknown): number {
  const parsed = safeValidate(manualBatchSchema, { batchSize: input });
  return parsed.success ? parsed.data.batchSize : MANUAL_BACKFILL_BATCH_SIZE;
}

/**
 * How long a fetched answer stays good.
 *
 * Grants are published by funders in their own time and are historical once
 * published, so this is about catching new awards rather than corrections. 90
 * days keeps the steady-state load trivial — 1,915 organisations spread over 90
 * days is around 21 a day, which one run absorbs without noticing.
 */
export const REFETCH_AFTER_DAYS = 90;

/** The registry identifier types 360Giving can be asked about. */
const WALKABLE_TYPES = ["uk_charity", "uk_company"] as const;

export type QueuedOrganisation = {
  organisationId: string;
  identifiers: OrganisationIdentifier[];
};

/** The two columns the queue reads to decide what is due. */
export type OrgFetchState = {
  id: string;
  grants_fetched_at: string | null;
};

/**
 * Picks the next slice of the queue out of already-fetched states.
 *
 * Pure so it is testable without a database: the store fetches, this decides.
 * Suppressed (opted-out) organisations are out — they sit outside the outreach
 * pool the dashboard's Total Organisations reports
 * (`filterActiveSuppressed` in dashboard-metrics.ts), so counting or checking
 * them here would push this page's total above that number. Never-checked
 * (null) rows come first, then oldest first, matching the nulls-first index
 * ordering the SQL version relied on.
 */
export function selectDueOrganisations(
  states: OrgFetchState[],
  suppressedIds: ReadonlySet<string>,
  cutoffIsoValue: string,
  limit: number,
): string[] {
  const due = states.filter(
    (row) =>
      !suppressedIds.has(row.id) &&
      (row.grants_fetched_at === null || row.grants_fetched_at < cutoffIsoValue),
  );
  due.sort((a, b) => {
    if (a.grants_fetched_at === null && b.grants_fetched_at === null) return 0;
    if (a.grants_fetched_at === null) return -1;
    if (b.grants_fetched_at === null) return 1;
    if (a.grants_fetched_at === b.grants_fetched_at) return 0;
    return a.grants_fetched_at < b.grants_fetched_at ? -1 : 1;
  });
  return due.slice(0, limit).map((row) => row.id);
}

export type BackfillStore = {
  loadDueOrganisations(limit: number, cutoffIso: string): Promise<string[]>;
  loadIdentifiersFor(organisationIds: string[]): Promise<
    Array<{ organisation_id: string; identifier_type: string; identifier_value: string }>
  >;
  markFetched(organisationIds: string[], fetchedAtIso: string): Promise<void>;
  countRemaining(cutoffIso: string): Promise<{ due: number; total: number }>;
};

export function createDefaultBackfillStore(): BackfillStore | null {
  const supabase = buildAdminClient();
  if (!supabase) return null;
  // Narrowed once for the closures below, which the guard above does not reach.
  const db = supabase;

  // Organisations with no registry identifier are selected too, and stamped
  // like any other — see drainBackfillQueue for why that is the correct
  // outcome rather than an oversight. Organisations under an active
  // suppression are not selected at all: they are out of the outreach pool,
  // so checking them would spend lookups on clients nobody may contact.
  async function loadFetchStates(): Promise<OrgFetchState[]> {
    const all: OrgFetchState[] = [];
    const step = 1000;
    for (let from = 0; ; from += step) {
      const { data, error } = await db
        .from("organisations")
        .select("id, grants_fetched_at")
        .order("id", { ascending: true })
        .range(from, from + step - 1);

      if (error) throw new Error(`Could not load the grants backfill queue: ${error.message}`);
      const page = (data ?? []) as OrgFetchState[];
      all.push(...page);
      if (page.length < step) break;
    }
    return all;
  }

  async function loadSuppressedIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    const step = 1000;
    for (let from = 0; ; from += step) {
      const { data, error } = await db
        .from("suppressions")
        .select("organisation_id")
        .eq("status", "active")
        .order("organisation_id", { ascending: true })
        .range(from, from + step - 1);

      if (error) throw new Error(`Could not load suppressed organisations: ${error.message}`);
      const page = (data ?? []) as Array<{ organisation_id: string }>;
      for (const row of page) ids.add(row.organisation_id);
      if (page.length < step) break;
    }
    return ids;
  }

  return {
    async loadDueOrganisations(limit, cutoffIso) {
      const [states, suppressed] = await Promise.all([loadFetchStates(), loadSuppressedIds()]);
      return selectDueOrganisations(states, suppressed, cutoffIso, limit);
    },

    async loadIdentifiersFor(organisationIds) {
      if (organisationIds.length === 0) return [];
      const { data, error } = await db
        .from("organisation_identifiers")
        .select("organisation_id, identifier_type, identifier_value")
        .in("organisation_id", organisationIds)
        .in("identifier_type", [...WALKABLE_TYPES]);

      if (error) throw new Error(`Could not load identifiers for the batch: ${error.message}`);
      return (data ?? []) as Array<{
        organisation_id: string;
        identifier_type: string;
        identifier_value: string;
      }>;
    },

    async markFetched(organisationIds, fetchedAtIso) {
      if (organisationIds.length === 0) return;
      const { error } = await db
        .from("organisations")
        .update({ grants_fetched_at: fetchedAtIso })
        .in("id", organisationIds);

      if (error) throw new Error(`Could not record the grants fetch: ${error.message}`);
    },

    async countRemaining(cutoffIso) {
      const [states, suppressed] = await Promise.all([loadFetchStates(), loadSuppressedIds()]);
      const live = states.filter((row) => !suppressed.has(row.id));
      const due = live.filter(
        (row) => row.grants_fetched_at === null || row.grants_fetched_at < cutoffIso,
      ).length;
      return { due, total: live.length };
    },
  };
}

export function cutoffIso(now: Date, days: number = REFETCH_AFTER_DAYS): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

export type BackfillResult = {
  /** Organisations taken off the queue by this run. */
  walked: number;
  /** Of those, how many carried a registry identifier worth asking about. */
  asked: number;
  grantsFound: number;
  grantsMatched: number;
  /** Still due after this run — what the admin progress card counts down. */
  remaining: number;
  total: number;
};

/**
 * Runs one slice of the queue.
 *
 * Returns without touching the network when nothing is due, which is the normal
 * outcome once the queue has drained. That is what makes a frequent schedule
 * cheap: an idle run costs a few light queries and no API calls at all.
 */
export async function drainBackfillQueue(
  options: {
    store?: BackfillStore | null;
    batchSize?: number;
    now?: Date;
    trigger?: RunTrigger;
    /**
     * Injected for tests, exactly as `store` is. The queue's decisions — what to
     * take, when to stamp, what to stamp on failure — are the part worth testing,
     * and they should be testable without reaching 360Giving.
     */
    fetchAndPromote?: (identifiers: OrganisationIdentifier[]) => Promise<{
      grantsFound: number;
      grantsMatched: number;
    }>;
  } = {},
): Promise<BackfillResult> {
  const store = options.store ?? createDefaultBackfillStore();
  if (!store) {
    throw new Error("Supabase admin client is not configured — check SUPABASE_SERVICE_ROLE_KEY.");
  }

  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? BACKFILL_BATCH_SIZE;
  const cutoff = cutoffIso(now);

  const due = await store.loadDueOrganisations(batchSize, cutoff);
  if (due.length === 0) {
    const { due: remaining, total } = await store.countRemaining(cutoff);
    return { walked: 0, asked: 0, grantsFound: 0, grantsMatched: 0, remaining, total };
  }

  const identifierRows = await store.loadIdentifiersFor(due);
  const identifiers: OrganisationIdentifier[] = identifierRows.map((row) => ({
    identifier_type: row.identifier_type,
    identifier_value: row.identifier_value,
  }));

  let grantsFound = 0;
  let grantsMatched = 0;

  if (identifiers.length > 0) {
    const run =
      options.fetchAndPromote ??
      (async (batch: OrganisationIdentifier[]) => {
        // The adapter already knows how to pace, paginate and deduplicate a walk;
        // all this job changes is *which* identifiers it is given. Passing a
        // bounded slice is the whole of the fix.
        const [summary] = await runIngestion(
          [createThreeSixtyGivingAdapter({ loadIdentifiers: async () => batch })],
          options.trigger ?? { triggeredBy: "schedule" },
        );
        const found = summary?.counts.inserted ?? 0;
        const matched = found > 0 ? (await promotePendingThreeSixtyGivingRecords()).matched : 0;
        return { grantsFound: found, grantsMatched: matched };
      });

    const outcome = await run(identifiers);
    grantsFound = outcome.grantsFound;
    grantsMatched = outcome.grantsMatched;
  }

  // Stamped only now, and stamped for every organisation in the slice — including
  // those with no registry identifier. "We have nothing to ask 360Giving with" is
  // a settled answer, not an unanswered question, and leaving those rows null
  // would park them at the head of the queue forever, starving every organisation
  // behind them.
  await store.markFetched(due, now.toISOString());

  const { due: remaining, total } = await store.countRemaining(cutoff);

  return {
    walked: due.length,
    asked: identifiers.length,
    grantsFound,
    grantsMatched,
    remaining,
    total,
  };
}
