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
- **Row-Level Security: enable RLS and add its policies in the same migration that creates the table** (SOP §7). A table is never committed with RLS left off "for later" — that would leave a window where the table is readable by anyone. **The full recipe is below ("Row-Level Security — securing a new table"); follow it for every table.**
  - Sequence step 15 (`enable_rls_policies`, F224) is **retained as a verification pass, not the place RLS is introduced**. By the time it runs, every table should already have RLS on. Step 15 is `scripts/verify-rls-coverage.sql`, run in CI on every migration; it cross-checks each table against the Security Controls Register (`docs/rls-permission-matrix.md`) and fails the build on anything missed.
  - _Decision: Bashir (Project Leader), 21 Jul 2026 — resolves the SOP §7 vs sequence-step-15 wording conflict._
- Never make an untracked manual change to a live database.
- Do not rename or drop a shared field without agreement on the Wednesday call.

## Row-Level Security — securing a new table

**Every `public` table must ship with RLS in its own migration (SOP §7).** This is not
optional and not deferred: `users` and `organisations` are the reference
implementations (`20260722103000_create_users.sql`,
`20260722103100_create_organisations.sql`), and the CI gate
(`scripts/verify-rls-coverage.sql`) fails any migration that skips a step below. The
authoritative per-table rules live in the **Security Controls Register**,
`docs/rls-permission-matrix.md` — find your table's row there first, then implement it.

**The five things, in order, in the same migration as `create table`:**

1. **REVOKE before you GRANT.** Supabase default-grants *all* privileges on new
   `public` tables to `anon` and `authenticated`, so a policy alone leaves every column
   writable. Start the security block with `revoke all ... from anon, authenticated;`
   then grant back only the verbs the matrix allows. Skipping this is how a CAM once
   escalated to admin (matrix §2.1). `anon` is granted **nothing** — no public sign-up.
2. **Enable RLS:** `alter table public.<t> enable row level security;`
3. **Write policies `to authenticated`, never `to public`** (`public` includes `anon`).
   Build them from the shared helpers — do **not** re-implement a role lookup:
   `app.is_admin()`, `app.is_active_user()`, `app.is_cam()`, `app.can_write()`,
   `app.owns_organisation(uuid)`, `app.organisation_is_unowned(uuid)`,
   `app.can_contact_organisation(uuid)`. AND `app.is_active_user()` into every policy so
   deactivation bites immediately.
4. **Conditional / single-column / reason-carrying writes are RPCs, not policies.**
   If a column must be writable by some but not by its own owner (e.g. `role`), grant
   it to nobody and expose a `SECURITY DEFINER` RPC that self-checks the role — see
   `set_user_role` (`20260723100100_create_user_role_rpc.sql`). A policy cannot forbid
   one column of an allowed row.
5. **Views:** any view over an RLS table must be `create view ... with (security_invoker = on)`,
   or it runs with the definer's rights and launders data around the policies.

Then: **add the table's row to `docs/rls-permission-matrix.md`** (table × op × role) and
update the Data Model. The coverage gate + the pgTAP suite
(`supabase/tests/rls_policies.test.sql`) verify it.

**Copy-paste skeleton** (a shared-read, owner-scoped-write child table — adjust to the
matrix row):

```sql
create table public.<table> (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id),
  author_id uuid not null references public.users (id),
  -- ... columns ...
  created_at timestamptz not null default now()
);

-- 1. revoke first, then grant only the allowed verbs
revoke all on public.<table> from anon, authenticated;
grant select, insert, update, delete on public.<table> to authenticated;

-- 2. RLS on
alter table public.<table> enable row level security;

-- 3. policies to authenticated, built from helpers, gated on is_active
create policy <table>_select on public.<table>
  for select to authenticated
  using (app.is_active_user());                     -- shared read

create policy <table>_insert on public.<table>
  for insert to authenticated
  with check (app.can_write() and author_id = (select auth.uid()));

create policy <table>_modify_own on public.<table>
  for update to authenticated
  using (app.is_active_user() and (author_id = (select auth.uid()) or app.is_admin()))
  with check (app.is_active_user() and (author_id = (select auth.uid()) or app.is_admin()));

create policy <table>_delete_own on public.<table>
  for delete to authenticated
  using (author_id = (select auth.uid()) or app.is_admin());
```

Pair it with a rollback, add the matrix row, run `supabase db reset` (replays the gate),
and the pgTAP suite picks the table up automatically.

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
