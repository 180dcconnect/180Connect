-- Rollback for 20260923110000_schedule_provenance_audit_cron.sql.

select cron.unschedule('provenance_audit_daily');
