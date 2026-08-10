-- Migration: enable_cron_extensions
-- Sequence: addition (before schedule_companies_house_cron, which needs both).
-- Story: F032/F260 follow-on — automated Companies House discovery + status watch.
-- Purpose: enable the Postgres extensions the weekly cron schedule needs.
--   pg_cron -> in-database job scheduling (runs on the free plan, minute
--     granularity) — the already-documented direction for scheduled work in this
--     project (docs/open-questions.md Q-02), this is its first real use.
--   pg_net  -> async HTTP calls from SQL (net.http_post), how a pg_cron job reaches
--     the Next.js route handlers that do the actual import/recheck work.
--
-- Schema change approval record (SOP §7):
--   Change        | Enable pg_cron, pg_net extensions.
--   Reason        | Weekly automated Companies House discovery + status-recheck
--                 | (no cron/scheduling infrastructure existed in this project
--                 | before this feature — confirmed, no vercel.json crons array,
--                 | no pg_cron usage in any prior migration).
--   Compatibility | Project-wide capability addition. No impact on existing tables
--                 | or data. Neither extension is used by anything else yet.
--   Data migration| None.
--   Security      | Extensions only — no tables, no RLS surface. The jobs these
--                 | extensions later run (schedule_companies_house_cron.sql) call
--                 | CRON_SECRET-protected route handlers, not direct table writes.
--   Documentation | Approved by Bashir (Project Leader), 9 Aug 2026.
--
-- Reversibility: paired rollback in ../rollback/20260809100000_enable_cron_extensions.down.sql

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
