-- Migration: gmail_reply_check_and_cron_log_prune
-- Story: replies in the inbox within ~30 seconds, on the free plans.
-- Sequence: addition. Not a numbered step — cron jobs are not rows in Data Model
--   tab 11, following 20260912160100_schedule_gmail_reply_sync.
--
-- ── 1. gmail_reply_check, every 30 seconds ──
--
-- Polling Gmail from Vercel every few seconds is not affordable on Hobby: each
-- tick is a function invocation against a 4 CPU-hour monthly allowance shared
-- with the whole app, and exceeding it pauses the app. So the frequent check
-- runs in a Supabase Edge Function (supabase/functions/gmail-reply-check),
-- whose free allowance is separate: it lists the last couple of minutes of
-- inbox, compares the ids with what capture has already recorded, and calls
-- the Vercel reply sync ONLY when something new is there. Vercel sees one call
-- per actual reply, not 2,880 a day. Same gating idea as
-- scheduled_outreach_on_time.
--
-- Quota: 30 s = 86,400 invocations a month per project. The Free plan's
-- 500,000 is per ORGANISATION, so staging + production together use ~173k
-- (~35%). Raising the interval is a one-line re-schedule.
--
-- The Vercel base URL and protection bypass travel in the request body from
-- the existing vault secrets, so the function needs no copy of them.
--
-- ── 2. gmail_reply_sync becomes the safety net ──
--
-- Unchanged job, restaggered onto minutes 3,8,13,… so it no longer shares an
-- instant with scheduled_outreach_delivery (1,6,…). It keeps the full lookback,
-- which is what catches anything the 2-minute window above ever misses.
--
-- ── 3. cron_run_log_prune_daily ──
--
-- pg_cron writes one cron.job_run_details row per run and nothing ever
-- deletes them. The 10- and 30-second jobs alone add ~11,500 rows a day
-- against the Free plan's 500 MB database. Keep one day — enough to debug a
-- failing job, which is all the table is for. (pg_net prunes its own
-- net._http_response rows after six hours.)
--
-- REQUIRED ONE-TIME SETUP PER ENVIRONMENT (docs/gmail-reply-check.md):
--   * vault secret `supabase_project_url` = https://<project-ref>.supabase.co
--   * function secrets GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET,
--     GMAIL_REFRESH_TOKEN, CRON_SECRET (`supabase secrets set`)
-- Until the vault secret exists, job 1 selects no row and makes no request.
--
-- Reversibility: ../rollback/20261003150000_gmail_reply_check_and_cron_log_prune.down.sql

select cron.schedule(
  'gmail_reply_check',
  '30 seconds', -- conditional downstream: Vercel is called only for a new message
  $$
  select net.http_post(
    url := project.decrypted_secret || '/functions/v1/gmail-reply-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := jsonb_build_object(
      'appBaseUrl', (select decrypted_secret from vault.decrypted_secrets where name = 'companies_house_cron_base_url'),
      'vercelProtectionBypass', (select decrypted_secret from vault.decrypted_secrets where name = 'vercel_protection_bypass')
    ),
    timeout_milliseconds := 30000
  )
  from vault.decrypted_secrets as project
  where project.name = 'supabase_project_url';
  $$
);

select cron.schedule(
  'gmail_reply_sync',
  '3-59/5 * * * *', -- safety-net sweep, full lookback; off the 1,6,… delivery minutes
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'companies_house_cron_base_url')
      || '/api/cron/gmail-replies?x-vercel-protection-bypass='
      || (select decrypted_secret from vault.decrypted_secrets where name = 'vercel_protection_bypass'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);

select cron.schedule(
  'cron_run_log_prune_daily',
  '52 3 * * *', -- 03:52 UTC; clear of the 03:30/03:40 prunes and 03:47 watch renewal
  $$ delete from cron.job_run_details where end_time < now() - interval '1 day' $$
);
