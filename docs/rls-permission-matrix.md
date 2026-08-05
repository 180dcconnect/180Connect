# RLS Permission Matrix

**Story:** F224 — Row-Level Security. **Owner:** Bashir. **Reviewer:** Ben.
**Status:** approved by Ben (23 July 2026). **Last updated:** 23 July 2026.

This document is the **Security Controls Register** referenced by step 15 of the
Supabase migration sequence (Data Model tab 11). Tab 12 was never created; this file
replaces it and is the authoritative source.

It translates the PRD's capability matrix (§4.3) into what Postgres can actually
enforce: **table × operation × role × predicate**. Every table migration must
implement its row of this document in the same migration that creates the table
(SOP §7).

**Naming.** Tables are `UPPER_SNAKE` in the Data Model but unquoted `lower_snake` in
Postgres (`public.users`, not `"USERS"`) — the Data Model name is documentation, the
lower name is the identifier. The matrix tables below keep the Data Model names for
traceability; SQL uses the lower names.

**Helpers.** All RLS helpers live in the `app` schema, which is **not** in PostgREST's
exposed schema list — so none is reachable as a REST RPC (this is what keeps security
advisors 0028 / 0029 clean; see §7). Base role checks come from `create_users` (F233):
`app.is_admin()` and `app.is_active_user()`, each a `SECURITY DEFINER` lookup against
`public.users`. The richer predicates — `app.is_cam()`, `app.can_write()`,
`app.owns_organisation()`, `app.organisation_is_unowned()`,
`app.can_contact_organisation()` — come from `create_rls_helpers` (F224). Every one is
`SECURITY DEFINER` with `set search_path = ''`; `authenticated` is granted `EXECUTE`
(policies need it), `anon` is not.

---

## 1. Roles

| Role | Postgres identity | Notes |
|---|---|---|
| `admin` | `authenticated` + `USERS.role = 'admin'` | Full authorised management access |
| `cam` | `authenticated` + `USERS.role = 'cam'` | Shared read, ownership-scoped write |
| `viewer` | `authenticated` + `USERS.role = 'viewer'` | Read-only. `app.is_viewer()`; write denial comes from failing `app.can_write()` (F258) |
| service role | `service_role` | Background jobs. **Bypasses RLS entirely.** Server-side only |
| anonymous | `anon` | **No access to any table.** Public self-sign-up is prohibited (PRD §4.2) |

`USERS.is_active = false` revokes everything. Every policy is `AND`ed with
`app.is_active_user()`. A deactivated account can read nothing and write nothing,
even with a still-valid JWT — this is what satisfies PRD §4.2 "cannot refresh tokens,
send messages, or execute background actions".

Policies are always written `to authenticated`, never `to public`. `to public`
includes `anon`.

---

## 2. What RLS cannot do, and what covers the gap

This is the part that does not survive translation from §4.3. Recording it so
reviewers do not assume the matrix alone is sufficient.

| §4.3 capability | Why RLS alone fails | Mechanism | Status |
|---|---|---|---|
| CAM may edit own profile but **not** their own `role` | RLS is row-level; it cannot allow a row UPDATE while forbidding one column | `REVOKE` (§2.1) then column `GRANT` — `grant update (full_name) on public.users to authenticated`. `role`/`is_active` granted to nobody; an admin role change goes through an RPC (F012) | **shipped** in create_users (F233); F012 RPC still to build |
| CAM claims an **unowned** organisation | Needs a write to `ORGANISATIONS.owner_id`, otherwise off-limits | Handled **in the UPDATE policy**, not an RPC: a CAM may target an unowned row and its `WITH CHECK` forces the new `owner_id` to be themselves. `claim_organisation(org_id)` as a `SECURITY DEFINER` RPC remains a future enhancement (F162) for atomic race-safety + an audit row | policy **shipped** in create_organisations (F233); RPC deferred to F162 |
| "Override pipeline stage — **reason required**" | Postgres cannot require a justification string as a condition of an UPDATE | `SECURITY DEFINER` RPC `override_outreach_status(org_id, status, reason)`. `reason` is `not null` and lands in the audit log | to build (F224) |
| "Reassign ownership: admin only" | Same column-level problem | Currently the org UPDATE policy allows an admin to set any `owner_id`; a dedicated `assign_organisation_owner` RPC (with audit) is the future form | admin path **shipped**; RPC deferred. The **offboarding** case is now covered: `deactivate_user` (F014) reassigns every organisation the departing user owns, with a required reason and one `ownership_reassigned` audit row per organisation, in the same transaction that closes the account. Since `20260804170000` it does not move `owner_id` itself — it delegates to `reassign_ownership` (F257), so the departing user's **open actions travel with their clients** instead of being stranded on a closed account. See §3.11 |
| Audit entries are immutable | RLS controls who writes, not whether a row can later change | `AUDIT_LOG` gets **no** UPDATE or DELETE policy for any role. Append-only by omission | needs the table (§6) |

**Rule that follows:** where a capability needs a *condition*, a *reason string*, or a
cross-user write, prefer an RPC over widening a policy. An RPC is `SECURITY DEFINER`
with `set search_path = ''` and re-checks the caller's role itself, because
`SECURITY DEFINER` bypasses the RLS that would otherwise protect it. The one place a
policy carries the logic directly is the unowned-claim above, where the `WITH CHECK`
can express "new owner must be me" without an RPC — see §3.2.

### 2.1 Grants: revoke before you grant

**Every table migration must begin its security block with a `REVOKE`.** This is not
tidiness; without it the rest of this document does not hold.

Supabase ships this in every project:

```sql
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
```

So a table is born with `SELECT, INSERT, UPDATE, DELETE` on **every column** already
granted to `anon` and `authenticated`. A later `grant update (full_name)` adds nothing
and removes nothing — the broad grant is still there, and the narrow one reads like a
restriction while being a no-op.

This was confirmed against staging on 22 Jul 2026: with policies in place exactly as
specified in §3.1, a CAM ran `update public.users set role = 'admin' where id = <self>`
and **succeeded**. The row policy allowed it (it is the CAM's own row) and nothing else
stood in the way. Every subsequent check in that test session then passed for the wrong
reason, because the attacker was an admin by then. `create_users` and
`create_organisations` (F233) now open their security blocks with the revoke; the CI
coverage gate (§5, `scripts/verify-rls-coverage.sql`) fails any table that ships
without it.

The required opening of every table's security block:

```sql
revoke all on public.<table> from anon, authenticated;
alter table public.<table> enable row level security;
-- then grant back only what the matrix allows, and only then write policies
grant select on public.<table> to authenticated;
```

RLS filters **rows**. Table and column privileges decide whether the statement is
allowed to run at all. Both are needed: a policy without a revoke leaves columns
exposed, and a grant without a policy exposes every row.

**Corollary for `users.role` and `users.is_active`:** these are granted to nobody,
including admins — Postgres column privileges attach to the Postgres role
(`authenticated`), which every signed-in user shares, so there is no way to grant the
column to admins alone. An admin changing a role therefore goes through the
`SECURITY DEFINER` RPC (F012), which re-checks `app.is_admin()` itself. A direct
`UPDATE ... set role` returns `42501` for every caller. That is the intended result,
not a bug to route around.

The column grant is the whole control here — verified sufficient against staging. A
belt-and-braces trigger guard on `role`/`is_active` was considered and left out:
create_users relies on the grant alone, and the coverage gate catches a forgotten
revoke, so the trigger earned its keep less than the extra moving part cost. Revisit if
a table ever needs a column granted for one purpose but protected for another.

---

## 3. Matrix

`own` = row belongs to `auth.uid()`. `owned` = the parent organisation's
`owner_id = auth.uid()`. `—` = no policy for that role, i.e. denied.

### 3.1 Identity

| Table | Op | Admin | CAM | Viewer |
|---|---|---|---|---|
| `USERS` | SELECT | all | all (team directory, F011) | all |
| `USERS` | INSERT | — (invite is service-role RPC, F008) | — | — |
| `USERS` | UPDATE | all rows | own row, granted columns only | own row, granted columns only |
| `USERS` | DELETE | — (deactivate, never delete) | — | — |

`role` is writable only through `public.set_user_role(user_id, role)` (F012) — a
SECURITY DEFINER RPC that self-checks `app.is_admin()`, refuses a self-change, and
writes an `audit_log` row (PRD §4.2). Nobody writes `role` directly, admins included.
`is_active` has the same treatment: `public.set_user_active(user_id, is_active)` (F013),
same column-grant lockout, same self-check, same audit row — `user_suspended` or
`user_reactivated`. See §2.1 and §7.

Suspension also **revokes the user's sessions**, in the same transaction, via
`app.revoke_sessions(uuid)` — a `DELETE` from `auth.sessions`, which invalidates their
access token and their refresh token at once. Flipping `is_active` denies them every
row, but it cannot invalidate a JWT that has already been issued; without the delete a
suspended user keeps a working token, and a logged-in-looking shell, until it expires.
Measured on GoTrue v2.193.1: with the session row gone, `GET /auth/v1/user` goes
`200 → 403` and a refresh returns `400`. This replaces an application-side
`auth.admin.signOut(userId)` call that could never work — that parameter is a JWT, not
a user id, and GoTrue has no by-user-id logout endpoint. `deactivate_user` revokes the
same way.

Which addresses may hold an account at all is decided one layer lower, by
`public.check_allowed_email_domain()` — a BEFORE INSERT trigger on `auth.users`
reading `app.allowed_email_domains` (20260804160000). It replaced a function that
hardcoded `'%@180dc.org'`, so an environment can now permit an extra domain for
testing with an INSERT rather than an edit to a security control. It fails closed
twice over: an empty table permits nothing, and an environment nobody configures
keeps only the seeded `180dc.org`, so production stays restricted by default and
needs no action to re-lock at the end of a testing period. `AUTH_ALLOWED_EMAIL_DOMAIN`
mirrors the list for the application's own validation and is deliberately *not*
authoritative — widening it alone changes a form message and admits nobody. The
table is in `app`, unreachable through PostgREST, with RLS on and no policies.
Recipe in [`auth/invite-email.md`](auth/invite-email.md).

`deactivated_at` (F014) is written only by `public.deactivate_user(user_id, reason,
reassign_to, release_clients)` and cleared only by `set_user_active(..., true)`. It is a
**marker, not a gate**: `is_active` alone decides whether anyone may log in or read a
row, and no policy or helper consults `deactivated_at`. It exists so the UI can tell a
suspension from an offboarding, which are otherwise the same `is_active = false`. The
constraint `users_deactivated_at_matches_inactive` makes the contradictory combination
(active *and* carrying a deactivation timestamp) unwritable by anyone, including a
future RPC. `deactivate_user` additionally refuses to close an account while it still
owns organisations unless given a destination, and moves them in the same transaction —
see §3.2.

### 3.2 Canonical organisation data — shared read, admin write

Everyone authorised reads canonical data (§4.3 "View canonical organisations": all
three roles yes). Writes to canonical records are admin-only; CAMs go through the
suggestion flow (F077).

**Known gap (tracked in §6).** The shipped `ORGANISATIONS` UPDATE policy lets a CAM who
owns a row also edit its *canonical* columns (`legal_name`, etc.), which this table
reserves for admins. Column privileges cannot separate "edit ownership" from "edit
canonical fields" — `authenticated` is one shared Postgres role — so closing it needs a
canonical-edit RPC or column-guard trigger (F224). The narrower unowned-org hole (a CAM
editing a row they do not own) *is* closed: the `WITH CHECK` uses
`coalesce(owner_id = auth.uid(), false)`, so a null owner no longer slips through.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `ORGANISATIONS` | all roles | admin | admin any row; CAM may claim an unowned row (WITH CHECK pins new `owner_id` to self) or edit one they own | admin |
| `ORGANISATION_IDENTIFIERS` | all roles | admin | admin | admin |
| `CONTACTS` | all roles | admin, cam | admin, cam | admin |
| `FINANCIAL_PERIODS` | all roles | admin | admin | admin |
| `GRANTS` | all roles | admin | admin | admin |
| `ENRICHMENT_RESULTS` | all roles | — (service role) | — | admin |
| `TAGS` | all roles | admin, cam | admin, own | admin |
| `ORG_TAGS` | all roles | admin, cam | admin, own | admin, own |

### 3.3 Notes — shared read, author write

F019 (read-only shared client visibility) requires every CAM to read every note.
§4.3 forbids viewers from creating them.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `NOTES` | all roles | admin, cam (`author_id = auth.uid()`) | admin, own | admin, own |

### 3.4 Outreach — ownership-scoped

The F018 contact-permission rule lives here. Read is shared (relationship history,
F019); **send** is restricted.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `OUTREACH_MESSAGES` | all roles | admin: any. cam: `sent_by_user_id = auth.uid()` **and** org is unowned or owned by self | admin, own drafts (`send_status = 'draft'`) | admin, own drafts |
| `AI_GENERATIONS` | all roles | — (service role) | — | admin |
| `SEND_EVENTS` | all roles | — (service role, Gmail webhook) | — | — |
| `REPLY_EVENTS` | all roles | — (service role) | — | — |
| `OUTCOMES` | all roles | admin, cam (`recorded_by_user_id = auth.uid()`) | admin, own | admin |

The CAM INSERT check on `OUTREACH_MESSAGES` is the database-layer expression of
"Send to an organisation owned by another CAM: Admin yes, CAM no". This is the
policy the acceptance criteria's "misuse attempt" test must target.

A sent message is immutable: the UPDATE predicate requires `send_status = 'draft'`.

### 3.5 Raw ingestion and data quality — admin only

§4.3 "View raw source records: Yes/technical admin, CAM no".

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `INGESTION_RUNS` | admin | admin (trigger refresh) | — | — |
| `RAW_SOURCE_RECORDS` | admin | — (service role) | — | admin |
| `DATA_QUALITY_EVENTS` | admin | — (service role) | admin (resolve) | — |
| `ENTITY_MATCH_CANDIDATES` | admin | — (service role) | admin (adjudicate) | — |
| `MANUAL_ENTRY_RECORDS` | admin, cam (own) | admin, cam | admin, own | admin |

`RAW_SOURCE_RECORDS` holds unfiltered third-party payloads. It is the
"sensitive data check" in the testing notes: a CAM `select *` must return **zero rows**,
not an error.

### 3.6 Model and scoring configuration — admin only

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `MODEL_VERSIONS` | admin | admin | admin | — |
| `SCORING_WEIGHTS` | admin | admin | admin | — |
| `FEATURE_DEFINITIONS` | admin | admin | admin | — |
| `AGENT_PROMPTS` | admin | admin | admin | — |
| `AGENT_RUNS` | admin | — (service role) | — | — |
| `LATEST_SCORES` | all roles | — (service role) | — | — |
| `EMAIL_PERFORMANCE_LIBRARY` | admin, cam | — (service role) | — | admin |

`LATEST_SCORES` is read-all: CAMs work the prioritised queue. The weights that
produce the scores are not readable by CAMs — knowing the weights makes them gameable.

### 3.7 Analytics

§4.3: team analytics — admin full, CAM limited/personal, viewer read-only if authorised.

The viewer reads `CAM_ACTIVITY_SUMMARY` in full, which follows §4.3 rather than departing
from it: a viewer is 180DC branch leadership (open-questions Q-05), and per-CAM throughput
is the substance of the oversight they exist to do. "If authorised" is read as satisfied by
holding the role — there is no per-user analytics flag, and none is planned.

Note what this means, since it is the one place a viewer sees something a CAM cannot: a
viewer reads **every** CAM's numbers, while a CAM still reads only their own. Read-only
does not mean sees-less-than-everyone. Decision: Project Leader, 24 Jul 2026 (Q-05).

| Table | SELECT | Write |
|---|---|---|
| `CAM_ACTIVITY_SUMMARY` | admin: all. cam: `user_id = auth.uid()`. viewer: all | service role only |
| `PIPELINE_METRICS` | all roles | service role only |
| `SECTOR_PERFORMANCE` | all roles | service role only |
| `API_HEALTH_LOGS` | admin | service role only |
| `INGESTION_SUMMARY` | admin | service role only |
| `COST_TRACKING` | admin | service role only |
| `ERROR_LOG` | admin | service role only |

`CAM_ACTIVITY_SUMMARY` is the second "sensitive data check": CAM A must not see
CAM B's conversion numbers. The check is on the **CAM** predicate specifically —
`user_id = auth.uid()` — not on "non-admins see only their own row". Admins and
viewers both read every row; only the CAM path is scoped.

### 3.8 Audit log

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `AUDIT_LOG` | admin | — (service role / `SECURITY DEFINER` RPC only) | **none** | **none** |

No UPDATE or DELETE policy is written for any role, including admin. An audit trail
an admin can edit is not an audit trail.

### 3.9 Views

`sector_trends` (step 14) is a view. Views run with the **definer's** permissions
unless created `with (security_invoker = on)`. Every view over an RLS-protected
table must be created `with (security_invoker = on)`, or it silently launders data
around the policies. This is a required check in the schema change approval record.

### 3.10 Login throttle

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `LOGIN_ATTEMPT` | admin | — (`SECURITY DEFINER` RPC only) | — (RPC only) | — (RPC only) |

Backs the F227 login throttle (`supabase/migrations/20260730010000_create_login_attempt.sql`).
Admin SELECT exists so someone can answer "is this person locked out?"; no role holds a
write, because a user who could reset their own counter could brute-force freely.

Two things about this table differ from every other row above, both deliberate:

- **Its RPCs are granted to `service_role`, not `authenticated`.** Every other RPC in this
  matrix is called by a signed-in user; these are called *before* anyone is signed in. The
  tempting move — grant `record_login_failure` to `anon` so the login action can call it
  with the publishable key — hands any caller a way to inflate any address's counter over
  `/rest/v1/rpc/`, with no CAPTCHA in the way, and so to keep a chosen user delayed. The
  login Server Action holds the service-role key instead (`src/lib/supabase/admin.ts`).
- **It stores a sha256 of the submitted email, and has no FK to `users`.** Most rows in an
  attack name accounts that do not exist, so a FK is impossible and the raw strings would
  make this a log of who tried to sign in (PRD §15 data minimisation).

The throttle reads no user table, so an unknown address is counted, blocked and messaged
exactly like a real one — it cannot be used to enumerate accounts. See §4 on why the
user-facing message stays uniform.

### 3.11 Actions — shared read, assignee write, admin assignment

Backs F168–F172 (`supabase/migrations/20260801100000_create_actions.sql`). Read is
shared for the same reason as notes and outreach (F019), and because F257's "the new CAM
can understand where the previous CAM left off" requires the incoming CAM to read the
outgoing one's open actions *before* the handover, not only after.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `ACTIONS` | all roles | admin: any. cam: `created_by_user_id = auth.uid()` **and** `assignee_user_id = auth.uid()` **and** org is unowned or owned by self | admin any row; cam where `assignee_user_id = auth.uid()` — **work columns only** | admin any row; cam own-created **and** own-assigned **and** `status = 'open'` |

`assignee_user_id` carries **no UPDATE grant for any role, admins included**, and neither
do `organisation_id` or `is_seed`. `authenticated` is one shared Postgres role, so column
privileges cannot hand admins a write the policies deny to CAMs (the constraint already
documented for canonical organisation columns in §3.2). Reassignment is instead a
reason-carrying write — F257 requires an `audit_log` row naming the old CAM, the new CAM
and why, which no policy can compel — so it goes through a `SECURITY DEFINER` RPC, per
the MIGRATIONS.md convention that produced `set_user_role` for `role`. Unlike §3.2's
known gap, this door is closed rather than deferred: the RPCs below are the only write
path, and they are admin-only.

**Reassignment RPCs** (`supabase/migrations/20260802100000_create_reassign_ownership_rpc.sql`):

| Function | Does | Refuses |
|---|---|---|
| `reassign_ownership(org_ids[], new_owner_id, reason, from_user_id)` | moves `organisations.owner_id` and the outgoing owner's **open** actions on those clients; one `audit_log` row per client (`ownership_reassigned`). A **null** `new_owner_id` releases to the unowned pool and unassigns those actions — the F014 release path | non-admin `42501`; blank reason, empty selection, deactivated or viewer recipient `22023` |
| `reassign_actions(action_ids[], new_assignee_id, reason)` | moves open actions by id — the F169 work sitting on clients the offboarded CAM never owned; one row per action (`action_reassigned`, carrying `organisation_id`) | same |

`from_user_id` is optional and does two jobs: it is a concurrency guard (the offboarding
screen's selection is a snapshot, so a client whose owner changed since is **skipped**,
not seized), and it decides whose actions move — work an admin assigned to a *third* CAM
on that client stays with them. Null is the F253 bulk-assign path, where each client's
current owner plays that part per row.

Only **open** actions move. Completed and cancelled ones stay with whoever did them, on
the same principle that keeps note and draft authorship put: reassignment transfers
responsibility, never history. Both functions return a jsonb summary including a
`skipped` count, so a partial batch reports itself instead of aborting and leaving the
admin to work out which of fifty clients was the problem.

A CAM assigning work to *another* CAM is F169 and stays admin-only — that is what the
`assignee_user_id = auth.uid()` predicate on INSERT enforces. Viewers create nothing
(§4.3), enforced by `app.is_cam()`.

Deletion requires the CAM to have **raised** the action and to **still hold** it, and it
must still be open. A completed or cancelled action is handover history and only an admin
may remove it. `cancelled` exists as a status for the same reason — an action dropped
during a handover is context the incoming CAM needs, and deleting it destroys that.

The assignment half of that test was added in `20260803100000_fix_actions_delete_policy.sql`
and is not cosmetic. Authorship is permanent and reassignment does not touch it, so
keying DELETE on `created_by_user_id` alone gave a standing right that survived the
handover: a CAM who moved teams — still active, so `app.is_active_user()` did not stop
them — could delete open work now assigned to the CAM who took over, on a client they no
longer owned. Because a DELETE blocked by USING removes zero rows and raises nothing
(§4), it would have failed silently and read as work that had never existed. That is the
loss F257 exists to prevent, reachable through F257's own table. Requiring both keeps the
intended case intact (raising something for yourself and dropping it before you start,
where the two are the same person) and closes the rest.

### 3.12 Onboarding state — own row only

Backs F255 (`supabase/migrations/20260805100000_create_user_onboarding.sql`). This is the
one place in the schema where a state-changing write is *not* an RPC. The audit-log
contract (`docs/audit-log-pattern.md` §1) covers ownership, status, role and approval
state; onboarding progress is a user's own view state, grants nothing, and no other
user's access depends on it. So it is governed by RLS and a column grant alone.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `USERS.onboarding_completed_at`, `USERS.onboarding_dismissed_at` | as `USERS` (§3.1: all roles read the directory) | — | own row, these two columns (all roles) | — |
| `USER_ONBOARDING_STEPS` | own rows (`user_id = auth.uid()`) | own rows | — (append-only) | — (append-only) |

The two `USERS` columns are the whole of AC5 and AC6: either one non-null hides the guide
permanently, and existing CAMs never see it because the predicate also requires
`role = 'cam'` and `invite_accepted_at is not null`. Both are nullable with no default, so
no backfill was needed and every pre-F255 row reads as "not finished, not dismissed".

They carry an explicit `grant update (...) to authenticated`, which is the only reason the
write succeeds — `create_users.sql` revokes all and grants `update (full_name)` only
(§2.1), and the existing `users_update_self_or_admin` policy confines it to the caller's
own row. Unlike `role` and `is_active`, there is nothing here an admin needs to write on
someone else's behalf, so no RPC exists and none is deferred.

`USER_ONBOARDING_STEPS` has **no UPDATE or DELETE grant for any role**, admins included.
A completed step is a fact about the past; the guide is hidden by the `USERS` columns,
never by deleting progress, so there is no legitimate reason to rewrite it — and a user
who could delete their own rows could make a dismissed guide reappear step by step.
Admins get no read either: nothing in F255 needs one, and F187 (admin views a CAM's
settings, P3) can add it with a stated reason when it is actually built.

Both policies AND in `app.is_active_user()` so deactivation bites immediately. Neither
uses `app.can_write()` — that helper gates *client data* and excludes viewers (F258),
which is the wrong test for a row a user writes about themselves.

---

### 3.13 Outreach preferences — own row only

Backs F195 (`supabase/migrations/20260805110000_create_outreach_preferences.sql`). Same
shape as §3.12: a user's own settings, not ownership/status/role/approval state, so it
is governed by RLS alone — no SECURITY DEFINER RPC, no `audit_log` row
(`docs/audit-log-pattern.md` §1).

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `OUTREACH_PREFERENCES` | own row (`user_id = auth.uid()`) | own row | own row | — (no grant) |

One row per user (`unique (user_id)`), upserted by the settings form's server action.
No DELETE grant to any role: clearing preferences is an UPDATE back to empty arrays,
not a row removal — this keeps "no preferences set" a single always-present state
(empty arrays) instead of a row that may or may not exist, which is one fewer case for
F094 (#93, not yet built) to handle when it reads this table.

No admin read: nothing in #191 needs one, and F187 (admin views a CAM's settings, P3)
can add it with a stated reason when it is actually built — same call already made for
`USER_ONBOARDING_STEPS` (§3.12).

Both policies AND in `app.is_active_user()`. No `app.can_write()` — that helper gates
*client data* and excludes viewers (F258); this table is a user's own settings and is
harmless for any active role to write about themselves.

### 3.14 Suppressions — RPC-only, admin decides

Backs F251 Suppress Charity Record (#82),
`supabase/migrations/20260805120000_create_suppressions.sql`. Resolves open gap #3
(§6) and the ticket's own "Blocked By / Open Questions: who can suppress records",
decided by the Project Leader 5 Aug 2026: **only an admin's decision puts a
suppression into effect.** A CAM may request one; an admin may request one directly,
which self-approves (no admin ever waits on their own request).

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `SUPPRESSIONS` | all active users | — (RPC only) | — (RPC only) | — (no grant) |

No INSERT/UPDATE policy, by the same reasoning as `AUDIT_LOG` (§3.8) and
`set_user_role` (§6): "reason required" plus a role-gated state transition is the RLS
recipe's RPC case (MIGRATIONS.md step 4), not something a policy can express. All
writes go through two `SECURITY DEFINER` RPCs, each self-checking the caller and each
writing an `audit_log` row in the same transaction:

- `request_suppression(organisation_id, reason)` — caller must satisfy
  `app.can_write()` (admin or CAM). `reason` is required and cannot be blank. An
  admin caller's row lands `active` immediately (`suppression_approved` audit
  action); a CAM caller's row lands `pending` (`suppression_requested`). A second
  open (`pending`/`active`) row for the same organisation is rejected — one at a
  time, enforced by a partial unique index on `organisation_id`.
- `decide_suppression_request(suppression_id, approve, note)` — admin only. Moves a
  `pending` row to `active` or `rejected`, records `decided_by`/`decided_at`, and
  writes `suppression_approved` or `suppression_rejected` to `audit_log`. Rejects a
  target that is not currently `pending`.

SELECT is open to every active user (not gated to admin/owner) because the working
list needs to hide a suppressed organisation for everyone, not just the CAM who owns
it — same reasoning as `organisations_select_active`.

**Outreach block (AC8).** `app.can_contact_organisation()` (§3.4,
`create_rls_helpers.sql`) is extended in this migration — via `CREATE OR REPLACE`,
not an edit to the already-applied file — to additionally require
`not app.organisation_is_suppressed(organisation_id)`. This blocks sending to a
suppressed organisation for every role, admin included; the only way back in is F185
lifting the suppression, not bypassing the check.

**Scope note.** This table is not the contact-level `email_hash`/`phone_hash` GDPR
suppression list in `docs/data-lifecycle-policy.md` §7 (open gap for that one
remains — it is Art. 21 objection tracking, a different story). `organisation_id`
here is the same "suppress an organisation" branch that list anticipates, so a future
contact-level story can extend this table rather than starting over. Built ahead of
F248 (#243, "a suppression list exists") with the Project Leader's agreement, since
this table already satisfies that — see the migration header for the full note.

`status` is `pending | active | rejected | lifted`. `lifted` is reserved now, not
used by any RPC in this migration — F251's own AC commits to an admin being able to
remove a suppression, and F185 (#181) is that RPC. Adding an enum value later is a
one-way door in Postgres (`create_organisations.sql` precedent), so it is reserved
up front rather than negotiated later.

---

## 4. Denial behaviour and feedback

Important and frequently got wrong: **a blocked read is not an error.**

| Situation | Postgres behaviour | User-facing feedback |
|---|---|---|
| SELECT blocked by policy | returns **0 rows**, no error, no log | "Not found" / empty state. Do not claim a permission problem — that leaks the row's existence |
| INSERT/UPDATE/DELETE blocked | raises `42501 insufficient_privilege` | Caught at app layer → clear message: what was blocked, and who to ask |
| RPC self-check fails | explicit `raise exception` with a chosen message | The message is shown as-is; write it for a CAM, not a developer |

Only the second and third rows can produce an audit entry, because only they are
observable. Postgres does not log RLS read denials, and instrumenting every read to
find out would mean logging every ordinary query. The testing note "log entry
created" therefore applies to blocked **writes** only.

The app-layer contract: any `42501` from Supabase is caught, written to `AUDIT_LOG`
(actor, table, operation, target id, timestamp), and surfaced as a blocked-action
message.

**Scope boundary.** F224 owns this *contract* — the clean `42501`, the human-readable
RPC messages, the `AUDIT_LOG` table, and this mapping table. It does **not** own the
UI rendering: catching a `PostgrestError` in `src/` and turning it into a toast/banner
belongs to whichever story has the screen. **F012** (Edit User Role) is the first
consumer and owns the reusable `42501 → message` helper; later write-features reuse it.
This keeps F224 a database-layer story and avoids shipping a handler with no calling
surface. (Audit-log *viewing* is F221.)

---

## 5. Test plan (F224 acceptance)

Run as two real JWTs — an admin and a CAM — not as service role. Service role bypasses
RLS, so a suite written against it proves nothing.

| # | Testing note | Test |
|---|---|---|
| 1 | normal action | CAM inserts `NOTES` row on any org → succeeds |
| 2 | normal action | CAM sends outreach to an **unowned** org → succeeds |
| 3 | misuse attempt | CAM inserts `OUTREACH_MESSAGES` for an org owned by another CAM → `42501` |
| 4 | misuse attempt | CAM updates own `USERS.role` to `'admin'` → `42501`, **and** the stored role is unchanged |
| 4a | misuse attempt | `authenticated` holds no `UPDATE` on `USERS.role`; still holds it on `full_name` |
| 4b | coverage gate | `anon` holds no table privilege on any table in `public` (the missing-`REVOKE` check, §2.1) |
| 5 | normal action | CAM claims an **unowned** org (sets `owner_id` to self) → succeeds |
| 5a | misuse attempt | CAM sets an org's `owner_id` to **another** user → `42501` (reassignment is admin-only) |
| 6 | sensitive data check | CAM `select * from raw_source_records` → **0 rows** |
| 7 | sensitive data check | CAM `select * from cam_activity_summary` → only own rows |
| 8 | sensitive data check | CAM `select * from scoring_weights` → 0 rows |
| 9 | permission failure | Deactivated user (`is_active = false`) reads `organisations` → 0 rows |
| 10 | log entry created | Test 3 produces exactly one `AUDIT_LOG` row |
| 11 | bypass attempt | Direct PostgREST call with `anon` key against every table → 0 rows / `42501` |
| 12 | coverage gate | No table in `public` has `rowsecurity = false` or zero policies |
| 13 | concurrency | Two admins race each other — one calls `set_user_role` to demote the other while the second removes them via `set_user_active` or `deactivate_user` — and the platform is left with exactly one active admin, never zero |

Test 11 is the acceptance criterion "even if the application-layer permission check
were bypassed". It must be run against the API, not through the app's own client.

Test 12 is sequence step 15, run in CI on every migration.

Test 13 needs two real, concurrently-open connections to reproduce — a single-session
pgTAP suite cannot serialize against itself. It lives in
[`scripts/verify-last-admin-guard.mts`](../scripts/verify-last-admin-guard.mts), run
as its own CI step alongside `supabase test db` rather than inside the pgTAP file. It
runs the race once per RPC that can remove an admin from the active set; a new one
added without a row there is a gap that reopens silently. Local stacks only — it
writes `auth.users` rows directly and refuses any hosted project.

---

## 6. Open gaps

Raise at the Wednesday call. Each needs a schema change approval record (SOP §7).

1. **`AUDIT_LOG` is not in the Data Model.** Section 3.8 assumes it. The model has
   `ERROR_LOG` (application errors, F226), which is a different thing. PRD §4.2
   requires role changes and deactivations to be audited, and F221 depends on it.
2. **No suggestion table.** §4.3 grants CAMs "suggest organisation field correction"
   and F077 is a P1 story, but no table holds a suggestion. Without one the CAM path
   to changing canonical data does not exist, and 3.2 has no row for it.
3. ~~**No suppression table.**~~ **RESOLVED — F251 (#82)**, 5 Aug 2026. §3.14 has
   the table and RPCs. "Lift suppression: Admin, reason required" is now split into
   *request* (CAM or admin, reason required) and *decide* (admin only) — see §3.14
   for why. Lifting an active suppression is F185 (#181), not built yet.
4. ~~**Viewer role has no story.**~~ **RESOLVED — F258 (#268) owns it**, raised
   24 Jul 2026. The story also closed a live escalation this question had been
   hiding: `organisations_update_owner_or_admin` tested ownership and admin but
   never the role, so an active viewer passed `USING` on any row with
   `owner_id is null` and passed `WITH CHECK` by naming themselves the new owner —
   a read-only account could claim and rewrite any unowned organisation, which is
   every organisation the seed creates. Fixed in
   `20260724100000_viewer_role_write_lockout.sql`; `app.is_viewer()` added
   alongside.

   The viewer's *read* scope was settled separately by the Project Leader on
   24 Jul 2026 — recorded as Q-05 in [`docs/open-questions.md`](open-questions.md).
   A viewer is 180DC branch leadership, internal only; they read the full
   communication timeline (§3.3, §3.4, unchanged); and they **do** read
   `CAM_ACTIVITY_SUMMARY` in full — §3.7 was changed from `viewer: —` to
   `viewer: all` to match. That last one settles a contradiction the matrix had
   carried against PRD §4.3 ("viewer read-only if authorised"), in favour of the
   PRD: branch leadership doing oversight needs per-CAM throughput, and holding
   the role is what "authorised" means.
5. **`SCOUT_PRIORITY_SCORE`** appears on tab 09 without fields and is not in the
   migration sequence. Excluded from this matrix until defined.
6. ~~**`set_user_active` RPC — owned by F011, not built.**~~ **Resolved by F013 (#15),
   29 Jul 2026.** Built as `public.set_user_active(uuid, boolean)`, mirroring
   `set_user_role`: same column-grant lockout, self-checks `app.is_admin()`, refuses a
   self-change, writes an `audit_log` row (`user_suspended` / `user_reactivated`).
   Suspension is `is_active = false` — one flag, not a new state; F014 reuses it rather
   than adding an `account_status` enum.
7. ~~**`set_user_role` can demote the last active admin.**~~ **RESOLVED — F012 (#14),
   `20260804153000_last_admin_guard.sql`, 4 Aug 2026.** `set_user_active` cannot
   suspend its way to zero admins — the self-change refusal means the caller is always
   a surviving active admin. `set_user_role` carried no equivalent guard, so two admins
   acting on each other concurrently (B demotes A while A suspends B) could commit to
   an organisation with no active admin, which nothing in the app could then reverse.

   A guard added to `set_user_role` alone would not have closed this: `set_user_active`
   would still act on state it read before `set_user_role`'s change committed. Every RPC
   that can remove an admin from the active set now calls `app.guard_last_admin(uuid)`,
   which takes a shared `pg_advisory_xact_lock` before counting active admins, so a
   concurrent call to any of them serializes against the others and re-reads the count
   fresh. Proven under real concurrency (not just asserted) by
   [`scripts/verify-last-admin-guard.mts`](../scripts/verify-last-admin-guard.mts),
   which opens genuinely concurrent connections — see §5 row 13.

   **Three RPCs, not two.** `role` and `is_active` are writable only through
   `set_user_role`, `set_user_active` and — since F014 — `deactivate_user`, which sets
   `is_active = false` on its own path. A guard on the first two would have left the
   same race open through the third (B deactivates A while A demotes B), so all three
   take the lock. Any future RPC that writes either column has to call the guard too;
   that is the whole reason the lock lives in one shared function rather than inline.
8. ~~**`revokeUserSessions` cannot work as written — sessions are never actually
   revoked.**~~ **Resolved on the F013 branch, 30 Jul 2026** —
   `20260729232500_revoke_sessions_on_suspend.sql` moved revocation into the database
   (`app.revoke_sessions`), and pgTAP now seeds a session and asserts it is gone after
   a suspension. Recorded here because the reasoning is worth keeping:
   `src/lib/supabase/admin.ts` called `auth.admin.signOut(userId, 'global')`,
   but that method's first parameter is a **JWT**, not a user id: auth-js forwards it as
   the bearer token on `POST /logout`, so GoTrue answers `invalid JWT: ... token
   contains an invalid number of segments` every time. Every suspension therefore took
   the failure branch and showed the admin the "existing sign-in could not be revoked"
   warning, which read as an intermittent Supabase problem rather than a feature that
   had never once run. Observed against a local stack on 30 Jul 2026 while verifying
   F014; GoTrue v2.193.1 exposes no by-user-id logout endpoint at all
   (`/admin/users/{id}/logout` and `/admin/users/{id}/sessions` both 404), so it was
   not a parameter fix.

   It was never an access hole, only a missing layer: a deactivated user holding an
   access token Supabase still accepted (`GET /auth/v1/user` → 200) was already refused
   `/dashboard` and `/admin/users` by `getCurrentActor`, and every RLS policy gates on
   `app.is_active_user()`. What survived was a logged-in-looking shell over no data
   until the token expired.

   **Lesson for the suite, not just the code:** the pgTAP suite passed throughout. It
   asserted that `is_active` flipped and that an audit row was written, and had no way
   to tell revocation from no revocation. An assertion about a side effect nobody seeds
   a fixture for is not an assertion.

---

## 7. Security advisor resolutions

The Supabase security advisor flagged the first RLS-carrying tables (`users`,
`organisations`, F233 #261). AC4 requires each item resolved or explicitly accepted,
and the advisor re-run. Status as of the 23 Jul staging run:

| Advisor | Finding | Resolution |
|---|---|---|
| `rls_policy_always_true` | `organisations` INSERT was `with check (true)` | Tightened to `with check (app.is_admin())` — canonical records are admin-created (§3.2). **Resolved.** |
| `0028` / `0029` (SECURITY DEFINER exposed) | `is_admin`, `is_active_user`, `handle_new_auth_user` were in `public`, callable as REST RPCs by anon/authenticated | Moved to the `app` schema, which PostgREST does not expose. Policies still call them; `authenticated` keeps `EXECUTE` (a plain `REVOKE` would break policy evaluation — verified `42501`). **Resolved.** |
| `0011` (function search_path) | `set_updated_at` had an unpinned `search_path` | Pinned to `''` under F233. **Resolved.** |
| `0029` on `set_user_role` | The F012 role-change RPC is SECURITY DEFINER and callable by `authenticated` via REST | **Accepted, intentional.** It *must* be REST-callable (the admin UI calls `/rest/v1/rpc/set_user_role`) and it self-authorises: the first thing its body does is re-check `app.is_admin()` and raise `42501` otherwise. This is the strong posture — a direct REST call by a non-admin is rejected *by the database*, not by app code. Moving it to `app` or switching to SECURITY INVOKER would defeat its purpose (INVOKER cannot write `users.role`, which is granted to no one). anon has no EXECUTE. |
| `0029` on `reassign_ownership` / `reassign_actions` | The F257 handover RPCs are SECURITY DEFINER and callable by `authenticated` via REST | **Accepted, intentional — same shape as `set_user_role`.** Both must be REST-callable (`/admin/offboard` calls them) and both self-authorise, re-checking `app.is_admin()` and raising `42501` first. SECURITY INVOKER is not an option: `actions.assignee_user_id` is granted to no role, so an invoker-rights function could not write it. anon has no EXECUTE (pgTAP asserts this). |
| `auth_leaked_password_protection` | HaveIBeenPwned check disabled | **Accepted exception — Pro-plan feature.** Attempting to enable it on the free plan returns *"available on Pro Plans and up."* Revisit if the project upgrades (tracked with D-01 / Q-01 in `docs/open-questions.md`, the same plan decision). |

After the fixes, a staging advisor run reports the intentional self-authorising RPCs and
the Pro-only password check, and **nothing else fixable**. All are accepted and
documented above. Re-run the advisor after the migrations apply to each environment (it
reads the live database), and after any plan upgrade.

**Unresolved, and not from these migrations.** The 2 Aug staging run also flagged `0029`
on `public.set_user_active`. That function exists on staging but appears in no migration
file and in no source file — it was created directly against the database, which
MIGRATIONS.md forbids ("never make an untracked manual change to a live database"). Its
body is sound (admin self-check, no self-change, writes `audit_log`), so this is a
process problem rather than a security one: nothing recreates it on `db reset`, and it
cannot reach production through the release process. It needs capturing as a migration
by whoever owns F013/F014. Note also that `users.deactivated_at` is now in the Data
Model but exists in neither the database nor a migration.
