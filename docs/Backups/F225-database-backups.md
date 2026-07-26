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

**One dump command is not enough.** A database splits into three separate concerns, and a plain schema dump only captures one of them. Roles (database users/permissions) and data (the actual rows) each need their own dump, or a restore looks like it worked but comes back missing users or every row in every table.

```bash
DATE=$(date -u +%Y%m%d)

# Connection details come from the environment rather than a URL — see the
# note on PGPASSWORD below.
export PGHOST="aws-<n>-eu-west-1.pooler.supabase.com"
export PGPORT=5432
export PGDATABASE=postgres
export PGUSER="postgres.tugfhwiqvwrpvawpjwmd"
read -rs PGPASSWORD && export PGPASSWORD   # paste the password, it won't echo

# 1. Roles — database users and their permissions. Roles are cluster-wide,
#    not per-database, which is why this uses pg_dumpall (cluster level),
#    not pg_dump (single-database level). Must be restored FIRST, since
#    schema objects (e.g. RLS policies) can reference roles that don't
#    exist yet otherwise.
pg_dumpall --roles-only -f "roles_$DATE.sql"

# 2. Schema — table structures, RLS policies, functions. No row data.
pg_dump --schema-only --no-owner --no-privileges \
  --schema=public -f "schema_$DATE.sql"

# 3. Data — every row, no table structure. Restored last, once 1 and 2 exist.
pg_dump --data-only --no-owner --no-privileges \
  --schema=public --schema=auth -f "data_$DATE.sql"
```

- **`PGPASSWORD` instead of a connection URL.** `postgresql://user:PASSWORD@host/db` breaks if the password contains `@ / # ? :` — the URL parser splits on them and the resulting error names the wrong host, so it reads like a networking problem rather than a quoting bug. Passing credentials through the standard `PG*` environment variables sidesteps that entirely. (**Never** commit the password; it belongs in `.env.local` or a GitHub Actions secret, same rule as any other secret.)
- **`--no-owner --no-privileges`.** The `postgres` role on Supabase is not a superuser, so it cannot restore `ALTER ... OWNER TO supabase_admin` statements. Dumping them guarantees a restore that errors on almost every object.
- **`--schema=public` on the schema dump.** A bare `pg_dump --schema-only` also dumps Supabase's own managed schemas (`auth`, `storage`, `realtime`, `extensions`, `vault`, `graphql`). Those already exist in any project you restore into, so the restore collides with itself. Everything this project owns lives in `public` — verified against `supabase/migrations/`, which creates no other schema.
- **`--schema=auth` on the *data* dump only.** Rows in `auth.users` are the user accounts. The schema is Supabase's to manage, but losing every login is not an acceptable restore, so the rows come along.
- `$(date -u +%Y%m%d)` is shell command substitution: it runs `date`, formats it as YYYYMMDD, and drops the result into the filename, e.g. `schema_20260723.sql`. `-u` for UTC, so a dump taken at 00:30 BST doesn't land under yesterday's date. Note the `%` — `date +20260723` (no `%`) just echoes that literal text back instead of computing anything, a mistake worth knowing about since it silently "works" today and silently breaks tomorrow.
- All three are plain-text SQL files. Restoring means replaying them back through `psql`, in the order **roles → schema → data** — see [section 4](#4-restore-process).

**What these files contain.** `data_*.sql` includes every row of `auth.users` — email addresses and password hashes — alongside the organisation and contact data in `public`. `roles_*.sql` includes role password hashes. These dumps are the most sensitive artefacts the project produces, which is what makes the Blob store's private access (R9) load-bearing rather than a nicety: anyone who can read the store can read the whole database.

### 3. Automating it

A manual step that depends on someone remembering to run it is not a backup strategy. Implemented as `.github/workflows/backup-production.yml`, following the same pattern as the existing `migrations.yml` (F232) — a GitHub Action that:

1. Triggers on a cron schedule (daily at 03:00 UTC) and on `workflow_dispatch` (a manual "Run workflow" button in GitHub's Actions tab, used to test it on demand instead of waiting for 3am).
2. Checks out the repo, then installs `postgresql-client-17` (the runner's own client is version 16, which cannot dump a 17 server — section 0) and a pinned `vercel@57`. The CLI is pinned deliberately: an unpinned nightly job picks up whatever was published that day, including breaking changes to `vercel blob` flags.
3. Runs all three dumps from section 2 (roles, schema, data), connecting through the session pooler with `PGUSER`/`PGPASSWORD`. The password is a **GitHub Actions secret** (`SUPABASE_PROD_DB_PASSWORD`) — never in the workflow file itself.
4. **Fails loudly rather than silently producing nothing.** The free-plan production project auto-pauses after inactivity; if that happens the dump step fails, and a failed step fails the job, which GitHub emails to everyone watching the repo by default. That email is the "fail visibly" requirement, satisfied without new infrastructure. The dump commands are deliberately *not* wrapped in `|| true`. The step also rejects any dump file under 1KB, because a truncated or empty dump that uploads cleanly is worse than a failure — it looks like a backup.
5. Uploads all three files to Vercel Blob using a `BLOB_READ_WRITE_TOKEN` secret, under a path prefixed with the date, with `--access private` and `--allow-overwrite` (so a manual re-run on the same day replaces the day's files instead of erroring).
6. Deletes blobs older than 30 days (Vercel Blob has no automatic lifecycle/expiry, unlike R2 or S3, so this is a script step rather than a platform setting). The prune sweeps a *window* — every date from 31 to 180 days ago — not just the single day that has fallen out of retention. If it only pruned one day, any run the job missed would leave that day's dumps behind permanently, and personal data outliving its documented retention period is precisely what R8 exists to prevent. The 180-day window is the honest limit: if the workflow is dead longer than that, older dumps need pruning by hand.

See [`backup-setup.md`](backup-setup.md) for the exact secrets and variables to create and where to get each value from.

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

Order matters: **roles, then schema, then data.** Restoring data before the schema exists fails (no tables to insert into); restoring schema before roles exist can fail if a policy references a role that doesn't exist yet.

1. Provision a target: a fresh Supabase project, or an empty local Postgres instance (`supabase start`) for a dry run.
2. Restore in order:
   ```bash
   psql "<target-db-url>" -v ON_ERROR_STOP=1 -f roles_20260723.sql
   psql "<target-db-url>" -v ON_ERROR_STOP=1 -f schema_20260723.sql
   psql "<target-db-url>" -v ON_ERROR_STOP=1 -f data_20260723.sql
   ```

   **`-v ON_ERROR_STOP=1` is not optional.** By default `psql` prints an error, carries on to the next statement, and exits 0. A restore that dropped half the tables therefore *looks* like it succeeded. Since the entire point of R4 is proving a restore works, a silent partial restore is the exact failure this test exists to catch.

   Two expected-and-fine exceptions when restoring into a **fresh Supabase project** (rather than empty Postgres): the roles file will fail on roles Supabase already creates (`postgres`, `authenticator`, `anon`, …), and `data_*.sql` will conflict on the `auth.users` rows Supabase seeds. Read the error, confirm it is that and not something else, then re-run the affected file without `ON_ERROR_STOP` — never skip straight to running everything without it.
3. Verify row counts / spot-check key tables against what's expected. Compare against the source:
   ```sql
   select relname, n_live_tup from pg_stat_user_tables
   where schemaname = 'public' order by relname;
   ```
   Run it on both databases and diff. `n_live_tup` is an estimate, so follow up with an exact `count(*)` on the two or three tables that matter most (`ORGANISATIONS`, `CONTACTS`, `USERS`).
4. Update any environment variables (`NEXT_PUBLIC_SUPABASE_URL`, etc.) if the restore target is a new project rather than the original.
5. Record the result in the restore test log below — date, who ran it, target, row counts checked, anything that went wrong. An unrecorded restore test does not satisfy R4.

### Restore test results

_Not yet run._ This section is R4 and the story is not done until it has an entry.

**Restore test log (R4):** see [Restore test results](#restore-test-results) at the bottom of this doc.