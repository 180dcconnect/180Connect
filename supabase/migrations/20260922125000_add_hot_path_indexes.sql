-- Migration: add_hot_path_indexes
-- Sequence: no schema change — two indexes on existing columns.
-- Story: performance — intermittent slow page loads.
--
-- WHAT THIS DOES
--
-- Adds the two indexes that measurably change a query this app actually runs.
-- Both were measured on staging, before and after, in a rolled-back transaction.
--
-- 1. organisations (legal_name, id)
--
--    `/clients` orders by `legal_name, id` and takes one page. Without this the
--    planner reads every organisation and top-N heapsorts it:
--
--      before  Sort -> Seq Scan          2.56 ms   136 shared buffers
--      after   Index Scan                0.28 ms    25 shared buffers
--
--    The index supplies the rows already ordered, so the sort disappears
--    entirely. Note this is the *post-RLS-hoist* measurement (migrations
--    20260922123000/091000): before those, this sort was noise next to the
--    per-row security-qualifier cost, which is why it is fixed in that order.
--
-- 2. raw_source_records (matched_organisation_id)
--
--    `detect-field-discrepancies.ts` filters on this column
--    (`.eq("matched_organisation_id", organisationId)`) and it had no index, on
--    the largest table in the database (10,455 rows, 14MB):
--
--      before  Seq Scan     3.67 ms
--      after   Index Scan   0.04 ms
--
-- WHY NOT THE OTHER 37 UNINDEXED FOREIGN KEYS
--
-- Supabase's advisor reports 39 unindexed foreign keys. Thirty-seven of them are
-- `*_created_by` / `*_reviewed_by` / `*_resolved_by` / `*_decided_by` columns
-- that no query in `src/` ever filters or joins on — they exist to record who
-- did something, and are read back as part of a row that was found by another
-- column. Indexing them would add write cost to every insert on those tables and
-- buy nothing. The advisor is INFO-level for exactly this reason, and it already
-- reports 16 *unused* indexes on this database; adding 37 more would make that
-- worse, not better.
--
-- Two the advisor lists were checked and deliberately skipped:
-- `outreach_messages.contact_id` and `reply_events.contact_id` appear only in
-- `select` lists, never in a filter — the contact is then fetched by its own
-- primary key. One it lists is already covered: `audit_log.actor_user_id` has
-- `audit_log_actor_idx`.
--
-- `create index` rather than `create index concurrently`: the CLI runs each
-- migration in a transaction and `concurrently` cannot run inside one. At 2,738
-- and 10,455 rows the build takes a few milliseconds, so the brief
-- ACCESS EXCLUSIVE lock is not worth splitting the migration for. Revisit if
-- either table reaches the millions.

create index if not exists organisations_legal_name_id_idx
  on public.organisations (legal_name, id);

create index if not exists raw_source_records_matched_org_idx
  on public.raw_source_records (matched_organisation_id);
