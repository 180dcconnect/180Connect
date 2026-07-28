# F225 — Database backup and restore strategy

Owner: Ben Phillips. Reviewer: Bashir Bobboi. Relates to open questions **D-01** and **Q-01** in [open-questions.md](../open-questions.md) — read those first, they're the accepted-deviation record this doc turns into a working process. Written with Claude, checked and updated by Ben Phillips.

## Current state

The project's Supabase project ("Development") is on the **Free plan**. On Free:

- No automatic backups of any kind.
- No point-in-time recovery (PITR) — not available at any price below Pro.
- Free projects also pause automatically after a period of inactivity.

This is already recorded as an accepted PRD deviation (D-01): the PRD (§16.3 step 17) requires daily backups and PITR, and MVP acceptance journey #13 ("backup restore is demonstrated and documented") cannot pass while we're on Free. There is no budget for the Pro plan right now, which makes this Free-tier approach below the actual near-term direction. Also raised: if the project ever paid for Pro and then lapsed for a month or two, Supabase's native Pro backups are lost (not archived) once the project drops back to Free — a reason to keep the external dump process in section 3 running as a baseline even if Pro is adopted later, rather than relying on Pro's own backups alone.

## Requirements (from the PRD)

Pulled from `180_Connect_Complete_PRD.md` so every candidate below is scored against the same fixed list, not argued case-by-case.

| # | Requirement | Source | Plain English |
|---|---|---|---|
| R1 | Daily automated backups | §14.2 | Back up the database every day, not just occasionally. |
| R2 | Recovery point objective ≤ 24h data loss | §14.2 | If we lose data, at most a day's worth should be unrecoverable. |
| R3 | Recovery time objective ≤ 4h | §14.2 | Restoring from backup should take under 4 hours end-to-end. |
| R4 | Documented restore test before launch | §14.2, §15, MVP acceptance journey #13 | We must actually prove a restore works, not just assume it. |
| R5 | Secrets/credentials never in source control, encrypted | §15 | Whatever holds the DB password or storage keys must not leak into git. |
| R6 | Staging and production use separate credentials | §15 | Don't reuse the same access keys/secrets across environments. |
| R7 | Processor records & transfer safeguards maintained for every processor | §15 | Any new third party that stores our data needs a GDPR processor record, and a transfer safeguard if it sits outside the UK/EU. |
| R8 | Retention periods documented; expired data deleted/anonymised | §15 | We must state how long dumps live, and actually delete/expire them rather than keep them forever. |
| R9 | Storage location minimises exposure of personal data | §14.4 (adjacent), §15 | Dumps contain the same personal data as the live database (contacts etc.), so wherever they land must be access-controlled. |

**Note on point-in-time recovery (PITR):** the PRD mentions PITR "where available" (§14.2, and the delivery-cadence table). It is **not** treated as a requirement here (no R-number), because it's a Supabase Pro feature — none of the storage destinations below can add it themselves, so scoring them against it would just mean every option "fails" the same non-applicable check. It's mentioned so it isn't confused for something these solutions are supposed to deliver: PITR is only relevant if/when Q-01 resolves to Pro, at which point it comes from Supabase directly, not from where dumps are stored.

## Recommended Free-tier Workaround

Since Supabase gives us no native backup mechanism on Free, back up manually using **`pg_dump`/`pg_dumpall`** — the plain PostgreSQL tools, not the Supabase CLI — on a schedule, to storage outside Supabase itself.

**Why `pg_dump`/`pg_dumpall` and not `supabase db dump`:** the Supabase CLI's `db dump` shells out to Docker even when dumping a remote database, which makes it a poor fit for a lightweight scheduled job and an extra thing to install on every machine that needs to run a restore test. `pg_dump`/`pg_dumpall` are the underlying tools the CLI itself wraps and need no Docker. Found this out by trying to run the CLI version locally and hitting a Docker-not-installed error (23 Jul 2026) — recorded here so nobody re-discovers it the hard way.

### 0. Two connection facts that decide everything below

Both were found by checking the live production project, and both silently break a backup job that ignores them.

**The client must be PostgreSQL 17, not whatever is already installed.** `180connect-production` runs PostgreSQL 17.6. `pg_dump` refuses to dump a server newer than itself — it exits with `server version: 17.6; pg_dump version: 16.x ... aborting because of version mismatch`. GitHub's `ubuntu-latest` runner ships the PostgreSQL **16** client, so the workflow installs `postgresql-client-17` from the PostgreSQL APT repository first. Same applies locally: a Postgres 16 install on your own machine cannot dump production either.

**Use the session-mode pooler, not the direct connection.** `db.<ref>.supabase.co` has no A record — it resolves to IPv6 only, unless the paid IPv4 add-on is enabled:

```
$ dig +short A    db.tugfhwiqvwrpvawpjwmd.supabase.co   # (nothing)
$ dig +short AAAA db.tugfhwiqvwrpvawpjwmd.supabase.co
2a05:d018:1b65:3000:...
```

GitHub-hosted runners have no IPv6, so a direct connection from CI cannot work at all. The connection therefore goes through Supavisor, the pooler, in **session mode** on port **5432** — transaction mode (port 6543) does not support `pg_dump`. That changes the shape of the credentials:

| | Direct (unusable from CI) | Session pooler (what we use) |
|---|---|---|
| Host | `db.<ref>.supabase.co` | `aws-<n>-<region>.pooler.supabase.com` |
| Port | 5432 | 5432 |
| Username | `postgres` | `postgres.<ref>` |

The exact host is copied from the Supabase dashboard (**Connect → Session pooler**) and stored as the repository variable `SUPABASE_PROD_POOLER_HOST` — see [`backup-setup.md`](backup-setup.md).

### 1. One-off setup

Local machine only needs the PostgreSQL **17** client tools (`pg_dump`, `pg_dumpall`, `psql`) — not a running Postgres server, but the major version does have to match production (see section 0). On Windows, via Chocolatey (already installed on this machine):

```bash
choco install postgresql17 --params '/Password:localtestonly' -y
```

This installs a full local PostgreSQL server as a side effect (Chocolatey doesn't offer a client-only package on Windows) — that's fine, we don't use the server part, only the `pg_dump`/`pg_dumpall`/`psql` command-line tools it brings. The `--params '/Password:...'` sets a password for the *local* server instance Chocolatey starts; it has nothing to do with the production database password.

Check what you actually got before trusting it — Chocolatey and Homebrew both happily leave an older `pg_dump` first on `PATH`:

```bash
pg_dump --version   # must report 17.x
```

### 2. Taking a manual backup

**One dump command is not enough.** A database splits into concerns a single dump cannot cover at once, and a plain schema dump captures only one of them. Roles, schema, auth rows and application rows each need their own dump, or a restore looks like it worked but comes back missing users, missing every row in every table, or — as the restore test actually produced — missing all application data while reporting success.

```bash
DATE=$(date -u +%Y%m%d)

# Connection details come from the environment rather than a URL — see the
# note on PGPASSWORD below.
export PGHOST="aws-0-eu-west-1.pooler.supabase.com"
export PGPORT=5432
export PGDATABASE=postgres
export PGUSER="postgres.tugfhwiqvwrpvawpjwmd"
read -rs PGPASSWORD && export PGPASSWORD   # paste the password, it won't echo

# 1. Roles — cluster-wide database users, which is why this uses pg_dumpall
#    (cluster level) rather than pg_dump (single-database level).
pg_dumpall --roles-only --no-role-passwords -f "roles_$DATE.sql"

# 2. Schema — table structures, RLS policies, functions. No row data.
pg_dump --schema-only --no-owner --no-privileges \
  --schema=public --schema=app -f "schema_$DATE.sql"

# 3. Auth data — the user accounts. Must be restored BEFORE public data.
pg_dump --data-only --no-owner --no-privileges \
  --schema=auth --exclude-table=auth.schema_migrations \
  -f "authdata_$DATE.sql"

# 4. Public data — the application's own rows.
pg_dump --data-only --no-owner --no-privileges \
  --schema=public -f "data_$DATE.sql"
```

Every flag above is here because the restore test (section 4) proved it was needed. None is decorative.

- **`PGPASSWORD` instead of a connection URL.** `postgresql://user:PASSWORD@host/db` breaks if the password contains `@ / # ? :` — the URL parser splits on them and the resulting error names the wrong host, so it reads like a networking problem rather than a quoting bug. Passing credentials through the standard `PG*` environment variables sidesteps that entirely. (**Never** commit the password; it belongs in `.env.local` or a GitHub Actions secret, same rule as any other secret.)
- **`--no-owner --no-privileges`.** The `postgres` role on Supabase is not a superuser, so it cannot restore `ALTER ... OWNER TO supabase_admin` statements. Dumping them guarantees a restore that errors on almost every object.
- **`--no-role-passwords`.** All 16 roles in this cluster are Supabase's own (`anon`, `authenticated`, `service_role`, the `supabase_*` set). Not one can be restored into a Supabase target — they are reserved roles that only a superuser may modify — and Supabase recreates them itself anyway. The file is still worth taking, because a *plain Postgres* restore target does need `anon`/`authenticated` to exist for the RLS policies to apply. What it should not carry is SCRAM password hashes for roles nobody can restore: credential material in the blob store, buying nothing.
- **`--schema=public --schema=app` on the schema dump.** A bare `pg_dump --schema-only` also drags in Supabase's managed schemas (`auth`, `storage`, `realtime`, `extensions`, `vault`, `graphql`), which already exist in any project you restore into. But `public` alone is *not* enough: this project also owns `app`, which holds the RLS helper functions — `app.is_admin()`, `app.can_write()`, `app.owns_organisation()` and the rest — that every policy in `public` calls. Dump `public` without `app` and the restore fails creating the first policy, because the function it references does not exist. (`create schema if not exists app;` appears in three migrations; an earlier version of this document wrongly claimed `public` was the only schema.)
- **`--exclude-table=auth.schema_migrations`.** Supabase's own auth-migration bookkeeping. `postgres` has no write permission on it, so restoring it fails — and because `pg_dump` emits `auth` before `public` when both are in one file, that single permission error aborted the restore *before any application data loaded at all*. Splitting auth and public into separate files is the other half of this fix: a Supabase-internal problem can no longer block the rows we actually care about.
- **Auth data before public data.** `public.users.id` is a foreign key to `auth.users(id)`. Reverse the order and every row fails.
- `$(date -u +%Y%m%d)` is shell command substitution: it runs `date`, formats it as YYYYMMDD, and drops the result into the filename, e.g. `schema_20260723.sql`. `-u` for UTC, so a dump taken at 00:30 BST doesn't land under yesterday's date. Note the `%` — `date +20260723` (no `%`) just echoes that literal text back instead of computing anything, a mistake worth knowing about since it silently "works" today and silently breaks tomorrow.
- All four are plain-text SQL files. Restoring means replaying them back through `psql`, in the order **roles → schema → authdata → data** — see [section 4](#4-restore-process).

**What these files contain.** `data_*.sql` includes every row of `auth.users` — email addresses and password hashes — alongside the organisation and contact data in `public`. `roles_*.sql` includes role password hashes. These dumps are the most sensitive artefacts the project produces, which is what makes the Blob store's private access (R9) load-bearing rather than a nicety: anyone who can read the store can read the whole database.

### 3. Automating it

A manual step that depends on someone remembering to run it is not a backup strategy. Implemented as `.github/workflows/backup-production.yml`, following the same pattern as the existing `migrations.yml` (F232) — a GitHub Action that:

1. Triggers on a cron schedule (daily at 03:00 UTC) and on `workflow_dispatch` (a manual "Run workflow" button in GitHub's Actions tab, used to test it on demand instead of waiting for 3am).
2. Checks out the repo, then installs `postgresql-client-17` (the runner's own client is version 16, which cannot dump a 17 server — section 0) and a pinned `vercel@57`. The CLI is pinned deliberately: an unpinned nightly job picks up whatever was published that day, including breaking changes to `vercel blob` flags.
3. Runs all four dumps from section 2 (roles, schema, auth data, public data), connecting through the session pooler with `PGUSER`/`PGPASSWORD`. The password is a **GitHub Actions secret** (`SUPABASE_PROD_DB_PASSWORD`) — never in the workflow file itself.
4. **Fails loudly rather than silently producing nothing.** The free-plan production project auto-pauses after inactivity; if that happens the dump step fails, and a failed step fails the job, which GitHub emails to everyone watching the repo by default. That email is the "fail visibly" requirement, satisfied without new infrastructure. The dump commands are deliberately *not* wrapped in `|| true`. The step also rejects any dump file under 1KB, because a truncated or empty dump that uploads cleanly is worse than a failure — it looks like a backup.
5. Uploads all four files to Vercel Blob under a path prefixed with the date, with `--access private` and `--allow-overwrite` (so a manual re-run on the same day replaces the day's files instead of erroring). This needs **two** secrets, not one — see [Why the upload needs two credentials](#why-the-upload-needs-two-credentials) below.
6. Deletes blobs older than 30 days (Vercel Blob has no automatic lifecycle/expiry, unlike R2 or S3, so this is a script step rather than a platform setting). The prune sweeps a *window* — every date from 31 to 180 days ago — not just the single day that has fallen out of retention. If it only pruned one day, any run the job missed would leave that day's dumps behind permanently, and personal data outliving its documented retention period is precisely what R8 exists to prevent. The 180-day window is the honest limit: if the workflow is dead longer than that, older dumps need pruning by hand.

See [`backup-setup.md`](backup-setup.md) for the exact secrets and variables to create and where to get each value from.

#### Why the upload needs two credentials

The upload step needs **both** `BLOB_READ_WRITE_TOKEN` and `VERCEL_TOKEN`. The Blob read-write token, despite being the store-specific credential, does not complete an upload on its own — the Vercel CLI fails with:

```
Error: No existing credentials found. Please run `vercel login` or pass "--token"
```

even when the Blob token is present, correctly named and well-formed. Adding `VERCEL_TOKEN` and changing nothing else turns the same run green.

This is worth recording because **testing it will actively mislead you**. Probe the CLI with a fake Blob token and it appears to need no account credential at all: an invalid token fails at *store resolution* —

```
Error: Vercel Blob: This store does not exist.
```

— and store resolution happens **before** the account-auth check. So every experiment with a made-up token gets a Blob-layer error and never reaches the second gate. Only a genuine Blob token gets far enough to reveal that a second credential is required. Vercel's own documentation reinforces the wrong conclusion here: it shows the read-write token used alone, including for raw `curl` against private blobs, which is true for direct API calls but not for `vercel blob put`.

The evidence is two runs differing in exactly one variable: [30335243869](https://github.com/180dcconnect/180Connect/actions/runs/30335243869) failed with no `VERCEL_TOKEN`, [30335757695](https://github.com/180dcconnect/180Connect/actions/runs/30335757695) passed with it added.

**Cost of this, and the way out.** A Vercel account token is account-wide, where the Blob token is scoped to one store, and any workflow in the repository can read it. The upload does not have to go through the CLI: `@vercel/blob` and a plain `curl` PUT both authenticate with `BLOB_READ_WRITE_TOKEN` alone, and either would let `VERCEL_TOKEN` be deleted. Left as-is deliberately, so the trade-off is visible rather than silently accepted.

#### Storage destination options considered

Where the dump ends up. Each candidate scored against R1–R9. Kept as the record of why Solution F was picked over the others (see [Decision](#decision-23-jul-2026)), not an open menu.

**Solution A: GitHub Actions build artifact**

| Req | Status | Why |
|---|---|---|
| R1 | ✅ Met | Cron-triggered workflow uploads a fresh artifact daily. |
| R2 | ✅ Met | Daily runs satisfy the 24h RPO. |
| R3 | ⚠️ Partial | Downloading + `psql` restore is quick, but artifacts aren't built for fast retrieval at scale — fine at our current data size, untested at 4h under real load. |
| R4 | ⚠️ Partial | Restore is doable, but no test has been run yet (see restore-process section). |
| R5 | ✅ Met | DB URL stored as a GitHub Actions secret, never in the workflow file. |
| R6 | ✅ Met | Separate secrets can be scoped per environment. |
| R7 | ⚠️ Partial | GitHub is already a processor for code; using it for data dumps too isn't a *new* processor, but the existing processor record needs updating to say so — not yet done. |
| R8 | ⚠️ Partial | Artifacts auto-expire (default 90 days, configurable), but no explicit retention decision has been recorded. |
| R9 | ⚠️ Partial | Private-repo artifacts are restricted to repo collaborators, which is broader than "people who need backup access" — no extra access control layer. |

**Bottom line:** cheapest and fastest to stand up; good for proving the automation works end-to-end, weakest on access control and retention discipline.

**Solution B: Private GitHub repo (separate from `180Connect`)**

| Req | Status | Why |
|---|---|---|
| R1 | ✅ Met | Same cron-triggered push, committed instead of uploaded. |
| R2 | ✅ Met | Daily commits satisfy the 24h RPO. |
| R3 | ✅ Met | `git clone`/`git pull` + `psql` is a fast, ordinary retrieval path. |
| R4 | ⚠️ Partial | Restore is doable, not yet tested. |
| R5 | ✅ Met | Same secret handling as Solution A. |
| R6 | ✅ Met | Same as Solution A. |
| R7 | ⚠️ Partial | Same reasoning as Solution A — still GitHub, still needs the processor record updated. |
| R8 | ❌ Not met | Git history keeps every commit forever by default; pruning old dumps needs a manual/scripted step that doesn't exist yet. |
| R9 | ⚠️ Partial | Same collaborator-access caveat as Solution A. |

**Bottom line:** marginally better restore ergonomics than an artifact, but worse on retention — nothing expires automatically.

**Solution C: Cloudflare R2**

| Req | Status | Why |
|---|---|---|
| R1 | ✅ Met | Workflow uploads to a bucket daily via the Cloudflare API. |
| R2 | ✅ Met | Daily uploads satisfy the 24h RPO. |
| R3 | ✅ Met | Object storage retrieval is fast regardless of scale. |
| R4 | ⚠️ Partial | Doable, not yet tested. |
| R5 | ✅ Met | API token stored as a GitHub secret. |
| R6 | ✅ Met | Separate buckets or key-prefixes per environment. |
| R7 | ❌ Not met | Cloudflare would be a *new* processor — no processor record or transfer-safeguard assessment exists yet. R2 buckets can be pinned to an EU region, which would make that assessment easier, but it hasn't been done. |
| R8 | ✅ Met | R2 supports lifecycle rules that auto-delete objects past a set age — retention can be enforced, not just documented. |
| R9 | ✅ Met | Buckets are private by default, encrypted at rest, and access is scoped to an API token rather than repo collaborators. |

**Bottom line:** best-scoring option once R7 is done — it's the only one that meets R8 (enforced retention) and R9 (tight access control) without extra work, at the cost of being a new GDPR processor to document first.

**Solution D: Backblaze B2**

| Req | Status | Why |
|---|---|---|
| R1–R6 | ✅ Met | Same shape as Solution C — daily upload, fast retrieval, secrets as a GitHub secret, separate buckets per environment. |
| R7 | ❌ Not met | Also a new processor requiring a record and transfer-safeguard assessment — same gap as R2, no advantage over it here. |
| R8 | ✅ Met | Lifecycle rules supported, same as R2. |
| R9 | ✅ Met | Private buckets, application-key scoped access. |

**Bottom line:** functionally equivalent to Solution C with no clear edge over it, and a small egress cost beyond the free allowance where R2 has none — no reason to prefer it over Solution C.

**Solution E: AWS S3**

| Req | Status | Why |
|---|---|---|
| R1 | ✅ Met | Same daily-upload shape. |
| R2 | ✅ Met | Daily uploads satisfy the 24h RPO. |
| R3 | ✅ Met | Fast retrieval regardless of scale. |
| R4 | ⚠️ Partial | Doable, not yet tested. |
| R5 | ✅ Met | IAM access keys stored as a GitHub secret. |
| R6 | ✅ Met | Separate buckets/IAM roles per environment. |
| R7 | ❌ Not met | A new processor, and — being a US-headquartered provider — the transfer-safeguard assessment carries more scrutiny than Cloudflare or Backblaze even with an EU region selected. |
| R8 | ✅ Met | S3 lifecycle rules support auto-expiry. |
| R9 | ⚠️ Partial | Achievable with SSE encryption and least-privilege IAM, but S3's IAM model is the fiddliest of these to configure correctly — more room to get access control wrong. |

**Bottom line:** no requirement it meets that Solution C doesn't, more setup risk on R9, and only worth it if the team already has an AWS account in active use elsewhere (it doesn't).


**Solution F: Vercel Blob storage**

| Req | Status | Why |
|---|---|---|
| R1 | Met | Workflow uploads to a Blob store daily via Vercel's API. |
| R2 | Met | Daily uploads satisfy the 24h RPO. |
| R3 | Met | Object storage retrieval is fast regardless of scale. |
| R4 | Partial | Doable, not yet tested. |
| R5 | Met | Vercel API token stored as a GitHub secret. |
| R6 | Met | Separate stores/paths per environment. |
| R7 | Partial | Vercel is already a processor for this project (it hosts the app). Adding Blob storage extends what we use them for rather than starting a new vendor relationship from zero — the existing processor-record entry needs a line added for "backup dumps" as a new data category, instead of a brand-new DPA being sought from scratch. Lighter lift than Solutions C/D/E, but still not done yet. |
| R8 | Partial | Vercel Blob supports deleting objects programmatically, but has no R2/S3-style automatic lifecycle expiry — the workflow would need to do the pruning itself. |
| R9 | Met | Private by default; access scoped to the API token. |

**Bottom line:** the strongest option for minimising new GDPR paperwork, since it reuses a processor relationship that already exists rather than creating one. Trade-off: manual retention pruning instead of R2/S3's built-in lifecycle rules.


## Other options considered and set aside
Google Cloud Storage, Wasabi, and iDrive e2 were also looked at. None meaningfully differ from Solutions C-E — all are S3-compatible object storage with a free tier, a new-processor problem, and no structural advantage over Cloudflare R2. Google Cloud Storage is also a separate Google product from the Gmail OAuth scopes already in use, so despite Google already being a listed processor, using it still means documenting a new relationship rather than extending an existing one the way Vercel Blob does.

## Decision (23 Jul 2026)

**Solution F — Vercel Blob storage — chosen.** Vercel Blob was picked because it reuses a processor relationship the project already has (Vercel hosts the app), which keeps the GDPR paperwork (R7) to "add a line to an existing processor record" rather than starting a new vendor assessment from zero.

# Additional Requirements Pertaining to Solution F

1. **R4 must be genuinely tested, not assumed.** A restore has to actually be run and verified — see [section 4](#4-restore-process). Flagged specifically because a single dump command does **not** capture everything needed to recreate the database — see the note in section 2.
2. **Retention (R8) is a script, not a platform feature.** Vercel Blob has no built-in auto-expiry (unlike R2/S3), so the workflow deletes old dumps itself — see section 3.
3. **Fail visibly, per the project's own SOP.** The free-plan production project auto-pauses after inactivity. If the nightly job can't connect because of that, it must not just silently do nothing — it has to fail the GitHub Actions run loudly, in line with "errors propagate to the UI and `ERROR_LOG`, nothing fails silently."

The comparison table is kept as the record of why F was chosen over the others, not as a menu still open for debate.

### 4. Restore process (Free plan)

Order matters: **roles → schema → auth data → public data.** Data before schema fails (no tables to insert into); public data before auth data fails on the `public.users` → `auth.users` foreign key.

This procedure is written from an actual run (see [Restore test results](#restore-test-results)), not from what ought to work. The awkward steps are in it because without them the restore stops.

1. Provision a target. A local Supabase stack is the cheapest option and behaves closely enough to a fresh project:
   ```bash
   supabase db reset          # empty database with the auth schema and Supabase roles present
   LOCAL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
   ```
2. **Drop `public` without recreating it.** The schema dump contains `CREATE SCHEMA public;`, so the target must not already have one:
   ```bash
   psql "$LOCAL" -c 'drop schema public cascade;'
   ```
   Recreating it by hand — the obvious instinct — makes the restore fail on its first statement. This applies to a fresh Supabase project too, since those ship with `public` already present.
3. Restore roles, **without** `ON_ERROR_STOP`:
   ```bash
   psql "$LOCAL" -f roles_20260727.sql
   ```
   This one file is expected to produce a wall of errors, all of one of three kinds: `role "x" already exists`, `"x" is a reserved role, only superusers can modify it`, `permission denied to grant/alter`. Every role in the dump is Supabase-managed and already present. Skim for anything that is *not* one of those three shapes; there should be nothing.
4. Restore schema, auth data, then public data — these three **must** run clean:
   ```bash
   psql "$LOCAL" -v ON_ERROR_STOP=1 -f schema_20260727.sql
   psql "$LOCAL" -v ON_ERROR_STOP=1 -f authdata_20260727.sql
   psql "$LOCAL" -c 'truncate public.users cascade;'
   psql "$LOCAL" -v ON_ERROR_STOP=1 -f data_20260727.sql
   ```
   **Why the `truncate` in the middle.** The `on_auth_user_created` trigger on `auth.users` calls `app.handle_new_auth_user()`, which inserts a `public.users` row for every account. Restoring auth data therefore fires it once per user and pre-populates `public.users` with *generated* rows, which then collide with the real backed-up ones. The obvious fix — disable the trigger — is not available: it lives on `auth.users`, owned by `supabase_auth_admin`, and `postgres` gets `must be owner of table users`. Clearing the generated rows immediately before loading the real ones is what works.

   **`-v ON_ERROR_STOP=1` is not optional here.** By default `psql` prints an error, carries on, and exits 0. In the recorded test run, one permission error on a Supabase-internal table aborted a restore that had loaded *zero* application rows — and without this flag it would have exited 0 and been written up as a pass.
5. Verify against the source, don't eyeball:
   ```sql
   select relname, n_live_tup from pg_stat_user_tables
   where schemaname = 'public' order by relname;
   ```
   Run on both databases and diff. `n_live_tup` is an estimate, so follow up with exact counts on what matters:
   ```sql
   select (select count(*) from auth.users) auth_users,
          (select count(*) from public.users) public_users,
          (select count(*) from public.organisations) orgs,
          (select count(*) from public.audit_log) audit;
   ```
6. Update any environment variables (`NEXT_PUBLIC_SUPABASE_URL`, etc.) if the restore target is a new project rather than the original.
7. Record the result in the log below — date, who ran it, source, target, counts, anything that went wrong. An unrecorded restore test does not satisfy R4.

**Known gap, not yet closed.** The `on_auth_user_created` trigger sits on `auth.users`, so it is in none of these dumps. Restore into a genuinely fresh project and new signups will not populate `public.users` until the migrations are applied. The robust long-term shape is probably: apply migrations to the fresh project first (they are the schema's source of truth per SOP §7), then restore data only, treating `schema_*.sql` as a point-in-time cross-check rather than the restore mechanism. Raised here rather than silently changed, because it is a change to the strategy and not just to a flag.

### Restore test results

**27 Jul 2026 — passed, with five defects found and fixed.** Run by Bashir Bobboi.

- **Source:** `180connect-staging` (`cgbfhhdeapasniudyyds`), via the session pooler. Production was not used: it has no tables and no `supabase_migrations` schema — migrations have never been applied to it — so a restore test against it would have proved nothing.
- **Target:** local Supabase stack (`supabase db reset`), PostgreSQL 17.
- **Client:** `pg_dump` 18.3 locally. CI installs `postgresql-client-17`; both are ≥ the 17.6 server, which is the constraint that matters.
- **Result:** exact match on every count checked — `auth.users` 10/10, `public.users` 8/8, `organisations` 0/0, `audit_log` 1/1.

Five defects, each fixed in the workflow or the procedure above:

| # | Defect | Fix |
|---|---|---|
| 1 | `auth.schema_migrations` is not writable by `postgres`, and sorts before `public`, so the restore aborted having loaded **no application data at all** | `--exclude-table`, and auth/public split into separate dump files |
| 2 | Schema dump emits `CREATE SCHEMA public;`, which collides with the `public` every Supabase project already has | Drop `public` without recreating it |
| 3 | `--schema=public` omitted the `app` schema, so RLS policies referenced helper functions that did not exist | `--schema=public --schema=app` |
| 4 | `on_auth_user_created` pre-creates `public.users` rows during the auth restore; the trigger cannot be disabled by `postgres` | `truncate public.users cascade` between the auth and public restores |
| 5 | Roles dump carried 10 SCRAM password hashes for roles that cannot be restored into Supabase at all | `--no-role-passwords` |

Defect 1 is the one worth remembering. Without `ON_ERROR_STOP=1` it would have surfaced as a successful restore containing none of the data.

**Still outstanding for full R4 sign-off:** re-run against production once production holds real data. This run proves the *procedure*; only a production run proves the *artifact*.

### Production backup runs

**28 Jul 2026 — first successful production backup.** Run [30335757695](https://github.com/180dcconnect/180Connect/actions/runs/30335757695), triggered manually. Four files uploaded to the private Blob store under `backups/20260728/`:

| file | size |
|---|---|
| `schema_20260728.sql` | 20,361 B |
| `authdata_20260728.sql` | 6,694 B |
| `roles_20260728.sql` | 5,643 B |
| `data_20260728.sql` | 1,502 B |

Production had schema but no rows at this point, which is why `data_*.sql` is small — it carries the per-table `COPY` headers and no data. That is a legitimately empty database, not a truncated dump, and it is the case the 1KB guard was sized against.

Two earlier runs failed and are worth keeping in the record: [30242064570](https://github.com/180dcconnect/180Connect/actions/runs/30242064570) and [30335243869](https://github.com/180dcconnect/180Connect/actions/runs/30335243869), both on the missing `VERCEL_TOKEN` described above. The dump half of the workflow succeeded in all three.

**Not yet demonstrated:** an unattended run. Every run so far has been `workflow_dispatch`. The 03:00 UTC cron firing green on its own is what actually evidences "backed up on a defined schedule"; until then the schedule is configured but unproven.

**Restore test log (R4):** see [Restore test results](#restore-test-results) at the bottom of this doc.