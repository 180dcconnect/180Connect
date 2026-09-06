-- Rollback for 20260922131000_add_cic_community_statement.sql
--
-- Unlike the SIC rollback beside it, dropping these columns IS a loss of
-- record: the statement text exists nowhere else in the platform. It came from
-- a Companies House document that is never stored, and reproducing it means
-- re-fetching every filing and re-running OCR — hours of work, and the OCR is
-- not guaranteed to transcribe identically the second time.
--
-- Recoverable, then, but not cheaply and not exactly. Re-running the backfill
-- after this rollback is re-forward, not restore.

drop index if exists public.organisations_cic_statement_checked_at_idx;

alter table public.organisations
  drop column if exists cic_community_statement,
  drop column if exists cic_statement_checked_at;
