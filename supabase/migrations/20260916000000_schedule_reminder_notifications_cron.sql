-- Migration: schedule_reminder_notifications_cron
-- Story: F175 (#171) — Reminder Notifications.
-- Purpose: schedule the daily reminder-notification sweep via pg_cron +
--   pg_net, calling the CRON_SECRET-protected route handler
--   (src/app/api/cron/reminder-notifications) that does the actual work.
--   Same convention as the stall-detection sweep
--   (20260912150000_schedule_stall_detection_cron.sql) and the other daily/
--   scheduled jobs before it, including the Vercel deployment-protection
--   bypass query param and reuse of the same three vault secrets.
--
-- Daily, not five-minute like scheduled-outreach: F160's own thresholds are
-- day-granularity (7/14 days by default), so nothing is gained by checking
-- more often than once a day — a reminder becoming due does not need
-- sub-daily precision the way a scheduled send does. Offset five minutes
-- from stall-detection's own daily run (04:17 UTC) so the two sweeps don't
-- contend for the same quiet window.
--
-- REQUIRED ONE-TIME SETUP PER ENVIRONMENT: none beyond what
-- 20260809100400_schedule_companies_house_cron.sql already required — this
-- reuses the same three vault secrets, already created per environment.
--
-- Schema change approval record (SOP §7):
--   Change        | One cron.schedule(...) job calling net.http_post against
--                 | the new reminder-notifications cron route handler.
--   Reason        | F175 AC1: a follow-up recommendation becoming due must
--                 | produce an in-app notification automatically, not only
--                 | when a CAM happens to open the dashboard.
--   Compatibility | New scheduled job only. No table, grant or column
--                 | changes — create_notification (F173) and audit_log
--                 | writes via the service-role admin client are both
--                 | already-granted paths (matrix §3.19 / §3.8).
--   Data migration| None.
--   Security      | The route handler checks CRON_SECRET before doing any
--                 | work (401 otherwise) — see
--                 | src/app/api/cron/reminder-notifications/route.ts. The
--                 | sweep itself runs as service_role via the admin client.
--   Documentation | Reviewed as part of the F175 PR.
--
-- Reversibility: cron.unschedule('reminder_notifications_daily').

select cron.schedule(
  'reminder_notifications_daily',
  '22 4 * * *', -- daily 04:22 UTC — five minutes after stall_detection_daily
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'companies_house_cron_base_url')
      || '/api/cron/reminder-notifications?x-vercel-protection-bypass='
      || (select decrypted_secret from vault.decrypted_secrets where name = 'vercel_protection_bypass'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
