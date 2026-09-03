-- Migration: schedule_team_activity_digest_cron
-- Story: F176 (#172) — Team Activity Notifications.
-- Purpose: schedule the hourly team-activity digest sweep via pg_cron +
--   pg_net, calling the CRON_SECRET-protected route handler
--   (src/app/api/cron/team-activity-digest) that does the actual work.
--   Same convention as the stall-detection and reminder-notification sweeps
--   (20260912150000_schedule_stall_detection_cron.sql and the F175
--   equivalent), including the Vercel deployment-protection bypass query
--   param and reuse of the same three vault secrets.
--
-- HOURLY, NOT DAILY: F176 AC2 is this ticket's own resolution of its
--   "Noise control rules" blocker — team-activity notifications must be
--   batched rather than fired one per event. Hourly is the batching window:
--   frequent enough that a digest still feels current, infrequent enough
--   that a busy team doesn't get a notification every few minutes. Unlike
--   stall-detection/reminder-notifications, which only need to know "is
--   anything currently due" (a fact true on every run until it isn't),
--   team-activity notifications summarise what changed *since the last
--   run* — the sweep itself tracks that watermark in AUDIT_LOG
--   (`team_activity_digest_swept`), so a missed or delayed run just means a
--   larger batch next time, not a lost event.
--
-- REQUIRED ONE-TIME SETUP PER ENVIRONMENT: none beyond what
-- 20260809100400_schedule_companies_house_cron.sql already required — this
-- reuses the same three vault secrets, already created per environment.
--
-- Schema change approval record (SOP §7):
--   Change        | One cron.schedule(...) job calling net.http_post against
--                 | the new team-activity-digest cron route handler.
--   Reason        | F176 AC1: a teammate's logged action must eventually
--                 | reach every other active user as an in-app notification,
--                 | not only when they happen to be looking at the
--                 | dashboard's own Team Activity feed.
--   Compatibility | New scheduled job only. No table, grant or column
--                 | changes — create_notification (F173) and audit_log
--                 | writes via the service-role admin client are both
--                 | already-granted paths (matrix §3.19 / §3.8).
--   Data migration| None.
--   Security      | The route handler checks CRON_SECRET before doing any
--                 | work (401 otherwise) — see
--                 | src/app/api/cron/team-activity-digest/route.ts. The
--                 | sweep itself runs as service_role via the admin client.
--   Documentation | Reviewed as part of the F176 PR.
--
-- Reversibility: paired rollback in
-- ../rollback/20260913090000_schedule_team_activity_digest_cron.down.sql

select cron.schedule(
  'team_activity_digest_hourly',
  '5 * * * *', -- five minutes past every hour
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'companies_house_cron_base_url')
      || '/api/cron/team-activity-digest?x-vercel-protection-bypass='
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
