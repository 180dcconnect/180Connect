# Database Migrations

How 180Connect manages Postgres schema changes. Implements **F232 — Database Migration Management** and **SOP §7 (Database and Schema Changes)**.

> **One source of truth:** the Data Model spreadsheet governs the schema. Every schema change updates the Data Model (table tab **+ tab 02 Data Dictionary**) *before* the migration is written, and follows the order in Data Model tab **"11 Supabase Migration Sequence"**.

## Tooling

Supabase CLI native migrations. Plain SQL under `supabase/migrations/`, applied in filename (timestamp) order.

- **Staging** project: `180connect-staging` (`cgbfhhdeapasniudyyds`)
- **Production** project: `180connect-production` (`tugfhwiqvwrpvawpjwmd`)

## Conventions (SOP §7 — enforced in review)

- Migration files live in `supabase/migrations/`, never edited after they've been applied to a shared environment. Fix-forward with a new migration.
- Table names `UPPER_SNAKE`; field names `lower_snake`.
- Every new table includes `id uuid` primary key (default `gen_random_uuid()`) and `created_at timestamptz not null default now()`.
- Row-Level Security: per the migration sequence, RLS policies land at **step 15 (`enable_rls_policies`, F224)**. _Open point for the Wednesday call: SOP §7 wording says enable RLS in the same migration as the table — reconcile with the sequence before create_users lands._
- Never make an untracked manual change to a live database.
- Do not rename or drop a shared field without agreement on the Wednesday call.

## Reversibility (F232 AC3 — no one-way doors)

Supabase migrations are apply-only. Each migration is therefore paired with **one** of:

1. a rollback file at `supabase/rollback/<same-timestamp>_<name>.down.sql` that reverses it, **or**
2. an explicit `-- IRREVERSIBLE: <reason>` header in the migration when reversal is impossible (e.g. a destructive data drop).

The reviewer confirms one of the two exists for every migration.

- **Local rollback:** `supabase db reset` rebuilds the local DB from scratch by replaying all migrations (drops everything first).
- **Staging/prod rollback:** apply the paired `*.down.sql` against the target, then remove the migration from history. Prefer point-in-time recovery (SOP §8) for data-loss incidents.

## Workflows

### Create a migration
```bash
supabase migration new <name>        # e.g. create_organisations
# write forward SQL in supabase/migrations/<ts>_<name>.sql
# write reverse SQL in supabase/rollback/<ts>_<name>.down.sql  (or add -- IRREVERSIBLE header)
```

### Run locally
```bash
supabase start                       # local stack
supabase migration up                # apply pending migrations
# ...verify...
supabase db reset                    # full rebuild (tests migrations from clean)
```

### Apply to staging (after review)
```bash
supabase link --project-ref cgbfhhdeapasniudyyds
supabase db push                     # applies pending migrations to staging
```
Production `db push` happens only through the release process, never ad hoc.

### New developer setup
```bash
supabase init      # already committed; skip if supabase/ exists
supabase start     # local stack
supabase migration up   # or `supabase db reset` to replay all
```

## Schema change approval record (SOP §7 — paste into the PR)

| Field | Entry |
| :---- | :---- |
| Story / PR | Linked GitHub issue + PR |
| Affected tables | Every table, view, function or policy changed |
| Migration | Filename + sequence step number |
| Compatibility | Impact on other streams, jobs, dashboards |
| Data migration | Backfill / transformation required |
| Security | RLS policies + service-role behaviour |
| Documentation | Data Model + Data Dictionary updated (Y/N) |
