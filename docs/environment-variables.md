# Environment Variables Configuration

**Document:** Technical specification for 180 Connect environment variables  
**Status:** Reference for F229 (Staging Environment)  
**Last updated:** 20 July 2026

---

## Overview

180 Connect uses environment variables to separate secrets, configuration, and feature flags across local development, staging (Vercel previews), and production environments.

**Golden Rule:** Never commit real secrets. Commit structure and examples only (`.example` files).

---

## File Structure

```
Project Root/
├── .env.local              ← Local development (NEVER commit)
├── .env.staging.example    ← Template for staging (commit without secrets)
├── .env.production.example ← Template for production (commit without secrets)
└── .gitignore              ← Excludes *.env files with secrets
```

---

## Environment Variable Categories

| Category | Examples | Sensitive? | Local | Preview | Production |
|---|---|---|---|---|---|
| **Supabase** | URL, anon key, service role key | Yes (service key) | Dev project | Dev project | Prod project |
| **Gmail/Email** | OAuth tokens, SMTP credentials | Yes | Dev Gmail account | Dev Gmail account | Production Gmail |
| **LLM** | API key for VOICE or Claude | Yes | Test/dev key | Test/dev key | Production key |
| **Third-party APIs** | CharityBase, Companies House, etc. | Yes | Test credentials | Test credentials | Production credentials |
| **Feature flags** | `ENABLE_AI_BOOKLETS`, log levels | No | Feature flags | Feature flags | Feature flags |
| **Analytics** | PostHog API key, Sentry DSN | No (but can expose usage) | Dev key | Dev key | Prod key |
| **Environment label** | `NEXT_PUBLIC_ENV` | No | `local` | `staging` | `production` |

---

## `.env.local` (Local Development)

**File:** `.env.local` (git-ignored, never committed)  
**Usage:** `npm run dev`  
**Secrets source:** Ask team in Slack; stored in password manager

### Example

```bash
# Absolute base URL this deployment is served from. Required — the server
# will not start without it (src/lib/env.ts).
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Supabase (Development/Preview Project)
# From: Supabase Dashboard → Project → API → Copy values
NEXT_PUBLIC_SUPABASE_URL=https://cgbfhhdeapasniudyyds.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnYmZoaGRlYXBhc25pdWR5eWRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE2MjE5MDY0MzAsImV4cCI6MTkzNzQ4MjQzMH0.a0-something-random
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnYmZoaGRlYXBhc25pdWR5eWRzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTYyMTkwNjQzMCwiZXhwIjoxOTM3NDgyNDMwfQ.very-secret-key-do-not-share

# Environment label
NEXT_PUBLIC_ENV=local

# Email (Dev Gmail account — ask team)
# These are used when manually testing email sending; CI/CD doesn't need them
GMAIL_REDIRECT_URI=http://localhost:3000/api/auth/gmail/callback
GMAIL_CLIENT_ID=123456789-randomstring.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=GOCSPX-secretkey

# LLM (Development API key — ask team)
OPENAI_API_KEY=sk-proj-test-key-local-only

# Feature flags & logging
NEXT_PUBLIC_LOG_LEVEL=debug
NEXT_PUBLIC_ENABLE_AI_BOOKLETS=true
NEXT_PUBLIC_ENABLE_SCHEDULED_SENDS=true

# Cron/scheduled jobs (shared secret)
CRON_SECRET=local-dev-secret-12345

# Analytics (optional; can be blank locally)
NEXT_PUBLIC_POSTHOG_KEY=
SENTRY_DSN=
```

---

## `.env.staging.example` (Staging Template)

**File:** `.env.staging.example` (committed to Git)  
**Usage:** Template for developers; rename to `.env.staging` and fill in secrets for manual staging testing  
**Secrets source:** Ask Mohammed for staging project keys

### Example

```bash
# Absolute base URL this deployment is served from. Required.
NEXT_PUBLIC_APP_URL=https://<staging-url>

# Supabase (Dev/Preview Project — shared with local dev)
NEXT_PUBLIC_SUPABASE_URL=https://cgbfhhdeapasniudyyds.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<redacted>
SUPABASE_SERVICE_ROLE_KEY=<redacted>

# Environment label
NEXT_PUBLIC_ENV=staging

# Email (Dev Gmail account)
GMAIL_REDIRECT_URI=https://<staging-url>/api/auth/gmail/callback
GMAIL_CLIENT_ID=<redacted>
GMAIL_CLIENT_SECRET=<redacted>

# LLM (Development API key)
OPENAI_API_KEY=<redacted>

# Feature flags
NEXT_PUBLIC_LOG_LEVEL=info
NEXT_PUBLIC_ENABLE_AI_BOOKLETS=true
NEXT_PUBLIC_ENABLE_SCHEDULED_SENDS=true

# Cron
CRON_SECRET=<shared-secret>

# Analytics
NEXT_PUBLIC_POSTHOG_KEY=<redacted>
SENTRY_DSN=<redacted>
```

---

## `.env.production.example` (Production Template)

**File:** `.env.production.example` (committed to Git)  
**Usage:** Template only; secrets stored in Vercel UI, not local files  
**Secrets source:** Project Leader (encrypted channel)

### Example

```bash
# Absolute base URL this deployment is served from. Required.
NEXT_PUBLIC_APP_URL=https://180connect.vercel.app

# Supabase (Production Project)
NEXT_PUBLIC_SUPABASE_URL=https://<prod-project-id>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<redacted>
SUPABASE_SERVICE_ROLE_KEY=<redacted>

# Environment label
NEXT_PUBLIC_ENV=production

# Email (Production 180DC Gmail)
GMAIL_REDIRECT_URI=https://180connect.vercel.app/api/auth/gmail/callback
GMAIL_CLIENT_ID=<redacted>
GMAIL_CLIENT_SECRET=<redacted>

# LLM (Production API key)
OPENAI_API_KEY=<redacted>

# Feature flags
NEXT_PUBLIC_LOG_LEVEL=warn
NEXT_PUBLIC_ENABLE_AI_BOOKLETS=true
NEXT_PUBLIC_ENABLE_SCHEDULED_SENDS=true

# Cron
CRON_SECRET=<shared-secret>

# Analytics
NEXT_PUBLIC_POSTHOG_KEY=<redacted>
SENTRY_DSN=<redacted>
```

---

## Vercel Environment Variables (UI Configuration)

**Where to set them:** Vercel Dashboard → Project Settings → Environment Variables

### Configuration Matrix

| Variable | Value (Dev/Preview) | Value (Production) | When Revealed | Notes |
|---|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Vercel preview URL | `https://180connect.vercel.app` | Always | **Required** — server refuses to start without it |
| `NEXT_PUBLIC_SUPABASE_URL` | cgbfhhdeapasniudyyds.supabase.co | prod-project.supabase.co | Always | Public, safe to expose |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | dev-key | prod-key | Always | Public publishable key, limited permissions. Preferred over the anon key |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | dev-key | prod-key | Always | Legacy name for the publishable key; read as a fallback. Set one or the other |
| `AUTH_ALLOWED_EMAIL_DOMAIN` | `180dc.org` | `180dc.org` | Only server-side | Email domain users must sign in from. Optional — defaults to `180dc.org` |
| `SUPABASE_SERVICE_ROLE_KEY` | dev-key | prod-key | Only server-side | **SENSITIVE:** Never expose to browser |
| `NEXT_PUBLIC_ENV` | `staging` | `production` | Always | Tells app which environment it's in |
| `GMAIL_CLIENT_ID` | dev-id | prod-id | Always | Public OAuth client ID |
| `GMAIL_CLIENT_SECRET` | dev-secret | prod-secret | Only server-side | **SENSITIVE:** Never expose |
| `OPENAI_API_KEY` | test-key | prod-key | Only server-side | **SENSITIVE:** Never expose |
| `CRON_SECRET` | shared-secret | shared-secret | Only server-side | **SENSITIVE:** Auth for `/api/cron/*` routes |
| `NEXT_PUBLIC_POSTHOG_KEY` | dev-key | prod-key | Always | Public analytics key |
| `NEXT_PUBLIC_SENTRY_DSN` | dev-dsn | prod-dsn | Always | Public error reporting endpoint — where captured errors are sent (F226). Unset ⇒ errors log to the platform console instead |
| `SENTRY_ENVIRONMENT` | `staging` | `production` | Only server-side | Environment tag on captured errors (F226). Optional — falls back to `VERCEL_ENV` |

### How to Set in Vercel

1. Go to Vercel Dashboard → 180Connect project
2. Settings → Environment Variables
3. For each variable:
   - **Name:** (e.g., `SUPABASE_SERVICE_ROLE_KEY`)
   - **Value:** (paste secret)
   - **Environments:** Select which environments this applies to:
     - ✓ Preview (uses this for all PR previews)
     - ✓ Production (uses this for main branch)
     - Leave unchecked for environments that don't need it
4. Click "Save"

**Important:** Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to **dev project** for Preview deployments, and **prod project** for Production. This ensures:
- PR previews test against staging database (safe to experiment)
- Main branch production deployment uses production database (real data)

---

## Next.js Configuration

### In `next.config.ts`

The app reads from environment at build time and runtime:

```typescript
export default {
  // These env vars are embedded at build time for `NEXT_PUBLIC_*` vars
  env: {
    NEXT_PUBLIC_ENV: process.env.NEXT_PUBLIC_ENV,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  },
}
```

### In `middleware.ts` or Layout

You can check the environment:

```typescript
const env = process.env.NEXT_PUBLIC_ENV; // 'local', 'staging', 'production'

if (env === 'production') {
  // Production-only code
}

if (env === 'staging' || env === 'local') {
  // Debug/test code
}
```

### In Server Actions / API Routes

```typescript
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Never expose!

// This is only accessible on the server; safe to use
const supabase = createClient(supabaseUrl, serviceKey);
```

---

## Secrets Management Best Practices

### DO ✅

- Store secrets in `.env.local` (local dev only)
- Commit `.env*.example` files to show structure (with `<redacted>` placeholders)
- Store production secrets in Vercel UI, not in Git
- Use a password manager (1Password, LastPass, etc.) to share test secrets with team
- Rotate service-role keys quarterly
- Ask Project Leader before adding new environment variables

### DON'T ❌

- **Never commit `.env.local`, `.env.staging`, or `.env.production` with real values**
- **Never paste secrets into Slack or email** (use 1Password shared note or ephemeral link)
- **Never hard-code API keys in source code**
- **Never use production credentials for testing** (create test accounts/projects instead)
- **Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser** (use `NEXT_PUBLIC_` prefix only for public data)
- **Never commit `node_modules/.env` or any generated env files**

---

## Secret Rotation

| Secret | Frequency | Owner | Procedure |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Quarterly | Mohammed (DB) | 1. Generate new key in Supabase. 2. Update Vercel. 3. Restart production. 4. Confirm all jobs succeed. |
| `GMAIL_CLIENT_SECRET` | Yearly or after compromise | Project Leader | Revoke in Google Cloud Console, generate new credential, update Vercel. |
| `OPENAI_API_KEY` | Yearly or after budget review | Project Leader | Revoke in OpenAI dashboard, generate new key, update Vercel. |
| `CRON_SECRET` | Yearly | Mohammed | Generate new random string (e.g., `openssl rand -hex 32`), update Vercel & docs. |

---

## Troubleshooting

### "I get `NEXT_PUBLIC_SUPABASE_URL is undefined`"

1. Check `.env.local` has the variable
2. Is `.env.local` in `.gitignore`? (It should be)
3. Restart dev server: `npm run dev`
4. Make sure you're not in a different working directory

### "I can't connect to the database in local dev"

1. Check `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are correct (ask Mohammed)
2. Check the Supabase project is running (Supabase dashboard should show it)
3. Supabase free tier pauses after 7 days; refresh the project in the dashboard to wake it

### "Preview deploy is connecting to production database"

1. Check Vercel environment variables
2. Ensure `NEXT_PUBLIC_SUPABASE_URL` is set to **dev project** for Preview environment
3. Ensure `NEXT_PUBLIC_SUPABASE_URL` is set to **prod project** for Production environment
4. If both are the same, preview will use production — fix this immediately

### "Production deploy failed with secret errors"

1. Check that all `SUPABASE_SERVICE_ROLE_KEY` and other server-side keys are set in Vercel UI
2. Restart the deployment in Vercel
3. Check that the secrets haven't expired

---

## Startup Validation (`src/lib/env.ts`)

Environment variables are validated once, on server startup, before any request
is handled. `src/instrumentation.ts` calls `assertEnv()`; if a required variable
is missing or malformed the server stops with every problem listed at once:

```
Environment is not configured correctly (1 problem):
  - NEXT_PUBLIC_APP_URL is required but not set

Copy .env.example to .env.local and fill in the values.
See docs/environment-variables.md for what each variable is and where to get it.
```

This is deliberate. The alternative — `undefined` flowing into a fetch URL or a
database client — produces a confusing failure much further from the cause.

Error messages report the variable **name** and what is wrong with it. They
never include the value, so a malformed secret cannot leak into a log or a
deployment output.

### The three places a variable exists

| Place | What it is | Committed? |
| --- | --- | --- |
| `src/lib/env.ts` | The schema — single source of truth for what exists, what is required, and what counts as a valid value | Yes |
| `.env.example` | The documented list, with a comment per variable and where to get the value | Yes (no real values) |
| `.env.local` | Your actual local values | **No** — gitignored |

Adding a variable means editing the first two. If you only edit `.env.local`,
it works on your machine and nowhere else.

### Marking a variable required

Variables for features that have not been built yet are declared with
`required: false`, so the app still starts. When you merge the feature that
consumes one, flip it to `required: true` in `src/lib/env.ts` and move it under
the required heading in `.env.example` — in the same pull request, so nobody
deploys the feature without its configuration.

### Reading `NEXT_PUBLIC_` variables

Because `NEXT_PUBLIC_` variables are substituted textually at build time, they
must be read with static property access — `process.env.NEXT_PUBLIC_APP_URL`.
A dynamic lookup like `process.env[name]` is not replaced and reads as
`undefined` in the browser. This is why the `env` object at the bottom of
`src/lib/env.ts` spells each one out rather than looping over the schema.

---

## Related Files

- [Staging Environment Setup](staging-environment-setup.md) — Architecture & migration workflow
- [Staging Workflow Quick Reference](staging-workflow-quick-ref.md) — Developer day-to-day
- [Staging Implementation Checklist](staging-implementation-checklist.md) — Setup tasks
