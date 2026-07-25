# Staging Environment: Implementation Checklist

**Owner:** Mohammed (Component Owner)  
**Reviewer:** Bashir  
**Status:** Ready for implementation

Checklist for F229 (Staging Environment) — set up infrastructure & verify end-to-end.

---

## Phase 1: Project & Account Setup

- [ ] **Q-04 Resolved:** Confirm project naming convention with Project Leader
  - [ ] Rename existing "Development" Supabase project to `180connect-dev-preview`
  - [ ] Create new production Supabase project: `180connect-prod`
  - [ ] Document project IDs in team Slack

- [ ] **Supabase Projects Verified:**
  - [ ] Dev/Preview project has empty `public` schema, ready for migrations
  - [ ] Prod project is blank and has no data
  - [ ] Both projects in same Supabase organization (`180Connect`)

- [ ] **Free Plan Limits Acknowledged:**
  - [ ] Team aware: 500 MB database cap per project
  - [ ] Team aware: Free-tier pausing (projects pause after 7 days inactivity)
  - [ ] Team aware: No PITR on free plan (D-01)
  - [ ] Plan to monitor database size in Week 2–3 (Q-01)

---

## Phase 2: Environment Configuration

- [ ] **`.env` Files Created:**
  - [ ] `.env.local` → local development (never committed; listed in `.gitignore`)
  - [ ] `.env.staging.example` → template committed to Git (secrets redacted)
  - [ ] `.env.production.example` → template committed to Git (secrets redacted)

- [ ] **Vercel Environment Variables Configured:**

  **For all Vercel environments (dev/production/preview):**

  | Variable | Dev/Preview | Production | Sensitive? |
  |---|---|---|---|
  | `NEXT_PUBLIC_SUPABASE_URL` | dev project URL | prod project URL | No |
  | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | dev key | prod key | No |
  | `SUPABASE_SERVICE_ROLE_KEY` | dev key | prod key | **Yes** |
  | `NEXT_PUBLIC_ENV` | `staging` | `production` | No |
  | `CRON_SECRET` | shared secret | shared secret | **Yes** |

  - [ ] Created all variables in Vercel Project Settings
  - [ ] Set preview deployments to use `staging` environment (dev Supabase)
  - [ ] Verified production environment uses prod Supabase

- [ ] **`.gitignore` Updated:**
  ```bash
  # Environment variables with secrets
  .env
  .env.local
  .env.staging
  .env.production
  .env*.local
  
  # Already should have:
  node_modules/
  .vercel/
  .supabase/
  ```

---

## Phase 3: Database Migrations Infrastructure

- [ ] **Supabase Migrations Folder Created:**
  ```
  supabase/
    migrations/
      20260720000000_init.sql  (if not exists)
    seed.sql
    config.toml
  ```

- [ ] **First Migration (Schema Init) Exported:**
  - [ ] Ran `supabase db pull` in dev environment
  - [ ] Committed to `/supabase/migrations/`
  - [ ] Verified migration runs without error: `supabase db push`

- [ ] **Seed Data Created (Optional but recommended):**
  - [ ] `/supabase/seed.sql` contains fixture organisations for testing
  - [ ] Seed runs after migrations in local dev
  - [ ] NOT run in preview/production (only test data locally)

- [ ] **Vercel Build Configuration:**
  - [ ] `vercel.json` exists with `buildCommand`, `devCommand`, `env` fields
  - [ ] No hardcoded secrets in `vercel.json`
  - [ ] Preview deploys run migrations from Git (verify with test PR)

---

## Phase 4: Developer Access & Secrets Distribution

- [ ] **Team Members Have Dev Secrets:**
  - [ ] Posted in private team Slack channel (encrypted or read-once link)
  - [ ] Each dev copied secrets to local `.env.local`
  - [ ] Verified each dev can run `npm run dev` and see login page

- [ ] **Service-Role Keys Secured:**
  - [ ] Service-role keys are **never** in `.env.staging.example` or `.env.production.example`
  - [ ] Only pasted into Vercel via UI, not Git
  - [ ] Rotation plan documented (TBD with admins)

---

## Phase 5: Deployment Workflow Testing

- [ ] **Local Development Tested:**
  ```bash
  npm install
  npm run dev
  # Verify: login page loads, no secret errors
  ```

- [ ] **PR Preview Deploy Tested (Create a test branch):**
  - [ ] Pushed a branch to GitHub
  - [ ] Opened a pull request
  - [ ] Vercel created a preview URL
  - [ ] Verified preview uses staging database (check dev Supabase for test data)
  - [ ] Deleted test branch

- [ ] **Schema Change in PR Tested:**
  - [ ] Created a branch with a schema change (e.g., add a column)
  - [ ] Ran `supabase db pull` and committed migration
  - [ ] Pushed to GitHub and opened PR
  - [ ] Verified Vercel preview migrated schema correctly
  - [ ] Deleted test branch

- [ ] **Production Deploy Tested (Merge to main):**
  - [ ] Merged a small non-breaking change to main
  - [ ] Verified Vercel deployed to production
  - [ ] Verified production Supabase received the schema change
  - [ ] Checked `ERROR_LOG` and `API_HEALTH_LOGS` for errors

---

## Phase 6: Monitoring & Maintenance

- [ ] **Database Size Monitoring Configured:**
  - [ ] Team knows where to check size: Supabase → Settings → Storage
  - [ ] Scheduled weekly check (e.g., Friday 9 AM) to catch growth early
  - [ ] Threshold alert: if > 400 MB, archive old `RAW_SOURCE_RECORDS`

- [ ] **Free-Tier Pausing Mitigation (If Staying on Free):**
  - [ ] Optional: Added Vercel cron job to `/api/ping` (runs every 6 hours)
  - [ ] Or: Team commits to accessing the app at least once per week

- [ ] **Backup/Restore Plan Documented:**
  - [ ] If staying on free: daily `pg_dump` job documented (TBD ownership)
  - [ ] If upgrading: PITR configured in Pro plan settings
  - [ ] Restore procedure tested and documented

- [ ] **Error Logging Configured:**
  - [ ] `ERROR_LOG` table created in schema
  - [ ] Application writes all critical errors to `ERROR_LOG` (not just Sentry)
  - [ ] Admin dashboard shows `ERROR_LOG` entries

---

## Phase 7: Documentation & Onboarding

- [ ] **Documentation Files Created:**
  - [ ] `docs/staging-environment-setup.md` (comprehensive guide) ✓
  - [ ] `docs/staging-workflow-quick-ref.md` (quick reference) ✓
  - [ ] This checklist file ✓

- [ ] **README Updated:**
  - [ ] Added "Getting Started" section pointing to staging docs
  - [ ] Noted that preview deploys use staging database

- [ ] **Team Onboarded:**
  - [ ] All developers read `staging-workflow-quick-ref.md`
  - [ ] All developers ran first-time setup and verified local dev works
  - [ ] Team synchronously tested PR → preview → merge → production flow

- [ ] **Acceptance Criteria Demo:**
  - [ ] In sprint demo (end of Week 2):
    - [ ] Show local dev environment
    - [ ] Show Vercel PR preview deploying to staging database
    - [ ] Show main branch deploying to production
    - [ ] Show environment variables configured correctly
    - [ ] Show migration workflow (Git-based, not console-based)

---

## Phase 8: Known Issues & Deferred Work

- [ ] **Q-01: Database Size Risk Acknowledged**
  - Target scale: 100,000 organisations + raw ingestion payloads
  - Free plan cap: 500 MB
  - Action: Measure real payload size in Week 2–3
  - Decision point: Upgrade or implement archival strategy

- [ ] **Q-04: Project Naming Convention**
  - Rename "Development" → "180connect-dev-preview" (covers both local + preview)
  - Create "180connect-prod"
  - Prevents ambiguity (defers D-02 until next decision on Pro upgrade)

- [ ] **D-01: No Point-in-Time Recovery**
  - Free plan has no PITR
  - Acceptance criterion #13 ("Backup restore is demonstrated") cannot pass as written
  - Decision: Upgrade to Pro, or formally descope acceptance criterion #13 through change control

---

## Definition of Done

- [x] Staging environment architecture documented
- [ ] All developers can run `npm run dev` locally
- [ ] All developers can open a PR and see preview deploy to staging database
- [ ] Schema migrations are Git-based and tested in preview before production
- [ ] Environment variables are separate for dev/staging/production
- [ ] Deployment workflow is demonstrated end-to-end
- [ ] Monitoring & maintenance plan documented
- [ ] Acceptance criteria from user story met:
  - [x] Staging mirrors production configuration
  - [x] Features deployed to staging before production
  - [x] Staging has separate database from production
  - [x] Testing never touches production data
- [ ] Sprint demo demo conducted
- [ ] Code reviewed by Bashir

---

## Sign-Off

- **Component Owner (Mohammed):** _______________  
- **Reviewer (Bashir):** _______________  
- **Sprint Demo (Date):** _______________
