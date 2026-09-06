-- Rollback for 20260922100000_schedule_provenance_audit_cron.sql.

select cron.unschedule('provenance_audit_daily');
