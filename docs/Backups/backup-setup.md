Owner: Ben Phillips. Reviewer: Bashir Bobboi. Written with Claude, checked and updated by Ben Phillips.

# Setting up production backups (F225)

One-time setup for `.github/workflows/backup-production.yml`. These are dashboard steps only you can do — they need your logged-in access, and none of these values should ever be pasted into chat, a commit, or a screenshot. Read [F225-database-backups.md](F225-database-backups.md) first for why the workflow is shaped the way it is.

A **repository secret** is an encrypted value GitHub Actions can use but never displays in logs. A **repository variable** is the same idea but in plain text — used only for values that aren't sensitive (a project ref is visible in the project's URL anyway, so hiding it adds nothing).

## 1. Repository variable: `SUPABASE_PROD_REF`

GitHub → repo → **Settings → Secrets and variables → Actions → Variables tab → New repository variable**.

- Name: `SUPABASE_PROD_REF`
- Value: `tugfhwiqvwrpvawpjwmd` (the `180connect-production` project ref, from `supabase/MIGRATIONS.md`)

## 2. Repository variable: `SUPABASE_PROD_POOLER_HOST`

The workflow connects through Supavisor (the pooler), not the direct `db.<ref>.supabase.co` host — that host is IPv6-only and GitHub's runners have no IPv6, so a direct connection from CI cannot work. See section 0 of [F225-database-backups.md](F225-database-backups.md) for the full reasoning.

1. Supabase dashboard → **180connect-production** → **Connect** (top of the page) → **Session pooler** tab.
2. From the connection string, take only the **host** — the part between `@` and `:5432`. It looks like `aws-1-eu-west-1.pooler.supabase.com`.
   - Check you are on the *production* project. Staging is a different ref *and* a different region (`eu-west-2`), so a string copied from the wrong project fails in a way that looks like a password problem.
   - Take **Session pooler**, not Transaction pooler. Transaction mode is port 6543 and does not support `pg_dump`.
3. GitHub → **Settings → Secrets and variables → Actions → Variables tab → New repository variable**.
   - Name: `SUPABASE_PROD_POOLER_HOST`
   - Value: the host from step 2 (hostname only — no `postgresql://`, no username, no port).

The username is not configured anywhere: the workflow builds it as `postgres.$SUPABASE_PROD_REF`, which is the form the pooler requires.

## 3. Repository secret: `SUPABASE_PROD_DB_PASSWORD`

1. Supabase dashboard → select the **180connect-production** project → **Project Settings → Database**.
2. Find **Database password**. If you don't already have it recorded (it's normally only shown once, at project creation), use **Reset database password** to generate a new one — this doesn't affect anything else, since nothing is using the direct DB connection yet.
3. Copy the password immediately (it won't be shown again).
4. GitHub → repo → **Settings → Secrets and variables → Actions → Secrets tab → New repository secret**.
   - Name: `SUPABASE_PROD_DB_PASSWORD`
   - Value: the password from step 3.

The workflow passes this via `PGPASSWORD` rather than building a `postgresql://` URL, so a password containing `@ / # ? :` is safe — no escaping needed.

`SUPABASE_ACCESS_TOKEN` is **not** needed by this workflow. It exists for `migrations.yml` (F232), which uses the Supabase CLI; the backup workflow uses `pg_dump` directly and never authenticates against the Supabase API.

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

## 6. Repository secret: `VERCEL_TOKEN`

**The Blob read-write token from step 5 is not enough on its own.** The upload also needs a Vercel *account* token, or it fails with `No existing credentials found. Please run vercel login or pass "--token"` even though the Blob token is present and valid. Both are required; neither replaces the other.

1. Vercel dashboard → **Account Settings → Tokens** → **Create Token**.
   - Scope it to the team or project that owns the Blob store, not to everything.
   - Copy the value immediately; it is shown once.
2. GitHub → repo → **Settings → Secrets and variables → Actions → Secrets tab → New repository secret**.
   - Name: `VERCEL_TOKEN`
   - Value: the token from step 1.

This one is worth understanding rather than just pasting, because testing it will mislead you. An *invalid* Blob token fails at store resolution (`Vercel Blob: This store does not exist`), which happens **before** the account-auth check — so with a fake token the read-write token appears to be sufficient. Only a real Blob token gets far enough to hit the second requirement. That cost most of a morning to work out; it is written down here so it costs nobody else one.

A Vercel account token is broader than the Blob token: account-wide rather than scoped to one store, and readable by every workflow in the repository. The narrower alternative is to drop the Vercel CLI from the upload step and use the `@vercel/blob` package or a plain `curl` PUT, both of which authenticate with `BLOB_READ_WRITE_TOKEN` alone. Not done, deliberately — noted so the trade-off is visible rather than forgotten.

## 7. Test it

Don't wait for 3am. GitHub → repo → **Actions** tab → **Backup production database** (left sidebar) → **Run workflow** button → confirm.

Watch the run. If the "Dump roles, schema, and data" step fails, work down this list — these are the failures actually seen or predicted for this setup:

| Error contains | Cause | Fix |
|---|---|---|
| `could not translate host name` / `Network is unreachable` | `SUPABASE_PROD_POOLER_HOST` wrong, or it was set to the direct `db.<ref>.supabase.co` host (IPv6-only) | Re-do step 2, taking the **Session pooler** host |
| `password authentication failed` | Password wrong, or the pooler username is wrong because `SUPABASE_PROD_REF` points at the wrong project | Check step 1 and step 3 |
| `aborting because of version mismatch` | The PostgreSQL 17 client install step didn't take effect | Check the "Install PostgreSQL 17 client" step's `pg_dump --version` output |
| Connection times out entirely | The free-plan production project has auto-paused | Supabase dashboard → **Restore project**, then re-run |
| `is only N bytes — refusing to upload` | The dump ran but produced nothing usable | Don't re-run blindly; a near-empty dump means the connection succeeded but returned no schema — check you're pointed at production and not an empty project |
| `No existing credentials found` on the upload step | `VERCEL_TOKEN` missing — the Blob token alone does not complete an upload | Do step 6 |
| `does not start with 'vercel_blob_rw_'` | The `BLOB_READ_WRITE_TOKEN` secret holds something other than a Blob read-write token | Re-copy it in step 5 |

## 8. Verify the upload

Vercel dashboard → project → **Storage** → the Blob store → browse to `backups/<today's date>/` and confirm four files: `roles_*.sql`, `schema_*.sql`, `authdata_*.sql`, `data_*.sql`. All four should be well over 1KB — the workflow fails the run rather than uploading anything smaller.

## 9. Run the restore test (R4)

Setup isn't finished when the upload works. The story's actual requirement is a *proven* restore — download the four files, follow section 4 of [F225-database-backups.md](F225-database-backups.md) against a throwaway Supabase project, and record the result in that document's restore test log.

Delete the throwaway project afterwards. It will contain a full copy of production's personal data, including `auth.users`.
