-- Migration: scheduled_outreach_on_time
-- Story: F126 (#122) follow-up — scheduled emails leave at their time, not at
--   the next five-minute tick; and the cron jobs stop firing on the same second.
-- Sequence: addition. Not a numbered step — cron jobs are not rows in Data Model
--   tab 11, following 20260902120100_schedule_scheduled_outreach_cron.
--
-- ── 1. On time ──
--
-- scheduled_outreach_delivery fired every five minutes, so an email scheduled
-- for 20:17 went at 20:20 — and at 20:25 when that run failed. A new job,
-- scheduled_outreach_on_time, runs every 10 seconds (pg_cron >= 1.5 interval
-- syntax; staging runs 1.6.4) and calls the worker ONLY when an email has
-- become due. Deciding that in SQL keeps it cheap: the check is one indexed-
-- shaped read inside Postgres, and Vercel is invoked only when there is
-- something to send, so the app sees a handful of calls a day rather than
-- 8,640.
--
-- The check looks only at emails that became due in the last two minutes and
-- are not mid-send (no fresh claim). Two reasons for the window:
--   * An email the worker deliberately leaves scheduled — the F227 send-rate
--     limit or the daily cap, both transient by design — would otherwise match
--     forever and have this job call the worker every 10 seconds until the
--     window passed.
--   * A claimed email is being delivered right now; calling again would only
--     produce a lost claim.
-- Anything older than two minutes is the catch-all's job (below), so nothing is
-- ever stranded — it is just retried at the old cadence instead of hammered.
--
-- ── 2. The catch-all, and staggering ──
--
-- scheduled_outreach_delivery stays, unconditional, as the retry/backlog sweep
-- — but no longer on minute 0. gmail_reply_sync (*/5) and
-- three_sixty_giving_backfill (*/15) fired on the same minute as it, so every
-- quarter hour three jobs hit the REST gateway in the same second. Staging logs
-- showed 504 Gateway Timeout on trivial reads at exactly those instants
-- (a 406-row audit_log read, a 50-row scheduled lookup) while Postgres itself
-- logged nothing — the requests were queuing, not slow. Each job now has its
-- own minute:
--   scheduled_outreach_delivery   1,6,11,…  (1-59/5)
--   three_sixty_giving_backfill   9,24,39,54 (9-59/15)
-- None of those land on the hourly team digest (:05) or the 04:xx daily jobs.
--
-- ── 3. Replies within 30 seconds ──
--
-- gmail_reply_sync ran every five minutes, so a client's reply could take five
-- minutes (ten after a failed run) to reach the inbox. It now runs every 30
-- seconds. Safe to run that often: each run re-reads a fixed lookback window
-- and capture_gmail_reply dedupes on the Gmail message id (a repeat counts as a
-- duplicate and notifies nobody), and overlapping runs are resolved the same
-- way. Cost per run is one token refresh and one messages.list, plus a get per
-- candidate — far inside Gmail's per-user quota. An interval job has no fixed
-- wall-clock second, so it no longer piles onto the minute-0 instant either.
--
-- cron.schedule upserts by job name, so re-scheduling an existing job replaces
-- its schedule and command in place. The commands are unchanged from
-- 20260902120100, 20260912160100 and 20260923125000 — same vault secrets, same
-- Vercel protection bypass, same CRON_SECRET header.
--
-- REQUIRED ONE-TIME SETUP PER ENVIRONMENT: none — reuses the existing vault
-- secrets.
--
-- Schema change approval record (SOP §7):
--   Change        | One new cron.schedule job (scheduled_outreach_on_time, 10s,
--                 | conditional); new schedules for three existing jobs.
--   Reason        | F126 AC: a queued email is delivered at the chosen time.
--                 | Five-minute granularity plus same-second job collisions
--                 | delayed deliveries by up to ten minutes and failed every
--                 | Gmail reply sync run on staging.
--   Compatibility | No table, column, policy or function changes. Worker and
--                 | route handler unchanged; overlapping runs are already safe
--                 | through the per-message send claim.
--   Data migration| None.
--   Security      | Unchanged: the route checks CRON_SECRET before any work;
--                 | vault secrets are readable only by roles with vault access.
--   Documentation | Pending review by Bashir (Project Leader) in the PR.
--
-- Reversibility: paired rollback in
-- ../rollback/20261003120000_scheduled_outreach_on_time.down.sql

select cron.schedule(
  'scheduled_outreach_on_time',
  '10 seconds', -- conditional: calls the worker only when an email just became due
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'companies_house_cron_base_url')
      || '/api/cron/scheduled-outreach?x-vercel-protection-bypass='
      || (select decrypted_secret from vault.decrypted_secrets where name = 'vercel_protection_bypass'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  )
  where exists (
    select 1
      from public.outreach_messages m
     where m.send_status = 'scheduled'
       and m.scheduled_at <= now()
       and m.scheduled_at > now() - interval '2 minutes'
       and (m.send_claimed_at is null
            or m.send_claimed_at <= now() - public.send_claim_staleness_window())
  );
  $$
);

select cron.schedule(
  'scheduled_outreach_delivery',
  '1-59/5 * * * *', -- catch-all retry/backlog sweep, off minute 0
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'companies_house_cron_base_url')
      || '/api/cron/scheduled-outreach?x-vercel-protection-bypass='
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
  'gmail_reply_sync',
  '30 seconds', -- replies reach the inbox within half a minute; see section 3
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
  'three_sixty_giving_backfill',
  '9-59/15 * * * *', -- staggered off both five-minute jobs
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'companies_house_cron_base_url')
      || '/api/cron/three-sixty-giving-backfill?x-vercel-protection-bypass='
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
