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

import { createThreeSixtyGivingAdapter, type OrganisationIdentifier } from "./sources/threesixtygiving.ts";
import { runIngestion } from "./runner.ts";
import { promotePendingThreeSixtyGivingRecords } from "../standardize/three-sixty-giving.ts";
import { buildAdminClient } from "../supabase/admin-client-factory.ts";
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

  return {
    async loadDueOrganisations(limit, cutoffIso) {
      // `nulls first` matches organisations_grants_fetched_at_idx, so this is an
      // index scan rather than a sort of the whole table. Organisations with no
      // registry identifier are selected too, and stamped like any other — see
      // drainBackfillQueue for why that is the correct outcome rather than an
      // oversight.
      const { data, error } = await supabase
        .from("organisations")
        .select("id")
        .or(`grants_fetched_at.is.null,grants_fetched_at.lt.${JSON.stringify(cutoffIso)}`)
        .order("grants_fetched_at", { ascending: true, nullsFirst: true })
        .limit(limit);

      if (error) throw new Error(`Could not load the grants backfill queue: ${error.message}`);
      return (data ?? []).map((row) => (row as { id: string }).id);
    },

    async loadIdentifiersFor(organisationIds) {
      if (organisationIds.length === 0) return [];
      const { data, error } = await supabase
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
      const { error } = await supabase
        .from("organisations")
        .update({ grants_fetched_at: fetchedAtIso })
        .in("id", organisationIds);

      if (error) throw new Error(`Could not record the grants fetch: ${error.message}`);
    },

    async countRemaining(cutoffIso) {
      const [due, total] = await Promise.all([
        supabase
          .from("organisations")
          .select("id", { count: "exact", head: true })
          .or(`grants_fetched_at.is.null,grants_fetched_at.lt.${JSON.stringify(cutoffIso)}`),
        supabase.from("organisations").select("id", { count: "exact", head: true }),
      ]);

      if (due.error) throw new Error(`Could not count the queue: ${due.error.message}`);
      if (total.error) throw new Error(`Could not count organisations: ${total.error.message}`);
      return { due: due.count ?? 0, total: total.count ?? 0 };
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
 * cheap: an idle run costs one counting query and no API calls at all.
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
