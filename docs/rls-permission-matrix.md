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
| "Reassign ownership: admin only" | Same column-level problem | Currently the org UPDATE policy allows an admin to set any `owner_id`; a dedicated `assign_organisation_owner` RPC (with audit) is the future form | admin path **shipped**; RPC deferred |
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
`is_active` will need the same treatment (a `set_user_active` RPC, F011) — same
column-grant lockout, not yet built. See §2.1 and §7.

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

The viewer row below departs from that wording deliberately. `CAM_ACTIVITY_SUMMARY` is
per-CAM performance data, closer to staff evaluation than to client data, so viewers are
denied it while keeping team-wide analytics (`PIPELINE_METRICS`, `SECTOR_PERFORMANCE`).
PRD §4.3's "if authorised" is not implemented and is not planned — there is no per-user
analytics authorisation flag. Decision: Project Leader, 24 Jul 2026 (open-questions Q-05).

| Table | SELECT | Write |
|---|---|---|
| `CAM_ACTIVITY_SUMMARY` | admin: all. cam: `user_id = auth.uid()`. viewer: — | service role only |
| `PIPELINE_METRICS` | all roles | service role only |
| `SECTOR_PERFORMANCE` | all roles | service role only |
| `API_HEALTH_LOGS` | admin | service role only |
| `INGESTION_SUMMARY` | admin | service role only |
| `COST_TRACKING` | admin | service role only |
| `ERROR_LOG` | admin | service role only |

`CAM_ACTIVITY_SUMMARY` is the second "sensitive data check": CAM A must not see
CAM B's conversion numbers.

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

Test 11 is the acceptance criterion "even if the application-layer permission check
were bypassed". It must be run against the API, not through the app's own client.

Test 12 is sequence step 15, run in CI on every migration.

---

## 6. Open gaps

Raise at the Wednesday call. Each needs a schema change approval record (SOP §7).

1. **`AUDIT_LOG` is not in the Data Model.** Section 3.8 assumes it. The model has
   `ERROR_LOG` (application errors, F226), which is a different thing. PRD §4.2
   requires role changes and deactivations to be audited, and F221 depends on it.
2. **No suggestion table.** §4.3 grants CAMs "suggest organisation field correction"
   and F077 is a P1 story, but no table holds a suggestion. Without one the CAM path
   to changing canonical data does not exist, and 3.2 has no row for it.
3. **No suppression table.** §4.3 has "Lift suppression: Admin, reason required".
   Nothing in the Data Model records a suppression.
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
   communication timeline (§3.3, §3.4, unchanged); and they do **not** read
   `CAM_ACTIVITY_SUMMARY` (§3.7, unchanged). That last one resolves a real
   contradiction — PRD §4.3 says "viewer read-only if authorised" — in favour of
   this matrix. Both rows shipped correct; they are now decisions rather than
   inherited assumptions.
5. **`SCOUT_PRIORITY_SCORE`** appears on tab 09 without fields and is not in the
   migration sequence. Excluded from this matrix until defined.
6. **`set_user_active` RPC — owned by F011, not built.** `is_active` has the same
   column-grant lockout as `role`, so deactivation needs the same self-authorising,
   audited SECURITY DEFINER RPC as `set_user_role` (F012). Until it exists, no one can
   deactivate a user. Build it in F011 (Deactivate Account), mirroring `set_user_role`.

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
| `auth_leaked_password_protection` | HaveIBeenPwned check disabled | **Accepted exception — Pro-plan feature.** Attempting to enable it on the free plan returns *"available on Pro Plans and up."* Revisit if the project upgrades (tracked with D-01 / Q-01 in `docs/open-questions.md`, the same plan decision). |

After the fixes, a staging advisor run reports two WARN items — the intentional
`set_user_role` RPC and the Pro-only password check — and **nothing else fixable**.
Both are accepted and documented above. Re-run the advisor after the migrations apply
to each environment (it reads the live database), and after any plan upgrade.
