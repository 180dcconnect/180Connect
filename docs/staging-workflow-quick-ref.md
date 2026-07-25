# Staging Environment: Developer Workflow

Quick reference for working with staging in 180 Connect.

---

## Local Development

### First Time

```bash
# 1. Clone & install
git clone https://github.com/180dc/180connect.git
cd 180connect
npm install

# 2. Get dev Supabase secrets from team Slack (ask Mohammed)
# Copy them into .env.local (never commit this file)
cp .env.staging .env.local
# Edit .env.local with your dev secrets

# 3. Start dev server
npm run dev
# http://localhost:3000
```

### Day-to-Day

```bash
# Make your changes
git checkout -b feature/my-feature
# ... code ...

# If you changed the database schema, export migration
supabase db pull
git add supabase/migrations/
git commit -m "Migration: my feature (F123)"

# Test locally
npm run dev
# Open http://localhost:3000 and test

# Push to GitHub
git push origin feature/my-feature
# Open PR
```

### Environment Variables

**In VS Code or terminal:**
```bash
# Use dev environment (local)
cp .env.staging .env.local

# Fill in secrets from Slack
# - NEXT_PUBLIC_SUPABASE_URL (from Supabase dev project)
# - NEXT_PUBLIC_SUPABASE_ANON_KEY
# - SUPABASE_SERVICE_ROLE_KEY
```

**Never commit `.env.local`, `.env.staging`, or `.env.production` with secrets filled in.**

---

## Database Migrations

### You Changed the Schema

**Always export to Git before merging:**

```bash
# After making schema changes in local dev:
supabase db pull

# Check what was generated
git status
# Expected: supabase/migrations/<timestamp>_*.sql

# Commit it
git add supabase/migrations/
git commit -m "Migration: add <feature> (F###)"
```

### Migration Fails in Vercel Preview

1. Open the failed deploy log in Vercel
2. Look for SQL syntax errors in the migration file
3. Fix the `.sql` file and push again
4. Or roll back the commit

**Never manually fix migrations in the Supabase console.** Always fix the `.sql` file and re-deploy.

---

## Testing Your Changes

### In Preview Deploy

1. Push your branch to GitHub
2. Open a PR
3. Vercel creates a preview URL automatically (watch for the comment on the PR)
4. Preview uses **staging** Supabase database
5. Test end-to-end: login, create data, send emails (drafts), etc.

**Preview URL format:** `https://<your-branch>.<project>.vercel.app`

### In Vercel Production

1. After PR is approved and merged to `main`
2. Vercel deploys to production automatically
3. Production uses **production** Supabase database
4. Check `ERROR_LOG` for any new errors

---

## Common Tasks

### "I can't log in to my local dev"

1. Check `.env.local` has the right Supabase URL and keys
2. Check the Supabase project is running (ping Supabase dashboard)
3. Create a test user in Supabase Studio: `Auth → Users → Add user`
4. Use that email/password to log in

### "My PR preview is stuck on an old schema"

1. Vercel may be caching
2. Push a new commit to your branch (even an empty one: `git commit --allow-empty`)
3. Or clear Vercel cache in the project settings

### "Database is approaching 500 MB"

1. Check in Supabase dashboard: Settings → Storage
2. Let Mohammed know (component owner)
3. May need to archive old `RAW_SOURCE_RECORDS`

### "I'm getting a `NEXT_PUBLIC_ENV` is undefined error"

1. Check `.env.local` has `NEXT_PUBLIC_ENV=local`
2. Restart your dev server
3. Supabase and Vercel need their `NEXT_PUBLIC_ENV` set too

---

## Acceptance Criteria for Your Feature

Before opening a PR:

- [ ] Tested locally with `npm run dev`
- [ ] If schema changed: migration committed to Git
- [ ] No `.env.local` secrets in Git
- [ ] Ready for review

Before merging to main:

- [ ] Code reviewed by someone else
- [ ] Tested in Vercel preview
- [ ] Ready for production

---

## Getting Help

- **Supabase/Database questions:** @Mohammed (Component Owner)
- **Deployment/Vercel questions:** @Bashir (Reviewer)
- **Schema or migration issues:** Check `docs/staging-environment-setup.md` or ask in team Slack
