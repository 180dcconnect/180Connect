# RLS Permission Matrix

**Story:** F224 — Row-Level Security. **Owner:** Bashir. **Reviewer:** Ben.
**Status:** draft for review. **Last updated:** 21 July 2026.

This document is the **Security Controls Register** referenced by step 15 of the
Supabase migration sequence (Data Model tab 11). Tab 12 was never created; this file
replaces it and is the authoritative source.

It translates the PRD's capability matrix (§4.3) into what Postgres can actually
enforce: **table × operation × role × predicate**. Every table migration must
implement its row of this document in the same migration that creates the table
(SOP §7).

---

## 1. Roles

| Role | Postgres identity | Notes |
|---|---|---|
| `admin` | `authenticated` + `USERS.role = 'admin'` | Full authorised management access |
| `cam` | `authenticated` + `USERS.role = 'cam'` | Shared read, ownership-scoped write |
| `viewer` | `authenticated` + `USERS.role = 'viewer'` | Read-only |
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

| §4.3 capability | Why RLS alone fails | Mechanism |
|---|---|---|
| CAM may edit own profile but **not** their own `role` | RLS is row-level; it cannot allow a row UPDATE while forbidding one column | `REVOKE` (see §2.1) then column `GRANT` — `grant update (full_name) on "USERS" to authenticated` — plus a trigger guard. Role is never granted to `authenticated`; only an admin RPC writes it |
| "Send to an unowned organisation → **becomes owner**" | Requires a conditional write to `ORGANISATIONS.owner_id`, which CAMs otherwise cannot touch | `SECURITY DEFINER` RPC `claim_organisation(org_id)`. Asserts `owner_id is null`, sets it to `auth.uid()`, writes audit row. Atomic — closes the two-CAM race |
| "Override pipeline stage — **reason required**" | Postgres cannot require a justification string as a condition of an UPDATE | `SECURITY DEFINER` RPC `override_outreach_status(org_id, status, reason)`. `reason` is `not null` and lands in the audit log |
| "Reassign ownership: admin only" | Same column-level problem as above | Admin-only RPC `assign_organisation_owner(org_id, user_id)` |
| Audit entries are immutable | RLS controls who writes, not whether a row can later change | `AUDIT_LOG` gets **no** UPDATE or DELETE policy for any role. Append-only by omission |

**Rule that follows:** where a capability needs a condition, a reason, or a
single-column write, it is an RPC, not a policy. The RPC is `SECURITY DEFINER`
with `set search_path = ''`, and it re-checks the caller's role itself, because
`SECURITY DEFINER` bypasses the RLS that would otherwise protect it.

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
specified in §3.1, a CAM ran `update "USERS" set role = 'admin' where id = <self>` and
**succeeded**. The row policy allowed it (it is the CAM's own row) and nothing else
stood in the way. Every subsequent check in that test session then passed for the wrong
reason, because the attacker was an admin by then.

The required opening of every table's security block:

```sql
revoke all on public."TABLE_NAME" from anon, authenticated;
alter table public."TABLE_NAME" enable row level security;
-- then grant back only what the matrix allows, and only then write policies
grant select on public."TABLE_NAME" to authenticated;
```

RLS filters **rows**. Table and column privileges decide whether the statement is
allowed to run at all. Both are needed: a policy without a revoke leaves columns
exposed, and a grant without a policy exposes every row.

**Corollary for `USERS.role` and `USERS.is_active`:** these are granted to nobody,
including admins — Postgres column privileges attach to the Postgres role
(`authenticated`), which every signed-in user shares, so there is no way to grant the
column to admins alone. An admin changing a role therefore goes through the
`SECURITY DEFINER` RPC (F012), which re-checks `app.is_admin()` itself. A direct
`UPDATE ... set role` returns `42501` for every caller. That is the intended result,
not a bug to route around.

A trigger backs this up (`app.guard_privileged_user_columns`). Belt and braces: a
future migration that re-grants a column by accident still fails closed, and the
failure names the column.

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

`role` and `is_active` are writable only through the admin RPC (F012) — by nobody
directly, admins included. See §2.1.

### 3.2 Canonical organisation data — shared read, admin write

Everyone authorised reads canonical data (§4.3 "View canonical organisations": all
three roles yes). Writes to canonical records are admin-only; CAMs go through the
suggestion flow (F077).

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `ORGANISATIONS` | all roles | admin | admin (+ CAM via RPC for ownership/stage) | admin |
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
message. That handler is F221's dependency on this story.

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
| 5 | misuse attempt | CAM updates `ORGANISATIONS.owner_id` directly → `42501` |
| 6 | sensitive data check | CAM `select * from "RAW_SOURCE_RECORDS"` → **0 rows** |
| 7 | sensitive data check | CAM `select * from "CAM_ACTIVITY_SUMMARY"` → only own rows |
| 8 | sensitive data check | CAM `select * from "SCORING_WEIGHTS"` → 0 rows |
| 9 | permission failure | Deactivated user (`is_active = false`) reads `ORGANISATIONS` → 0 rows |
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
4. **Viewer role has no story.** F016 covers admin, F017 covers CAM. `viewer` exists
   in the `USERS.role` enum and throughout §4.3, but no story implements it. The
   matrix specifies it; someone must own it.
5. **`SCOUT_PRIORITY_SCORE`** appears on tab 09 without fields and is not in the
   migration sequence. Excluded from this matrix until defined.
