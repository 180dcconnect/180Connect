-- Rollback: hard_no_files_suppression_request
-- Reverses 20260904090000_hard_no_files_suppression_request.sql (F153 AC2 wiring).
-- Pending requests the trigger already filed are deliberate records of real status
-- changes — dropped only here along with the mechanism, never by an up-path.

drop trigger if exists organisations_hard_no_suppression on public.organisations;
drop function if exists public.file_hard_no_suppression();
