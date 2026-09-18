# Reply sync every 30 seconds (gmail-reply-check)

How a client's reply reaches `/inbox` within about half a minute on the free
Vercel and Supabase plans, and the one-time setup per environment.

## How it works

```
pg_cron gmail_reply_check (every 30 s)
  → Supabase Edge Function gmail-reply-check
      Gmail: list inbox, last 2 minutes          (1 call; token reused ~1 h)
      audit_log: which of those ids do we know?  (1 read)
      nothing new → stop                         (almost every tick)
      new id      → POST Vercel /api/cron/gmail-replies?sinceMinutes=5
                      → capture_gmail_reply → reply_events
                      → Realtime → inbox refreshes itself
pg_cron gmail_reply_sync (every 5 min, full lookback) → safety net
pg_cron cron_run_log_prune_daily → keeps cron.job_run_details to one day
```

### Why not just poll Vercel every 30 s?

- **CPU budget:** Vercel Hobby includes 4 Active CPU-hours a month for the whole
  app. Going over pauses functions for up to 30 days.
- **Where the load lands:** a pg_cron job is only a timer; the work runs wherever
  its URL points. So the frequent check runs in Supabase, whose Edge Function
  allowance is separate, and Vercel is called about once per real reply.

### Why not Gmail push?

Push needs Pub/Sub IAM grants in the Google Cloud project that owns the Gmail
OAuth client, which the global team administers. It was built and then removed:
besides the IAM block, its webhook and watch-renewal routes took the deployment
past Vercel Hobby's 12-function limit (the app sat at 11). Anything that adds an
API route should be checked against that limit first.

## Quota

| | Per project | Staging + production |
| --- | --- | --- |
| Invocations / month at 30 s | 86,400 | **172,800** |
| Free plan allowance | — | 500,000 **per organisation** |
| Share used | — | ~35% |

Supabase applies free-plan quotas "to your entire organization, independent of
how many projects you launch within that organization". Staging and production
therefore share the one allowance. Nothing else in the repo uses Edge Functions
today.

To slow it down, re-schedule in a new migration:

```sql
select cron.alter_job(
  (select jobid from cron.job where jobname = 'gmail_reply_check'),
  schedule := '60 seconds'
);
```

At 60 s, both environments together use ~86k a month (~17%).

**Check actual usage:** Supabase dashboard → Organization → **Usage** → Edge
Function Invocations.

## One-time setup (per environment)

Staging project ref: `cgbfhhdeapasniudyyds`. Run from the repo root, logged in
with `supabase login`.

### 1. Function secrets

Use the same values as that environment's Vercel env vars.

```bash
supabase secrets set --project-ref cgbfhhdeapasniudyyds \
  GMAIL_CLIENT_ID='<value>' \
  GMAIL_CLIENT_SECRET='<value>' \
  GMAIL_REFRESH_TOKEN='<value>' \
  CRON_SECRET='<same as Vercel and the cron_secret vault entry>'
```

### 2. Vault secret: the project URL

pg_cron reads the function URL from here. Run in Dashboard → SQL Editor for
that project:

```sql
select vault.create_secret('https://cgbfhhdeapasniudyyds.supabase.co', 'supabase_project_url');
```

Until this secret exists, the job runs but sends nothing.

### 3. Deploy the function

- **Automatic:** `.github/workflows/edge-functions.yml` deploys on push to `dev`
  (staging) and `main` (production). The workflow only exists on GitHub once it
  reaches `dev`.
- **By hand**, before then:

```bash
supabase functions deploy gmail-reply-check --project-ref cgbfhhdeapasniudyyds --use-api
```

`--use-api` bundles on Supabase's side, so Docker is not needed.

`verify_jwt = false` in `supabase/config.toml` is deliberate. pg_cron
authenticates with `CRON_SECRET`, which the function checks itself.

### 4. Verify

1. **Test call:**

   ```bash
   curl -X POST https://cgbfhhdeapasniudyyds.supabase.co/functions/v1/gmail-reply-check \
     -H "Authorization: Bearer <CRON_SECRET>" -H "Content-Type: application/json" \
     -d '{"appBaseUrl":"https://<staging-host>","vercelProtectionBypass":"<bypass>"}'
   # → {"listed":0,"new":0}   (or listed/new counts and syncStatus 200)
   ```

2. **End to end:** reply to an outreach email from an address you control. It
   should appear in the open `/inbox` within ~30–40 seconds, without reloading.
3. **Logs:** Dashboard → Edge Functions → gmail-reply-check → Logs shows a call
   every 30 seconds.

## Troubleshooting

| Response / symptom | Cause |
| --- | --- |
| `401 Unauthorised` | Function `CRON_SECRET` ≠ vault `cron_secret` |
| `400 appBaseUrl missing or not https` | Vault `companies_house_cron_base_url` missing or not https |
| `502 Gmail OAuth refresh failed` | Function Gmail secrets missing or wrong |
| `502` with `syncStatus: 401` | Vercel's `CRON_SECRET` differs from the function's |
| `502` with `syncStatus: 401` and an HTML login page | Bypass secret missing on a protected deployment |
| No calls in function logs | Vault `supabase_project_url` missing (step 2), or migration not applied |
