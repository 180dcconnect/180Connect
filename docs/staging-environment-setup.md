# Staging Environment Setup

**Status:** Implementation guide for F229 (Staging Environment)  
**Date:** 20 July 2026  
**Owner:** Mohammed (Component Owner)  
**Reviewer:** Bashir

---

## Overview

This document describes how to set up and manage a staging environment for 180 Connect within the constraints of the Supabase free plan. Staging is the shared integration environment where features are tested end-to-end before production deployment.

### Why Staging?

- **Safe integration testing:** Multiple developers test changes together without risking production data
- **Preview deployments:** Vercel PR previews point to staging data, not production
- **Production parity:** Schema, migrations, and secrets match production closely
- **Offboarding safety:** New team members can test workflows without touching live client data
- **Accepted deviations:**
  - D-01: Free plan has no PITR; accept the risk or upgrade to Pro
  - D-02: Free plan supports 2 projects max; staging + production is the boundary

---

## Architecture

### Project Structure

Free Supabase plan allows **two active projects per organisation**. We use:

| Environment | Project Name | Purpose | Data | Migration Flow |
|---|---|---|---|---|
| **Development / staging** | `180connect-staging` (`cgbfhhdeapasniudyyds`, eu-west-2) | Local dev + preview deploy base | Fixture/test data | Dev writes → Git PR |
| **Production** | `180connect-production` (`tugfhwiqvwrpvawpjwmd`, eu-west-1) | Live client data | Real organisations | Git main branch → Migration runs |

Both projects exist as of 28 July 2026. The production project is named
`180connect-production` — earlier drafts of these docs called it `180connect-prod`
before it was created; that name is not correct.

**Limitation:** We share the "Development" Supabase project across local development **and** Vercel preview deployments. This means:
- ✅ Developers work locally against `dev` project
- ✅ PR previews deploy to the same `dev` project
- ✅ Same schema + secrets, so code works the same way
- ⚠️ If multiple PRs create conflicting schema changes, they collide in `dev`
- ⚠️ Test data from one PR preview affects others

**Mitigation:** Commit database migrations to Git (in `/supabase/migrations/`); Vercel preview builds run migrations in sequence, so the last merge-base state is deterministic.

---

## Free Plan Constraints & Mitigations

### Constraint 1: No point-in-time recovery (PITR)

**Impact:** Data loss has no recovery path.

| Mitigation | Effort | Trade-off |
|---|---|---|
| Nightly `pg_dump` to Cloud Storage | 4 hours | Requires storage account; restores are manual and stale |
| Upgrade to Supabase Pro ($25/mo) | <1 hour | Monthly cost |

**Recommended for MVP:** Upgrade. PITR is included in Pro and removes free-tier pausing.  
**Fallback for free plan:** Schedule a daily `pg_dump` to Vercel `/tmp` → external storage (GitHub Actions, S3, etc.).

### Constraint 2: Free-tier pausing

**Impact:** Projects pause after 7 days of inactivity, losing connections mid-request.

**Mitigation:** Use a Vercel cron job or external monitor to keep projects warm. Example:

```bash
# Vercel cron — runs daily at 9 AM UTC
0 9 * * * curl https://180connect.vercel.app/api/ping
```

### Constraint 3: 500 MB database limit

**Impact:** Raw `RAW_SOURCE_RECORDS` payloads (storing full JSON from each ingestion run) will grow quickly.

**Mitigation:** 
- Monitor database size weekly via Supabase dashboard
- Archive old raw records to Cloud Storage if they exceed ~400 MB
- In Week 2–3, measure real ingestion payload size against 100,000 organisations target (Q-01 decision point)

---

## Environment Variables & Secrets

### Separate `.env` Files

Create three environment files:

```bash
.env.local              # Development (Never commit, .gitignored)
.env.staging            # Staging (Commit structure only, not secrets)
.env.production         # Production (Never commit, stored in Vercel secrets)
```

### File Structure

**.env.local** (local dev, never committed):
```bash
# Supabase (points to dev project)
NEXT_PUBLIC_SUPABASE_URL=https://cgbfhhdeapasniudyyds.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<dev_anon_key>
SUPABASE_SERVICE_ROLE_KEY=<dev_service_key>

# Environment label
NEXT_PUBLIC_ENV=local

# Local overrides
NEXT_PUBLIC_LOG_LEVEL=debug
```

**.env.staging.example** (committed; developers fill in secrets locally):
```bash
# Supabase (points to staging project, once created)
NEXT_PUBLIC_SUPABASE_URL=https://<staging-project-id>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging_anon_key>
SUPABASE_SERVICE_ROLE_KEY=<staging_service_key>

# Environment label
NEXT_PUBLIC_ENV=staging

# Feature flags (example; add as needed)
NEXT_PUBLIC_LOG_LEVEL=info
```

**.env.production.example** (committed; developers fill in secrets locally for local prod testing):
```bash
# Supabase (production project)
NEXT_PUBLIC_SUPABASE_URL=https://<prod-project-id>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<prod_anon_key>
SUPABASE_SERVICE_ROLE_KEY=<prod_service_key>

# Environment label
NEXT_PUBLIC_ENV=production

# Feature flags
NEXT_PUBLIC_LOG_LEVEL=warn
```

### Vercel Deployment Secrets

Configure in Vercel → Project Settings → Environment Variables:

| Variable | Staging | Production | Preview |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | staging-url | prod-url | staging-url |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging-key | prod-key | staging-key |
| `SUPABASE_SERVICE_ROLE_KEY` | staging-key | prod-key | staging-key |
| `NEXT_PUBLIC_ENV` | staging | production | staging |
| `CRON_SECRET` | shared secret | shared secret | shared secret |
| Other API keys | staging/test | production | staging/test |

**Rule:** Always set Preview deployments to staging secrets, never production.

---

## Database Migrations & Schema

### Migration Workflow

1. **Make local schema change** in development
   - Use Supabase Studio UI or `supabase push` (local dev only)
   
2. **Export migration** to Git:
   ```bash
   supabase db pull
   # Generates /supabase/migrations/<timestamp>_<name>.sql
   ```

3. **Commit & push** to branch:
   ```bash
   git add supabase/migrations/
   git commit -m "Migration: add organisations table (F051)"
   ```

4. **Vercel PR preview** automatically:
   - Creates a temporary database snapshot
   - Runs migrations in order
   - Tests code against fresh schema

5. **Merge to `main`** → production:
   ```bash
   git merge branch-name
   # GitHub Actions or manual step: supabase db push --linked (if upgraded to Pro)
   ```

### File Organization

```
supabase/
  migrations/
    20260715120000_init_auth.sql
    20260715130000_add_organisations.sql
    20260716090000_add_scoring.sql
    20260720100000_add_audit_log.sql
  seed.sql                         # Fixture data for local dev & testing
```

### Never Manually Edit Production Schema

- No untracked schema changes in the console
- All changes go through Git migrations
- Acceptance criterion: "Any schema change includes a migration"

---

## Deployment Workflow

### Standard Team Flow

```
Feature Branch
    ↓
Commit code + migrations
    ↓
Push to GitHub
    ↓
Vercel creates Preview Deploy
    ├─ Uses staging Supabase secrets
    ├─ Runs migrations from Git
    ├─ Deploys Next.js app
    ↓
PR review + testing in preview
    ↓
Merge to main
    ↓
Vercel deploys to Production
    ├─ Uses production Supabase secrets
    ├─ Runs migrations (if enabled)
    ├─ Deploys Next.js app
    ↓
Monitor API_HEALTH_LOGS + ERROR_LOG
```

### Vercel Configuration

**In `vercel.json`:**

```json
{
  "buildCommand": "npm run build",
  "devCommand": "npm run dev",
  "installCommand": "npm install",
  "env": {
    "NEXT_PUBLIC_ENV": {
      "type": "plaintext",
      "description": "Environment label (local/staging/production)"
    }
  }
}
```

**GitHub Actions (optional; advanced):**

For production migrations, create `.github/workflows/db-migrate-prod.yml` (requires Supabase Pro for automated migrations). On free plan, migrations are applied at deploy time if `supabase.json` links the project.

---

## Testing in Staging

### Local Development

```bash
# 1. Clone repo and install
git clone https://github.com/180dc/180connect.git
cd 180connect
npm install

# 2. Set up local environment
cp .env.staging .env.local
# Edit .env.local to use dev Supabase secrets

# 3. Start local dev server
npm run dev
# Opens http://localhost:3000 (uses local .env)

# 4. Test migrations
npx supabase migration list
npx supabase db push  # (local only)
```

### Vercel Preview Deployment

Feature branches do **not** get their own preview URL — `vercel.json` limits
deployments to `dev` and `main`. The shared `dev` deployment is the preview
environment; see [production-deployment.md](production-deployment.md).

1. Create a feature branch and push to GitHub
2. Open a pull request into `dev`
3. On merge, the shared `dev` deployment rebuilds — find it in the Vercel **Deployments** tab
4. That deployment uses the **staging** Supabase database
5. Test end-to-end: login, create organisation, send email draft, etc.

### Shared Staging Environment (if Upgraded to Pro)

If you upgrade to Pro, create a dedicated third Supabase project called `180connect-staging`:

1. Create new Supabase project: `180connect-staging`
2. Clone production schema:
   ```bash
   # Backup production schema
   pg_dump --schema-only $PROD_DB_URL > schema.sql
   
   # Restore to staging
   psql $STAGING_DB_URL < schema.sql
   ```
3. Deploy staging app via Vercel branch:
   ```bash
   # In Vercel: create custom domain staging.180connect.dev
   # Point to main branch, but with STAGING secrets
   ```
4. Share staging URL with team for manual testing

---

## Monitoring & Troubleshooting

### Database Size

**Check weekly:**

1. Supabase dashboard → Project → Storage → Database size
2. If approaching 500 MB:
   ```sql
   SELECT
     schemaname,
     tablename,
     pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
   FROM pg_catalog.pg_tables
   WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
   ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
   ```
3. Archive old `RAW_SOURCE_RECORDS` to Cloud Storage

### Migration Failures

**If a Vercel preview deploy fails on migration:**

1. Check Vercel deployment logs
2. Inspect `supabase/migrations/` for SQL syntax errors
3. Roll back the commit or fix the migration
4. Retry the deploy

**Never apply a failed migration to production.** Test in preview first.

### Free-Tier Pausing

**If requests timeout after inactivity:**

1. The project has paused
2. Next request will wake it (slow, ~30s)
3. Add a Vercel cron job to keep it warm:

```bash
# vercel.json
{
  "crons": [{
    "path": "/api/ping",
    "schedule": "0 */6 * * *"  // Every 6 hours
  }]
}
```

---

## Developer Checklist

### First-Time Setup

- [ ] Clone repo and run `npm install`
- [ ] Copy `.env.staging` to `.env.local`
- [ ] Fill in dev Supabase secrets (ask team Slack)
- [ ] Run `npm run dev` and verify login page loads
- [ ] Create a test account via Supabase console and log in

### Before Opening a PR

- [ ] Created migration if schema changed: `supabase db pull`
- [ ] Committed migration to Git: `/supabase/migrations/`
- [ ] No `.env.local` or secrets in Git
- [ ] Tested locally with `npm run dev`

### After Merge to Main

- [ ] Verify production deploy succeeded in Vercel
- [ ] Check `ERROR_LOG` for new errors
- [ ] Spot-check a user workflow in production

---

## Acceptance Criteria ✓

- [x] A staging environment exists that mirrors production configuration
- [x] Features are deployed to staging before production (Vercel previews + main branch)
- [x] Staging uses the same database schema as production (migrations in Git)
- [x] Testing never risks production data (separate Supabase projects)
- [x] Environment variables are structured for separate secrets per environment
- [x] Developers have a documented workflow (this file)

---

## Related Issues & Decisions

| Issue | Status | Note |
|---|---|---|
| Q-01: Supabase plan | Open | Free plan chosen; 500 MB limit is a risk. Revisit in Week 2–3. |
| D-01: No PITR | Accepted | No point-in-time recovery on free plan. Accept or upgrade. |
| D-02: Two environments | Resolved | Using free plan with dev+preview as one slot, production as second. |
| Q-04: Project naming | Resolved 28 Jul 2026 | `180connect-staging` (dev + preview) and `180connect-production`. |

---

## Next Steps

1. ~~**Immediately:** Rename existing Supabase project from "Development"~~ — done, now `180connect-staging` (Q-04, 28 July 2026)
2. ~~**Week 1:** Create production Supabase project~~ — done, `180connect-production` (20 July 2026); migration path verified
3. **Week 2–3:** Measure database size against 100,000-org target (Q-01)
4. **Week 2–3:** Test PR preview deployment end-to-end with a real schema change
5. **Before Go-Live:** Document backup/restore procedure or upgrade to Pro
