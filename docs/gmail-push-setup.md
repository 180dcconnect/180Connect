# Gmail push reply sync — setup

> **Not in use.** Step 1 needs IAM changes in the Google Cloud project that
> owns the Gmail OAuth client, which is administered by the global 180DC team.
> Replies currently arrive via the 30-second check in
> [gmail-reply-check.md](gmail-reply-check.md). Everything below stays valid
> if those grants are ever made; the code does nothing while its env vars are unset.

Client replies reach `/inbox` within seconds instead of at the next five-minute
poll. This page is the one-time Google Cloud + Vercel setup; the design is in
the header of `src/lib/gmail/push.ts`.

## How it works

```
reply lands in clients.sheffield@180dc.org
  → Gmail users.watch publishes to Pub/Sub topic  (INBOX changes only)
  → push subscription POSTs /api/webhooks/gmail   (Google-signed OIDC token)
  → route verifies token, runs reply sync over the last 15 minutes
  → capture_gmail_reply inserts reply_events
  → Supabase Realtime → InboxRealtimeRefresher → router.refresh()
```

- **Watch renewal:** Gmail drops a watch after 7 days. pg_cron job
  `gmail_watch_renew` calls `/api/cron/gmail-watch` at 03:47 and 15:47 UTC.
- **Safety net:** `gmail_reply_sync` still polls every five minutes, with a
  two-day lookback, for any notification Pub/Sub drops.
- **No new table.** Nothing is stored between pushes; already-captured Gmail
  ids are skipped using `audit_log`.

**One topic, one subscription per environment.** Gmail keeps a single watch
per mailbox, and staging and production share the mailbox. If each environment
had its own topic, each renewal would steal the watch from the other. Both
environments therefore point `GMAIL_PUBSUB_TOPIC` at the same topic, and
Pub/Sub fans each notification out to one push subscription per environment.

## 1. Google Cloud (once)

Use the project that owns `GMAIL_CLIENT_ID` (Console → APIs & Services →
Credentials). Gmail refuses a topic in any other project.

```bash
PROJECT_ID=<project-id>
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
gcloud config set project $PROJECT_ID

gcloud services enable pubsub.googleapis.com

# The topic Gmail publishes to
gcloud pubsub topics create gmail-replies

# Let Gmail publish to it
gcloud pubsub topics add-iam-policy-binding gmail-replies \
  --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
  --role=roles/pubsub.publisher

# The identity push requests are signed as (it needs no roles of its own)
gcloud iam service-accounts create gmail-push-invoker \
  --display-name="180Connect Gmail push invoker"

# Let Pub/Sub mint OIDC tokens for it
gcloud iam service-accounts add-iam-policy-binding \
  gmail-push-invoker@$PROJECT_ID.iam.gserviceaccount.com \
  --member=serviceAccount:service-$PROJECT_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com \
  --role=roles/iam.serviceAccountTokenCreator
```

If the publisher binding fails with a "domain restricted sharing" error, the
Workspace org policy is blocking `system.gserviceaccount.com`. An org admin has
to allow it for this project (Organization policies →
`iam.allowedPolicyMemberDomains`).

## 2. Push subscription (per environment)

Staging shown; repeat with `production`, the production host and its own
audience when production outreach goes live.

```bash
gcloud pubsub subscriptions create gmail-replies-staging \
  --topic=gmail-replies \
  --push-endpoint="https://<staging-host>/api/webhooks/gmail?x-vercel-protection-bypass=<bypass-secret>" \
  --push-auth-service-account=gmail-push-invoker@$PROJECT_ID.iam.gserviceaccount.com \
  --push-auth-token-audience=180connect-gmail-push-staging \
  --ack-deadline=60 \
  --message-retention-duration=1h \
  --min-retry-delay=10s --max-retry-delay=600s
```

- `<staging-host>` is the same base URL as the `companies_house_cron_base_url`
  Vault secret.
- `<bypass-secret>` is Vercel's "Protection Bypass for Automation" secret, the
  `vercel_protection_bypass` Vault value. Drop the query string for an
  environment with no Deployment Protection.
- **Set a custom audience.** By default the audience is the endpoint URL,
  bypass secret included, and it would then have to sit in an env var.

## 3. Vercel env vars (per environment)

| Variable | Value |
| --- | --- |
| `GMAIL_PUBSUB_TOPIC` | `projects/<project-id>/topics/gmail-replies` (same everywhere) |
| `GMAIL_PUSH_AUDIENCE` | `180connect-gmail-push-staging` (the subscription's audience) |
| `GMAIL_PUSH_SERVICE_ACCOUNT` | `gmail-push-invoker@<project-id>.iam.gserviceaccount.com` |

Redeploy after setting them.

## 4. Start the watch

The cron job renews the watch, but only once the migration and env vars are
live. Start it now:

```bash
curl -X POST "https://<staging-host>/api/cron/gmail-watch?x-vercel-protection-bypass=<bypass-secret>" \
  -H "Authorization: Bearer <CRON_SECRET>"
# → {"historyId":"...","expiration":"<epoch ms, ~7 days out>"}
```

## 5. Verify

1. Send outreach to an address you control, then reply to it.
2. Within a few seconds, the reply should appear in the open `/inbox` with no
   reload.
3. Vercel logs should show `POST /api/webhooks/gmail` answering `204`.
4. In the Pub/Sub console, the subscription should show no unacked messages
   building up.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `gmail-watch` returns 503, logs `users.watch failed (403)` | Publisher binding for `gmail-api-push@system.gserviceaccount.com` is missing |
| `users.watch failed (400)` / `(404)` | Topic name wrong, or the topic is in a different project from the OAuth client |
| Webhook answers `401` | `GMAIL_PUSH_AUDIENCE` or `GMAIL_PUSH_SERVICE_ACCOUNT` doesn't match the subscription |
| Webhook answers `503` "Not configured" | An env var is missing, or no redeploy after setting it |
| Pub/Sub shows a Vercel login page / `401` HTML | Bypass query string missing on a protected deployment |
| Replies arrive, but only every ~5 min | Watch expired or never started: rerun step 4 and check `gmail_watch_renew` in `cron.job_run_details` |
