-- Migration: add_grants_fetch_tracking
-- Sequence: no new step in Data Model tab "11 Supabase Migration Sequence" —
--   this adds one nullable column to ORGANISATIONS, created at step 4.0.
-- Story: making 360Giving enrichment finish. It could not, and the reason was
--   arithmetic rather than a bug.
--
-- WHY THIS COLUMN EXISTS
--
-- The 360Giving adapter enriches organisations we already hold: for each known
-- uk_charity/uk_company identifier it asks the API what grants that organisation
-- has received. Cost is therefore O(our client list), not O(their dataset).
--
-- That walk was written as one all-or-nothing pass behind an admin button, and
-- the button cannot finish it:
--
--   * 360Giving documents a limit of 2 requests per second, so the adapter paces
--     at 600ms (REQUEST_INTERVAL_MS in src/lib/ingestion/sources/threesixtygiving.ts).
--   * There are 1,915 uk_charity/uk_company identifiers on staging today.
--   * 1,915 x 600ms is roughly 16 minutes of unavoidable wall time.
--   * The Vercel ceiling is 300 seconds.
--
-- Raising maxDuration does not fix this. 300s buys ~500 identifiers, the floor
-- is set by someone else's rate limit rather than by our code, and the gap grows
-- every time an import adds organisations. Concurrency does not help either: the
-- limit is per user, so parallel requests earn 429s rather than throughput.
--
-- So the walk stops being one pass and becomes a queue that drains. This column
-- is the queue.
--
--   null            never asked about this organisation -> queued
--   <timestamp>     asked at that moment; re-queued once it is old enough
--
-- Null is deliberately the default, so an organisation created by any import is
-- queued by existing behaviour rather than by anything the import has to
-- remember to do. There is no second place that can forget.
--
-- WHY NOT A SEPARATE QUEUE TABLE
--
-- The queue is a property of an organisation ("when did we last ask about this
-- one"), not an entity in its own right. A table would need a row per
-- organisation, kept in step with organisations on insert and delete, to hold
-- one nullable timestamp. The column cascades on delete for free and cannot
-- drift out of step with the thing it describes.
--
-- WHAT IT IS NOT
--
-- Not a record of whether an organisation *has* grants — GRANTS answers that,
-- and "asked, found nothing" is both common and useful to remember. An
-- organisation with no grants still gets a timestamp, which is what stops the
-- queue asking about it again tomorrow.
--
-- Not an audit-logged field. It records that a public API was read, changes no
-- ownership, status, role or approval state, and is written only by the
-- ingestion path (docs/audit-log-pattern.md governs the other kind).
--
-- Schema change approval record (SOP §7):
--   Change        | 1 nullable timestamptz column + 1 partial index on
--                 | ORGANISATIONS.
--   Reason        | The 360Giving walk needs ~16 minutes against a 300s
--                 | platform ceiling, so it must resume across invocations.
--                 | This column is where it resumes from.
--   Compatibility | Additive and nullable. Nothing reads it before the backfill
--                 | job added in the same commit; every existing row reads as
--                 | "never fetched", which is true.
--   Data migration| None. Existing rows stay null on purpose — we do not know
--                 | which organisations the August walk actually reached, and
--                 | claiming a fetch that may not have happened would hide
--                 | organisations from the queue permanently.
--   Security      | No new data. RLS on ORGANISATIONS is unchanged and already
--                 | covers this column; no column-level grants exist on the
--                 | table, so nothing is widened.
--   Documentation | Data Model tab "04 Entities" gains one field on
--                 | ORGANISATIONS. Run npm run export:data-model.
--   Approved by   | Bashir (Project Leader).
--
-- Reversibility: paired rollback in
-- ../rollback/20260923124000_add_grants_fetch_tracking.down.sql

alter table public.organisations
  add column if not exists grants_fetched_at timestamptz;

comment on column public.organisations.grants_fetched_at is
  'When 360Giving was last asked what grants this organisation has received. '
  'Null means never asked, which is what queues it for the backfill job. A '
  'timestamp means asked and answered — including answered with nothing, which '
  'is why it is set even when no grants were found.';

-- The backfill job asks one question: "which organisations are due?", ordered
-- oldest-first with nulls ahead of every timestamp. `nulls first` matches that
-- ordering exactly so the queue drain is an index scan rather than a sort over
-- the whole table.
create index if not exists organisations_grants_fetched_at_idx
  on public.organisations (grants_fetched_at nulls first);
