Owner: Ben Phillips. Reviewer: Bashir Bobboi. Written with Claude, checked and updated by Ben Phillips.

# Setting up production backups (F225)

One-time setup for `.github/workflows/backup-production.yml`. These are dashboard steps only you can do — they need your logged-in access, and none of these values should ever be pasted into chat, a commit, or a screenshot. Read [F225-database-backups.md](F225-database-backups.md) first for why the workflow is shaped the way it is.

A **repository secret** is an encrypted value GitHub Actions can use but never displays in logs. A **repository variable** is the same idea but in plain text — used only for values that aren't sensitive (a project ref is visible in the project's URL anyway, so hiding it adds nothing).

## 1. Repository variable: `SUPABASE_PROD_REF`

GitHub → repo → **Settings → Secrets and variables → Actions → Variables tab → New repository variable**.

- Name: `SUPABASE_PROD_REF`
- Value: `tugfhwiqvwrpvawpjwmd` (the `180connect-production` project ref, from `supabase/MIGRATIONS.md`)

## 2. Repository secret: `SUPABASE_PROD_DB_PASSWORD`

1. Supabase dashboard → select the **180connect-production** project → **Project Settings → Database**.
2. Find **Database password**. If you don't already have it recorded (it's normally only shown once, at project creation), use **Reset database password** to generate a new one — this doesn't affect anything else, since nothing is using the direct DB connection yet.
3. Copy the password immediately (it won't be shown again).
4. GitHub → repo → **Settings → Secrets and variables → Actions → Secrets tab → New repository secret**.
   - Name: `SUPABASE_PROD_DB_PASSWORD`
   - Value: the password from step 3.

## 3. Confirm `SUPABASE_ACCESS_TOKEN` already exists

This one's shared with `migrations.yml` (F232) — it should already be there. Check under the same **Secrets** tab. If it's missing, it's a Supabase personal access token from **Supabase dashboard → Account → Access Tokens**.

## 4. Create the Vercel Blob store

1. Vercel dashboard → the 180Connect project → **Storage** tab → **Create Database** → choose **Blob**.
2. Access level: **Private** (this holds real organisation/contact data — never public).
3. Name it, e.g. `backups-store`, and create it.
4. Choose which environments get the token (Production is enough — this store is only ever written to by the GitHub Action, not by the app itself).

## 5. Repository secret: `BLOB_READ_WRITE_TOKEN`

Creating the store in step 4 automatically adds `BLOB_READ_WRITE_TOKEN` to the **Vercel** project's environment variables — but the GitHub Action runs on GitHub's infrastructure, not Vercel's, so it needs its own copy.

1. Vercel dashboard → project → **Settings → Environment Variables** → find `BLOB_READ_WRITE_TOKEN` → reveal and copy the value.
2. GitHub → repo → **Settings → Secrets and variables → Actions → Secrets tab → New repository secret**.
   - Name: `BLOB_READ_WRITE_TOKEN`
   - Value: the token from step 1.

## 6. Test it

Don't wait for 3am. GitHub → repo → **Actions** tab → **Backup production database** (left sidebar) → **Run workflow** button → confirm.

Watch the run. If the "Dump roles, schema, and data" step fails, the most likely cause is the production project being paused (Supabase dashboard will show this — click **Restore project** if so, then re-run).

## 7. Verify the upload

Vercel dashboard → project → **Storage** → the Blob store → browse to `backups/<today's date>/` and confirm three files: `roles_*.sql`, `schema_*.sql`, `data_*.sql`.
