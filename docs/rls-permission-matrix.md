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
| CAM claims an **unowned** organisation | Needs a write to `ORGANISATIONS.owner_id`, otherwise off-limits | `claim_organisation(org_id)`, a `SECURITY DEFINER` RPC (F162, `20260806140000_create_claim_organisation_rpc.sql`) locks the row, sets `owner_id` to the caller and writes an `audit_log` row in the same transaction; raises `55000` rather than overriding if someone else already owns it. The UPDATE policy's `owner_id is null` branch is gone — a CAM's direct UPDATE on an unowned row now matches zero rows, same as any other RLS-blocked write | **shipped**, F162 — see §3.2 |
| "Set pipeline status — CAM (own client) or admin, no reason required" | RLS is row-level; it cannot let a client's owner write one column (`outreach_status`) while a general policy governs the rest of the row, and the write needs an audit row | `set_outreach_status(org_id, status)`, a `SECURITY DEFINER` RPC (F145, `20260807100000_redefine_outreach_status_pipeline.sql`) locks the row, checks the caller owns it or is admin, and writes an `audit_log` row (`status_changed`) in the same transaction. `outreach_status` is off the general `organisations` UPDATE grant entirely — see §3.2 | **shipped**, F145 — see §3.2 |
| "Set pipeline status on several clients at once" (F064) | Nothing in RLS makes a multi-row write atomic *and* audited; the app doing it row by row is N transactions, so it can half-apply | `set_outreach_status_bulk(org_ids[], status)`, a `SECURITY DEFINER` RPC (F064, `20260826000000_create_bulk_outreach_status_rpc.sql`) locks every target row in id order, requires the caller own **all** of them or be admin, writes one `status_changed` audit row per real transition, and caps a batch at 500. Same rule as `set_outreach_status` — bulk is a convenience, never a wider permission | **shipped**, F064 — see §3.2 |
| "Override pipeline stage — **reason required**" | Postgres cannot require a justification string as a condition of an UPDATE | `SECURITY DEFINER` RPC `override_outreach_status(org_id, status, reason)`. `reason` is `not null` and lands in the audit log. Distinct from `set_outreach_status` above — this is the admin escape hatch, not the ordinary path | to build (F224) |
| "Reassign ownership: admin only" | Same column-level problem | `reassign_ownership(org_ids, new_owner_id, reason, from_user_id)` (F257, `20260802100000_create_reassign_ownership_rpc.sql`, unified `20260804170000`) is the only write path — the org UPDATE policy's admin branch could set any `owner_id` directly with no audit row until `20260810110000_close_admin_owner_id_direct_write.sql` revoked `owner_id` from the table's UPDATE grant entirely (same column-level-REVOKE mechanism as `outreach_status`, §3.2). F163's admin assign-owner form (`/clients/[id]`, `assign-owner-form.tsx`) calls it with a single organisation id and no `from_user_id`. The **offboarding** case is also covered: `deactivate_user` (F014) reassigns every organisation the departing user owns, with a required reason and one `ownership_reassigned` audit row per organisation, in the same transaction that closes the account, delegating to `reassign_ownership` so the departing user's **open actions travel with their clients**. See §3.2, §3.11 |
| Audit entries are immutable | RLS controls who writes, not whether a row can later change | `AUDIT_LOG` gets **no** UPDATE or DELETE policy for any role. Append-only by omission | needs the table (§6) |

**Rule that follows:** where a capability needs a *condition*, a *reason string*, a
cross-user write, or (as with the unowned-claim above, since F162) an audit row, prefer
an RPC over widening a policy. An RPC is `SECURITY DEFINER` with `set search_path = ''`
and re-checks the caller's role itself, because `SECURITY DEFINER` bypasses the RLS
that would otherwise protect it. The CAM-owns-a-row-they-already-own path is still
policy, not RPC — editing fields on your own client needs no audit row and no cross-user
write, so widening the policy is enough there. See §3.2.

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

`last_seen_at` — "last active", not last login — is written only by
`public.touch_last_seen()` (20260816230000), a SECURITY DEFINER RPC that updates only
`auth.uid()`'s own row. Granted to no one directly (same column-grant lockout as `role`),
so a client cannot forge or backdate it. `getCurrentActor()` calls it, throttled to once
per 5 minutes per user, on every signed-in page and every admin API request — not just at
login. Not audited: presence isn't an ownership/status/role/approval change.

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

**The sanctioned route around the gap (F077, #79; decided by F078/F079, #80/#81).**
~~Until the gap itself closes (F020's restricted-editing enforcement), a CAM who owns a
row can still write these columns directly through the policy above.~~ **The gap is now
closed — F020 (#23)**: a BEFORE UPDATE column-guard trigger
(`20260822160100_restrict_organisation_sensitive_columns.sql`) refuses any non-admin
write that changes a column listed active in `RESTRICTED_EDIT_FIELDS`
(`20260822160000_create_restricted_edit_fields.sql`), raising 42501 with a pointer to
the suggestion flow. The restricted set is configuration, not code: an admin adds or
retires fields at runtime through `add_restricted_edit_field` /
`deactivate_restricted_edit_field` (both audited, `/admin/restricted-fields`), and both
enforcement points — the trigger and the suggestion RPC — follow the table. What F077
added is the legitimate path for corrections: `suggest_organisation_edit(org_id,
field_name, new_value)` (`20260822140000_create_edit_suggestions.sql`, rewritten by
F020 to validate against the config table) lets an active CAM propose a change, snapshots
the current value server-side into `EDIT_SUGGESTIONS`, and writes nothing to
`organisations`. Submission audits nothing (flagging is not a decision).
`decide_edit_suggestion(suggestion_id, approve, reason)`
(`20260822150500_create_decide_edit_suggestion_rpc.sql`, apply-back rewritten by F020 in
`20260822160200` as guarded dynamic SQL so admin-added fields are applied too) is the
decision half, admin only and audited both ways: approval re-checks that the live value
still matches the submission snapshot (refusing on drift rather than silently
overwriting whatever moved in the meantime) and then applies the proposed value;
rejection touches nothing and records the optional reason for the CAM. At most one
pending suggestion exists per field per client: a CAM re-suggesting supersedes their
own, another CAM's pending proposal blocks the field. SELECT on the suggestions table
follows the same split: admins see everything, any active CAM sees pending rows, authors
see their own history, viewers see nothing. Background jobs (no JWT) bypass the trigger
by design; admins keep the §3.2 write path in full.

**Claiming an unowned client (F162).** Until `20260806140000`, a CAM claimed an unowned
organisation the same way they edit one they own — directly through this UPDATE policy,
its `WITH CHECK` pinning the new `owner_id` to themselves. That path wrote no
`audit_log` row, which F162 AC3 ("taking ownership is recorded with who and when")
cannot tolerate: a caller going straight to PostgREST instead of the UI would claim a
client with no trace. `claim_organisation(org_id)`
(`supabase/migrations/20260806140000_create_claim_organisation_rpc.sql`) replaces that
path — `SECURITY DEFINER`, locks the row, requires the caller be an active CAM or admin,
and inserts one `ownership_reassigned` audit row (`trigger: 'self_claim'`, matching
`reassign_ownership`'s `from`/`to`/`trigger` keys — see §3.11) in the same transaction
as the claim. The policy's `owner_id is null` branch for CAMs is removed to match: a
CAM's direct UPDATE on an unowned row now matches zero rows, same as any other
RLS-blocked write (§5), forcing the claim through the audited RPC. Re-claiming a client
you already own is a no-op, not an error, and is not audited (same convention as
`reassign_ownership`'s already-there skip). Claiming a client someone **else** already
owns raises `55000` rather than silently overriding the existing owner (AC2) — the
caller renders that as a conflict warning (the minimal form of F165, not yet its own
story) instead of a generic failure. Admin's separate ability to set any `owner_id`
directly through this same policy was closed later, by F163 below, not by this
migration.

**Assigning/reassigning a client's owner as an admin (F163).** Until
`20260810110000`, an admin's `owner_id` write went straight through this UPDATE
policy the same way a CAM's own-row edit does — no audit row, and no `is_active`
check on the incoming owner (the gap this section's "known gap" and #298 both
named). `20260810110000_close_admin_owner_id_direct_write.sql` closes it the way
`redefine_outreach_status_pipeline` closed `outreach_status`: a column-level
`REVOKE`/`GRANT` that drops `owner_id` from the table's UPDATE grant entirely
(RLS can't scope a policy to "every column but one" — see §2's rule), rather than
rewriting `organisations_update_owner_or_admin` itself, which still governs every
other column on the row. `owner_id` now has exactly two write paths for every
role — `claim_organisation` (a CAM or admin claiming an unowned client, above) and
`reassign_ownership` (an admin assigning or reassigning any client, §3.11, used by
F163's assign-owner form on `/clients/[id]`) — both `SECURITY DEFINER`, both
audited, both checking the incoming owner is an active CAM or admin.

**Pipeline status (F145).** `outreach_status` is a different kind of gap from the
canonical-field one above: it's not that the wrong role can write it, it's that *any*
write to it — CAM or admin — needs an `audit_log` row, and a plain RLS policy has no way
to make that conditional (§2's general rule: a write that needs an audit row is an RPC,
not a widened policy). `20260807100000_redefine_outreach_status_pipeline.sql` closes it
with `set_outreach_status(org_id, status)` — `SECURITY DEFINER`, requires the caller own
the row or be admin, writes one `status_changed` audit row per real transition (no-ops
are skipped, same convention as `claim_organisation`). Unlike the `owner_id` case this
didn't need a `USING`/`WITH CHECK` rewrite: `outreach_status` is pulled off the general
UPDATE grant entirely via a table-level `REVOKE` + column-list `GRANT` (see that
migration's comment for why a column-level `REVOKE` alone doesn't work in Postgres), so
every other column keeps behaving exactly as this section already describes and only
`outreach_status` is RPC-only. The ten allowed values are F146-F155; a new client
defaults to `not_contacted` (F146) via the column default. `override_outreach_status`
(§2, reason-required admin override) is a separate, not-yet-built RPC for a different
case — this one is the everyday CAM/admin path.

**Bulk pipeline status (F064).** `set_outreach_status_bulk(org_ids[], status)`
(`20260826000000_create_bulk_outreach_status_rpc.sql`) is the same write over many rows
in one transaction, and it grants nothing the single-row RPC does not: owner or admin,
checked across the whole batch. Two properties are the point of it existing rather than
the app looping over `set_outreach_status`. It is **atomic** — one client in the
selection the caller does not own raises `42501` and *no* row moves, rather than the
batch part-applying and leaving a CAM unable to tell which half took. And it is
**bounded** — 500 rows per call, because the risk this feature carries is a mis-clicked
status on a large selection, not a slow query. Audit behaviour is unchanged: one
`status_changed` row per real transition, no-ops skipped, `detail.trigger = 'bulk_update'`
distinguishing them from single edits without inventing a second action token. The list
UI disables the checkbox on rows the actor could not change one at a time, so the
permission exception is a backstop against a crafted request rather than the normal path.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `ORGANISATIONS` | all roles | admin | admin any row; CAM may edit one they own (WITH CHECK pins `owner_id` to self) — claiming an **unowned** row is RPC-only, see below. `outreach_status` is excluded from this grant entirely — RPC-only (`set_outreach_status` for one client, `set_outreach_status_bulk` for many), see above | admin |
| `ORGANISATION_IDENTIFIERS` | all roles | admin | admin | admin |
| `CONTACTS` | all roles | admin, cam | admin, cam | admin |
| `FINANCIAL_PERIODS` | all roles | admin | admin | admin |
| `GRANTS` | all roles | admin | admin | admin |
| `ENRICHMENT_RESULTS` | all roles | — (service role) | — | admin |
| `TAGS` | all roles | admin, cam | admin, own | admin |
| `ORG_TAGS` | all roles | admin, cam | admin, own | admin, own |
| `CLIENT_BOOKLETS` | all roles | admin, cam (`can_contact_organisation`) | admin, cam (`can_contact_organisation`) | admin |

**`CLIENT_BOOKLETS` (F085, #349)** is the one row here whose write predicate isn't
plain `can_write()`: it reuses `app.can_contact_organisation()`, the same
ownership-scoped predicate §3.4's `OUTREACH_MESSAGES` uses, rather than the simple
admin-or-CAM check the rest of this table's writable rows use. That matches the
`/api/clients/[id]/booklet` route's own `client:contact` permission gate — a CAM
saves a booklet only for a client they own or that's unowned, same as they may only
contact one. One row per organisation (`organisation_id unique`); a regenerate
upserts rather than appending, so there is no history to scope reads by author or
time. **Not yet in the Data Model spreadsheet** — flagged in the migration's own
header (`20260827000000_create_client_booklets.sql`) for Bashir to add to tab 04/02.

### 3.3 Notes — shared read, author write

F019 (read-only shared client visibility) requires every CAM to read every note.
§4.3 forbids viewers from creating them.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `NOTES` | all roles | admin, cam (`author_id = auth.uid()`) | admin, own | admin, own |

**F065 (bulk add comment) changes nothing in this row and adds no RPC.** It inserts N
rows in one statement as the signed-in user, so `notes_insert_author` above is what
authorises it — one transaction, and therefore the same all-or-nothing guarantee
F064's `set_outreach_status_bulk` needed a `SECURITY DEFINER` function for. The
contrast is worth stating because the two features look symmetrical and are not:
F064 needed the RPC because direct writes to `organisations.outreach_status` are
revoked (§3.2), so there was no policy to authorise it. Here there is one, and a
definer function would have *bypassed* it to re-implement it. The permission path
is asserted in `supabase/tests/rls_policies.test.sql` — a CAM may note another
CAM's client (`suite_core`), a viewer may not note anything (`suite_viewer`).

### 3.4 Outreach — ownership-scoped

The F018 contact-permission rule lives here. Read is shared (relationship history,
F019); **send** is restricted.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `OUTREACH_MESSAGES` | all roles | admin: any not suppressed. cam: `sent_by_user_id = auth.uid()` **and** org is unowned or owned by self **and** not suppressed | admin, own drafts (`send_status = 'draft'`) | admin, own drafts |
| `AI_GENERATIONS` | all roles | — (service role) | — | admin |
| `SEND_EVENTS` | all roles | — (service role, Gmail webhook) | — | — |
| `REPLY_EVENTS` | all roles | — (service role) | — | — |
| `OUTCOMES` | all roles | admin, cam (`recorded_by_user_id = auth.uid()`) | admin, own | admin |
| `BOOKLET_GENERATIONS` | admin, cam (`app.can_contact_organisation(organisation_id)`); viewer: none | admin, cam (`app.can_contact_organisation(organisation_id)` **and** `generated_by = auth.uid()`); append-only audit of booklet prompt/output (F082 AC5 / F112, `20260822130000`) | — | — |

`BOOKLET_GENERATIONS` lives here rather than in a new section because it is the
booklet-side sibling of `AI_GENERATIONS`: the same "what exactly did the model
produce" audit question. It cannot be a row in that table — `AI_GENERATIONS`
hangs off `outreach_messages`, and a booklet generation has no outreach message.
Read scope follows the booklet feature's own gate (client:contact ≈
`app.can_contact_organisation`), which excludes viewers; the table holds full
prompt/output text, so it is deliberately tighter than shared read. Append-only
by omission of UPDATE/DELETE grants, same mechanism as `AUDIT_LOG`.

The CAM INSERT check on `OUTREACH_MESSAGES` is the database-layer expression of
"Send to an organisation owned by another CAM: Admin yes, CAM no". This is the
policy the acceptance criteria's "misuse attempt" test must target.

Both INSERT policies additionally require `app.can_contact_organisation(organisation_id)`
(F050, #52) — a suppressed org (F251 §3.14) blocks every insert, admin included. Fixed
20260806120000: the admin policy originally omitted this check entirely, so an admin's
own INSERT was never gated by suppression at all — see that migration's header for
the bug.

A sent message is immutable: the UPDATE predicate requires `send_status = 'draft'`.

### 3.5 Raw ingestion and data quality — admin only

§4.3 "View raw source records: Yes/technical admin, CAM no".

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `INGESTION_RUNS` | admin | admin (trigger refresh) | — | — |
| `RAW_SOURCE_RECORDS` | admin | — (service role) | — | admin |
| `DATA_QUALITY_EVENTS` | admin | — (service role) | admin (resolve) | — |
| `ORGANISATION_STATUS_FLAGS` | admin | — (service role, RPC only) | — (RPC only: acknowledge) | — |
| `ENTITY_MATCH_CANDIDATES` | admin | — (service role) | admin (adjudicate) | — |
| `MANUAL_ENTRY_RECORDS` | admin, cam (own) | admin, cam | admin, own | admin |

`RAW_SOURCE_RECORDS` holds unfiltered third-party payloads. It is the
"sensitive data check" in the testing notes: a CAM `select *` must return **zero rows**,
not an error.

F043 exposes provenance without weakening that boundary. Active authenticated users
may execute `get_organisation_sources(organisation_id)`, which returns only the source
name, source-assigned identifier, registry name and first-seen timestamp for linked
records. The `SECURITY DEFINER` function checks `app.is_active_user()` itself and never
returns `raw_payload`; `anon` has no execute privilege.

`ORGANISATION_STATUS_FLAGS` (`20260809100200_create_organisation_status_flags.sql`,
F032/F260 follow-on; generalized to a `source` column covering both weekly
status-recheck jobs by `20260811090000_generalize_organisation_status_flags.sql`,
F049) is the weekly status-recheck jobs' review flag — a tracked organisation's
status drifted away from its source's "alive" value (`company_status` away from
`active` for Companies House, `reg_status` away from `R` for Charity Commission;
`source` distinguishes which). No INSERT/UPDATE policy, same reasoning as
`AUDIT_LOG` (§3.8) and `SUPPRESSIONS` (§3.14): all writes go through two
`SECURITY DEFINER` RPCs, each writing an `audit_log` row in the same transaction —
`record_organisation_status_flag` (`service_role` only, called from either
status-recheck job) and `acknowledge_organisation_status_flag` (admin only).
Neither ever writes to `organisations.outreach_status` — an organisation flagged
here may be mid-outreach, and only a human decides what a status change means for
that pipeline state. `company_number` keeps its name despite now holding either
source's own identifier — MIGRATIONS.md bars a shared-field rename without
Wednesday-call agreement, so the 20260811090000 migration only added `source`
rather than renaming the column.

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
| `AUDIT_LOG` | admin; **plus** any active user, but only `status_changed`/`ownership_reassigned` rows targeting `organisations` (F075, 20260820110000) | — (service role / `SECURITY DEFINER` RPC only) | **none** | **none** |

No UPDATE or DELETE policy is written for any role, including admin. An audit trail
an admin can edit is not an audit trail.

**F075's carve-out** (`audit_log_select_client_timeline`) is additive, not a
replacement for `audit_log_select_admin` above — every other `action` token
(`role_changed`, `user_suspended`, `invite_*`, etc.) stays admin-only. It exists
because the client communication timeline needs a CAM/viewer to read the
handover and status-change entries for a client they can already see everywhere
else on that client's page (`notes`/`outreach_messages`/`reply_events` are
already shared-read, §3.3/§3.4) — and because RLS gates `postgres_changes`
delivery exactly like a SELECT, so without this, F075's realtime subscription
would silently never receive these two event types for a non-admin.

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

A CAM taking ownership of an **unowned** client themselves is a fourth path onto the same
`ownership_reassigned` token, but not through this function — `reassign_ownership` is
admin-only and moves a client *between* two other people, where a self-claim has no
outgoing owner and no admin in the loop. That is `claim_organisation(org_id)` (F162,
§3.2), writing `trigger: 'self_claim'` alongside this table's `'bulk_assign'` and
`'offboarding'` so all four routes read as one timeline.

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

### 3.13 Outreach preferences — own row or admin read

Backs F195 (`supabase/migrations/20260805110000_create_outreach_preferences.sql`) and
F187 (`supabase/migrations/20260819100000_allow_admin_read_outreach_preferences.sql`). Same
shape as §3.12: a user's own settings, not ownership/status/role/approval state, so it
is governed by RLS alone — no SECURITY DEFINER RPC, no `audit_log` row
(`docs/audit-log-pattern.md` §1).

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `OUTREACH_PREFERENCES` | own row (`user_id = auth.uid()`) OR admin (`app.is_admin()`) | own row | own row | — (no grant) |

One row per user (`unique (user_id)`), upserted by the settings form's server action.
No DELETE grant to any role: clearing preferences is an UPDATE back to empty arrays,
not a row removal — this keeps "no preferences set" a single always-present state
(empty arrays) instead of a row that may or may not exist, which is one fewer case for
F094 (#93, not yet built) to handle when it reads this table.

Admin read added for F187 (admin views a CAM's settings, P3) via `outreach_preferences_select_admin`
so an admin can understand how a CAM's queue is configured without notifying or restricting the CAM.

Both policies AND in `app.is_active_user()`. No `app.can_write()` — that helper gates
*client data* and excludes viewers (F258); this table is a user's own settings and is
harmless for any active role to write about themselves.

### 3.14 Suppressions — RPC-only, admin decides

Backs F251 Suppress Charity Record (#82),
`supabase/migrations/20260806100000_create_suppressions.sql`. Resolves open gap #3
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
writes go through three `SECURITY DEFINER` RPCs, each self-checking the caller and each
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
- `lift_suppression(suppression_id, reason)` — admin only (F185, #181). Moves an
  `active` row to `lifted`, records `decided_by`/`decided_at` and `decision_note = reason`
  (mandatory written reason), and writes `suppression_lifted` to `audit_log`. Rejects a
  target that is not currently `active` or a blank reason. Lifting unblocks outreach
  and restores visibility on standard client lists.

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

`status` is `pending | active | rejected | lifted`. `lifted` is implemented by F185
(#181) via `lift_suppression` RPC (`20260818130000_create_lift_suppression_rpc.sql`).

### 3.15 Entity match candidates — service-role write, admin decides

Backs F042 Deduplicate Clients (#42),
`supabase/migrations/20260810120000_create_entity_match_candidates.sql`. Uses the
`ENTITY_MATCH_CANDIDATES` table already reserved in the Data Model (tab 03, added 23
Jul 2026) rather than a new table — an earlier draft of this migration created its own
`POTENTIAL_DUPLICATES` table; corrected in review, 9 Aug 2026. Same shape as §3.14: no
end-user INSERT/UPDATE, all writes gated — but the writer here is the ingestion
pipeline (`service_role`), not a CAM/admin request, since a duplicate flag is
machine-detected, not asked for.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `ENTITY_MATCH_CANDIDATES` | admin only | — (service_role only) | — (RPC only) | — (no grant) |

SELECT is admin-only, not "every active user" like `SUPPRESSIONS` — reviewing a flag
means joining to `raw_source_records.raw_payload`, which §3.5 already restricts to
admin because it is unfiltered third-party data. INSERT has no policy for
`authenticated` at all: only the ingestion pipeline (holding the service key
server-side, `src/lib/standardize/write-organisations.ts`) writes a row, exactly the
same restriction as `raw_source_records` itself.

F042's matcher is a binary check (registration number, or name+postcode), not the
graduated LLM-assisted matcher this table's full column set anticipates — see the
migration header for exactly which columns (`match_score`, `match_method`,
`duplicate_group_id`, `llm_reasoning`, `source_priority`) are placeholders/approximated
rather than computed, and why.

The only end-user write is `decide_duplicate_flag(entity_match_candidate_id, confirmed,
note)` — admin only, `SECURITY DEFINER`, rejects a non-pending target, writes
`audit_log` (`duplicate_confirmed` / `duplicate_dismissed`) in the same transaction.
Dismissing a flag (`confirmed = false`) additionally resets the linked
`raw_source_records` row to `pending` with `matched_organisation_id` cleared, so the
next ingestion run promotes it as a new organisation — see the migration header for
why that doesn't loop back to the same flag.

**Known gap, not closed by this table** — see Open gap 5 below.

### 3.16 Field discrepancies — admin writes both sides, RPC only

Backs F048 Data Discrepancy Detection (#49),
`supabase/migrations/20260815090000_create_field_discrepancies.sql`. New table — unlike
`ENTITY_MATCH_CANDIDATES` (§3.15), `FIELD_DISCREPANCIES` was not previously reserved in
the Data Model; added by this migration (Data Model spreadsheet update still owed
alongside — see the migration header).

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `FIELD_DISCREPANCIES` | admin only | — (RPC only) | — (RPC only) | — (no grant) |

Unlike §3.15, **both** writes here are RPC-only and both are callable by
`authenticated`, not `service_role` — detection is not a machine-scheduled pipeline
step, it's a synchronous follow-up inside the signed-in admin's own
`PATCH /api/admin/duplicates` request (right after `decide_duplicate_flag` confirms a
match), so `record_field_discrepancy` self-checks `app.is_admin()` the same way
`resolve_field_discrepancy` does. SELECT is admin-only for the same reason as §3.15 —
a flagged conflict identifies which third-party source said what, not CAM-visible data.

`record_field_discrepancy(organisation_id, field_name, existing_value, existing_source,
incoming_value, incoming_source, raw_source_record_id, entity_match_candidate_id,
auto_resolved_choice)` — no end-user action, called only by the detection follow-up
above. No-ops if the same `incoming_value` was already resolved for that
organisation+field, so a repeat import doesn't reopen an already-adjudicated conflict.

It has two paths, and only the second is a decision:

- `auto_resolved_choice` **null** — flag only. Writes a `pending` row and **no**
  `audit_log` entry (flagging is not itself a decision).
- `auto_resolved_choice` **set** — source priority settled the conflict (Companies
  House outranks the Charity Commission; see `src/lib/standardize/source-priority.ts`).
  Writes the row already `resolved`, applies the winning value onto `ORGANISATIONS`
  through the same six-field allowlist as below, and writes `audit_log`
  (`field_discrepancy_auto_resolved`) in the same transaction. `resolved_by_user_id` is
  the admin whose duplicate confirmation triggered detection — the table's
  `decision_consistent` constraint requires a real actor, and this runs inside their
  request; "the rules decided, not the person" is carried by the distinct `audit_log`
  action and by `notes`, not by a null actor.

So the review queue (`status = 'pending'`) holds only what the priority rules could
**not** settle: the same source on both sides, an unranked source, or an organisation
whose originating raw record can no longer be identified (`existing_source =
'unknown'`). Note the deliberate asymmetry with `ENTITY_MATCH_CANDIDATES.source_priority`,
which falls back to `99` for an unranked source: a fallback number is safe to *store*,
but is not sufficient grounds to *overwrite* a field, so the resolver declines rather
than defaulting.

`resolve_field_discrepancy(field_discrepancy_id, choice, note)` — the only end-user
write. Admin only, `SECURITY DEFINER`, rejects a missing or already-resolved target,
applies the chosen value back onto `ORGANISATIONS` (six-field allowlist only — see
migration) and writes `audit_log` (`field_discrepancy_resolved`) in the same
transaction.

**Known gap, not closed by this table**: `existing_source` approximates provenance as
the source of the raw record that originally created the organisation, not true
per-field tracking — a later manual edit through the org edit UI is misattributed to
the original import source. Closing that properly is F044 (Field-Level Source
Tracking, #45)'s job, not this table's.

### 3.17 Ownership requests — RPC-only, admin decides, narrow read

Backs #408 Request Client Ownership (admin-approved handover),
`supabase/migrations/20260818120000_create_ownership_requests.sql`. The escalation
half of F165's conflict warning (§3.11's `claim_organisation` 55000): the warning
says a CAM cannot take a client another CAM owns, and this is the only sanctioned
next step. Decided by the Project Leader 18 Aug 2026 (on #406): **a CAM never
overrides another CAM's ownership.** Worst case they ask, and an admin hands it over.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `OWNERSHIP_REQUESTS` | admin, the requester, or the client's current owner | — (RPC only) | — (RPC only) | — (no grant) |

SELECT is deliberately narrower than `SUPPRESSIONS` (§3.14, all active users). A
suppression is a fact about a charity the whole team needs in order to hide it; a
request is a conversation between one CAM, one owner, and the admins. The current
owner is included on purpose — someone asking for their client is something they
should learn when it is asked, not when it moves.

Both writes are `SECURITY DEFINER` RPCs that self-check the caller and write
`audit_log` in the same transaction (docs/audit-log-pattern.md):

- `request_client_ownership(organisation_id, reason)` — CAM only (`app.is_cam()` +
  `app.is_active_user()`; an admin is refused, since they hold `reassign_ownership`
  and would be requesting from themselves). Requires a reason, refuses an unowned
  client ("claim it instead"), a client the caller already owns, and a second pending
  request from the same CAM for the same client. Inserts `pending` and audits
  `ownership_requested`. **It moves no ownership and grants no access** — the
  requester's reach over the client is exactly what it was before they asked.
- `decide_ownership_request(request_id, approve, note)` — admin only. Refuses an
  already-decided request. On approval it delegates the move to `reassign_ownership`
  (§3.11) rather than touching `organisations.owner_id`, so the handover is audited as
  a normal `ownership_assigned` transition and the outgoing owner's open actions travel
  with the client; `owner_id` still has exactly the two write paths §3.2 lists. Audits
  `ownership_request_approved` / `ownership_request_rejected`.

**What this does not do:** nothing here relaxes `claim_organisation` (a CAM claiming an
owned client still raises 55000) or re-opens the direct `owner_id` write closed by
`20260810110000`. A pending request is inert; the admin's decision is the only thing
with an effect.

---

### 3.18 Field sources — service-role write, admin read

Backs F044 Field-Level Source Tracking (#45),
`supabase/migrations/20260820100000_create_field_sources.sql`. New table — like
`FIELD_DISCREPANCIES` (§3.16), not previously reserved in the Data Model. Real
per-field provenance for `ORGANISATIONS`, closing the gap §3.16 and open-gap note
10 both flagged: `FIELD_DISCREPANCIES.existing_source` only ever approximated
which source "owns" a field's current value.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `FIELD_SOURCES` | admin only | — (`service_role` only) | — (`service_role` only, via same RPC) | — (no grant) |

SELECT is admin-only, same reasoning as §3.16 — which source produced a field's
value is not CAM-visible data. There is one write path, `record_field_source`
(`p_organisation_id, p_field_name, p_value, p_source, p_raw_source_record_id`):
flips any existing `is_current = true` row for that `organisation_id +
field_name` to `false`, then inserts the new one as current. Granted to
`service_role` only, not `authenticated` — mirrors `record_client_criteria_outcome`
(§3.5) and `LOGIN_ATTEMPT`'s RPCs (§3.10): every caller either holds the
service-role key server-side (`write-organisations.ts`, the ingestion pipeline) or
is a nested call from inside `record_field_discrepancy` /
`resolve_field_discrepancy` (§3.16), which already self-check `app.is_admin()`
before reaching it.

Only two writers exist as of this migration, both wired in: the ingestion
pipeline on initial import, and F048's two RPCs when a conflict resolution
overwrites a field. No CAM/admin hand-edit path exists yet (checked before
writing this migration — no Server Action, route, or RPC updates `organisations`
outside those two), so there is nothing else to wire up today; a future hand-edit
feature is responsible for calling `record_field_source` itself.

`get_field_sources(organisation_id)` — the read path, `authenticated`, self-checks
`app.is_admin()` and `app.is_active_user()` inside (same shape as
`get_organisation_sources`, §3.2). Returns every row for the organisation, current
and superseded, newest-first per field — satisfies AC1 (current source per field)
and AC2 (conflicting values and their sources both visible) from a single query.

**MVP field scope**: the same six fields as `FIELD_DISCREPANCIES` (`legal_name`,
`website`, `contact_email`, `address_line_1`, `city`, `postcode`) — kept identical
on purpose so a field tracked for conflicts but not for provenance (or the
reverse) can't silently diverge between the two tables. F044's own issue
illustrates AC1 with `"mission" from CharityBase`, but `mission_statement` lives
on `ENRICHMENT_RESULTS` (LLM-derived), not an `ORGANISATIONS` column any source
mapper writes — out of scope here, flagged rather than silently unmet. See the
migration header for the full reasoning.

### 3.19 Notifications — own-row only, RPC-only writes

Backs F173 In-App Notifications (#169),
`supabase/migrations/20260822130000_create_notifications.sql` +
`20260822090100_create_notification_rpcs.sql`. New table — not previously
reserved in the Data Model. General per-user notification feed: any future
producer (replies, reminders, team activity) inserts rows via RPC instead of
gaining table-level INSERT.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `NOTIFICATIONS` | own rows (`recipient_user_id = auth.uid()`) | — (RPC only) | own rows, `read_at` column only (via grant + trigger guard) | — (no grant; cron prune only) |

SELECT is strictly own-row — wrong-recipient prevention is the RLS policy
itself, and a non-recipient's query returns 0 rows (§4), never an error. UPDATE
is doubly constrained: the *grant* covers only the `read_at` column and the
policy only matches own rows, so no client can ever edit title/body/recipient;
a `BEFORE UPDATE` trigger additionally pins every other column and makes the
transition one-way (`null → timestamp`, never back).

There are no direct INSERT/DELETE grants for anyone. All four write paths are
SECURITY DEFINER RPCs that self-check inside their bodies:

- `create_notification(...)` — `authenticated` + `service_role`; caller must be
  an active user (or hold the service-role key server-side). Silently skips
  unknown/deactivated recipients, self-notifications, and sub-minute duplicate
  retries.
- `mark_notification_read(id)` / `mark_all_notifications_read()` —
  `authenticated`, self-check `app.is_active_user()` + own-row scoping inside.
  A non-recipient's call returns `false`/`0`, deliberately indistinguishable
  from "already read" so no existence oracle leaks other users' notification ids.
- `prune_notifications()` — granted to **no** interactive role; runs only as
  its daily pg_cron job (`notifications_prune_daily`, postgres). Retention:
  read > 90 days, unread > 1 year. Safe because the durable record of every
  underlying event stays in AUDIT_LOG forever.

No audit_log entries are written by any of these (§1 of audit-log-pattern:
none change ownership/status/role/approval state of a business entity — same
documented reasoning as `feedback`). The table is in the `supabase_realtime`
publication for live bell-panel delivery; publication membership grants nothing
on its own — delivery is still filtered by the SELECT policy per subscriber
(same mechanism as §3.8 / F075).

---

### 3.20 Saved filter views — own rows only

Backs F066 (`supabase/migrations/20260821090000_create_saved_views.sql`). Same shape as
§3.12 and §3.13: the user's own view state, not ownership/status/role/approval state, so
it is governed by RLS alone — no SECURITY DEFINER RPC, no `audit_log` row
(`docs/audit-log-pattern.md` §1).

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `SAVED_VIEWS` | own rows (`user_id = auth.uid()`) | own rows | own rows | own rows |

A saved view holds no client data: it is a set of `/clients` search params
(`q`, `city`, `country`, `status`, `type`, `owner` — arrays for the multi-selects)
stored as `jsonb` under a name, and selecting
one rebuilds a query string. Nothing in it is readable to anyone but its author, and
nothing in it grants access to a client the author's role does not already allow — the
params are re-applied to a list the RLS on `ORGANISATIONS` (§3.2) has already filtered,
so a stale `owner=<someone>` view shows exactly what that CAM could see by typing the
filter by hand.

DELETE **is** granted here, unlike §3.13. AC3 asks for deletion by name, and this is a
many-row table where "no longer need this one" has no UPDATE-to-empty equivalent. UPDATE
is granted with no F066 write path behind it yet (saving is an INSERT; the AC has no
rename), so a later rename/overwrite story needs no migration; both policies confine the
row to the caller in `using` **and** `with check`, so a row cannot be moved onto another
`user_id`.

No admin read, delete included: nothing in #68 needs one, and an admin who could delete
someone's shortcuts would hold a purely destructive power over another user's workspace
with no story asking for it. F187 (admin views a CAM's settings, P3) can add a read with
a stated reason when it is actually built — same call already made for
`USER_ONBOARDING_STEPS` (§3.12) and `OUTREACH_PREFERENCES` (§3.13).

All four policies AND in `app.is_active_user()`. None uses `app.can_write()` — that
helper gates *client data* and excludes viewers (F258); a bookmark over a list the viewer
can already read is harmless for any active role to keep.

**What RLS does not check here**: the *keys* inside `filters`. Postgres constrains the
column to a JSON object under 4 KB (`saved_views_filters_is_object`) and nothing more.
The key whitelist lives in `src/app/clients/saved-view-filters.ts` and is applied on both
write and read, so an unexpected key is ignored rather than rendered — a row that somehow
carries one produces a view missing that filter, never a filter the CAM cannot see. This
is the §2 pattern ("what RLS cannot do"), not an oversight.

---


### 3.21 Attachments — shared read, RPC-recorded write, private bucket

Backs F080 View Client Attachments (#83) and F081 Upload Client Attachment
(#84), `supabase/migrations/20260823090000_create_attachments.sql` (schema and
read half) plus `20260824000000_add_attachment_upload.sql` (upload half — split
out because the create migration had already run on staging/production by the
time F081 landed, and an applied migration file must never be edited in
place). Also the schema-level resolution of F217/F218, neither of which is
defined anywhere in the PRD's own feature table or this codebase — see the
migration header for the full reasoning, the "storage location" answer
(Supabase Storage, PRD §7's architecture table), and the explicit caveat that
the size/type limits below are a provisional default, not the sign-off PRD
§14 names as still owed.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `ATTACHMENTS` | all active roles | — (RPC only) | — (no grant) | — (no grant) |

SELECT is shared, same shape as `NOTES` (§3.3) — a client's attachment list is
relationship context every active role sees, not something narrowed to an
owner or an admin.

**Upload is two steps, not one RPC call**: a Postgres function cannot receive
a multipart file body. The browser uploads the bytes directly to Storage
(client-side, so the loading state reflects the real transfer rather than a
proxy through this app's server), then `record_attachment(organisation_id,
filename, storage_path, content_type, size_bytes)` writes the metadata row —
`SECURITY DEFINER`, self-checks `app.can_write()`, confirms the organisation
exists, confirms `storage_path` is actually under that organisation's prefix
(so a caller cannot attribute someone else's upload to the wrong client), and
confirms the Storage object exists before recording it. No `audit_log` entry:
attaching a file changes no ownership/status/role/approval state
(`docs/audit-log-pattern.md` §1), same reasoning as `NOTES`.

**Storage**: a private bucket, `client-attachments` (never public — nothing
about a client's files is meant to be reachable by an unauthenticated guess at
a path), with a real, Storage-enforced `file_size_limit` (25 MB) and
`allowed_mime_types` allowlist (office documents + common images) — this is
what actually stops an over-limit or wrong-type upload, not application code.
Two policies on `storage.objects`: SELECT mirrors `attachments_select_active`
(any active user, needed for `createSignedUrl` to succeed on open/download);
INSERT requires `app.can_write()`. No UPDATE/DELETE policy for either —
replacing or removing an uploaded file is out of both tickets' AC and stays
`service_role`-only.

**Known limitation, not a gap**: a failure between the Storage upload
succeeding and `record_attachment` running leaves an orphaned object with no
metadata row — it simply never appears in anyone's list. Neither ticket's AC
asks for a sweep to reclaim it, so none exists.

---|
| `ATTACHMENTS` | all active roles | — (no grant; F081) | — (no grant) | — (no grant) |

SELECT is shared, same shape as `NOTES` (§3.3) and `CLIENT_EDIT_SUGGESTIONS`
(§3.2) — a client's attachment list is relationship context every active role
sees, not something narrowed to an owner or an admin.

**Deliberately no write path.** F080 is a view; F081 (Upload Client Attachment,
P3, not yet built) owns deciding how a row and its bytes get created, including
the size/type/security limits PRD §7.11/§11.3 asks for. Until F081 ships, this
table has no INSERT grant and no RPC that could produce a row, so every client's
attachment list is correctly empty rather than a placeholder.

**Storage**: a private bucket, `client-attachments` (not public — nothing about a
client's files is meant to be reachable by an unauthenticated guess at a path).
`storage.objects` carries one SELECT policy, `bucket_id = 'client-attachments'
and app.is_active_user()`, mirroring `attachments_select_active` — this is what
lets an active user's `createSignedUrl` call succeed (AC2's open/download), since
Storage checks RLS on `storage.objects` the same way a table read does. No
INSERT/UPDATE/DELETE policy there either: object writes stay `service_role`-only
until F081 adds one.
### 3.22 Restricted edit fields — admin-configured enforcement, CAM read

Backs F020 Restricted Editing (#23),
`supabase/migrations/20260822160000_create_restricted_edit_fields.sql`. New
table — not previously reserved in the Data Model. Holds the set of
`ORGANISATIONS` columns a CAM may not write directly; both enforcement points
read it live (the column-guard trigger of §3.2 and
`suggest_organisation_edit`), so a change here re-scopes restricted editing
with no migration and no deploy.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `RESTRICTED_EDIT_FIELDS` | admins: all rows · CAMs: active rows only · viewers: none (§4 zero rows) | — (RPC only) | — (RPC only) | — (never; soft-disable via `active = false`) |

No direct INSERT/UPDATE/DELETE grant to anyone. Both writes are SECURITY
DEFINER RPCs that self-check `app.is_admin()` and audit in-transaction
(`restricted_field_added` / `restricted_field_removed`,
docs/audit-log-pattern.md §1 — changing this table changes who can write
client records, which is approval-state territory):

- `add_restricted_edit_field(field_name, reason)` — validates the column is a
  real `text` column of `organisations` outside the protected system set;
  re-adding a retired row reactivates it instead of duplicating.
- `deactivate_restricted_edit_field(field_name)` — soft-disable only. Rows are
  never deleted: `EDIT_SUGGESTIONS.field_name` is a foreign key to this table,
  and the record of what was restricted when is part of the trail.

The trigger depends on this table's CAM SELECT policy exposing **active**
rows — it reads the config through RLS as the calling user. If that policy
ever narrows below active-rows-for-CAMs, direct-write enforcement silently
weakens to whatever remains visible (pgTAP suite_restricted_editing guards
the current contract).


---

### 3.17 Saved filter views — own rows only

Backs F066 (`supabase/migrations/20260817090000_create_saved_views.sql`). Same shape as
§3.12 and §3.13: the user's own view state, not ownership/status/role/approval state, so
it is governed by RLS alone — no SECURITY DEFINER RPC, no `audit_log` row
(`docs/audit-log-pattern.md` §1).

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `SAVED_VIEWS` | own rows (`user_id = auth.uid()`) | own rows | own rows | own rows |

A saved view holds no client data: it is a set of `/clients` search params
(`q`, `city`, `status`, `source`, `owner`) stored as `jsonb` under a name, and selecting
one rebuilds a query string. Nothing in it is readable to anyone but its author, and
nothing in it grants access to a client the author's role does not already allow — the
params are re-applied to a list the RLS on `ORGANISATIONS` (§3.2) has already filtered,
so a stale `owner=<someone>` view shows exactly what that CAM could see by typing the
filter by hand.

DELETE **is** granted here, unlike §3.13. AC3 asks for deletion by name, and this is a
many-row table where "no longer need this one" has no UPDATE-to-empty equivalent. UPDATE
is granted with no F066 write path behind it yet (saving is an INSERT; the AC has no
rename), so a later rename/overwrite story needs no migration; both policies confine the
row to the caller in `using` **and** `with check`, so a row cannot be moved onto another
`user_id`.

No admin read, delete included: nothing in #68 needs one, and an admin who could delete
someone's shortcuts would hold a purely destructive power over another user's workspace
with no story asking for it. F187 (admin views a CAM's settings, P3) can add a read with
a stated reason when it is actually built — same call already made for
`USER_ONBOARDING_STEPS` (§3.12) and `OUTREACH_PREFERENCES` (§3.13).

All four policies AND in `app.is_active_user()`. None uses `app.can_write()` — that
helper gates *client data* and excludes viewers (F258); a bookmark over a list the viewer
can already read is harmless for any active role to keep.

**What RLS does not check here**: the *keys* inside `filters`. Postgres constrains the
column to a JSON object under 4 KB (`saved_views_filters_is_object`) and nothing more.
The key whitelist lives in `src/app/clients/saved-view-filters.ts` and is applied on both
write and read, so an unexpected key is ignored rather than rendered — a row that somehow
carries one produces a view missing that filter, never a filter the CAM cannot see. This
is the §2 pattern ("what RLS cannot do"), not an oversight.

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
2. ~~**No suggestion table.**~~ **RESOLVED — F077 (#79)**. `EDIT_SUGGESTIONS` and
   `suggest_organisation_edit` (20260822140000) hold the suggestion; §3.2's
   "sanctioned route" paragraph documents the flow. The decide side is F078/F079.
   The remaining piece — blocking the direct owned-row write on restricted fields —
   is done: **RESOLVED — F020 (#23)**, the column-guard trigger of
   20260822160100 plus the configurable `RESTRICTED_EDIT_FIELDS` allowlist.
3. ~~**No suppression table.**~~ **RESOLVED — F251 (#82) & F185 (#181)**. §3.14 has
   the table and RPCs (`request_suppression`, `decide_suppression_request`, `lift_suppression`).
   "Lift suppression: Admin, mandatory reason required" is implemented by F185 (`lift_suppression`).
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
9. **No way to mark an existing `ORGANISATIONS` row inactive/merged.** F042 (§3.15,
   `decide_duplicate_flag`) stops a *new* duplicate row being created and confirmed,
   but its AC3 ("two records that are true duplicates never both remain as separate
   active clients") is not fully closed: if two rows are already separately promoted
   (e.g. one from an API source, one entered manually, before this table existed)
   there is no column or RPC to retire one of them. Needs a schema decision — most
   likely an `is_active`/`merged_into_organisation_id` column on `ORGANISATIONS`,
   following the same RPC-gated pattern as `SUPPRESSIONS` — raised rather than added
   unilaterally, since it changes the core entity every other table hangs off.
10. ~~`FIELD_DISCREPANCIES.existing_source` is import-provenance, not per-field
    tracking.`~~ **Closed by F044 (§3.18, `20260820100000_create_field_sources.sql`).**
    `FIELD_SOURCES` now records the real source behind every write to a tracked
    field, updated whenever `record_field_discrepancy` / `resolve_field_discrepancy`
    (F048) overwrite one. `FIELD_DISCREPANCIES.existing_source` itself is
    unchanged — it still stores its original import-provenance approximation at
    the moment a conflict was flagged — but a client's *current* per-field
    provenance no longer depends on it; `get_field_sources` is the accurate
    source of truth. Residual gap: no CAM/admin hand-edit UI exists yet (F036 or
    similar), so a manual correction still can't be attributed until that
    feature calls `record_field_source` itself.

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
# F036 manual entry access

`MANUAL_ENTRY_RECORDS` is readable by its creating CAM/admin and by admins.
Viewers cannot read it. All writes are RPC-only: active CAMs/admins call
`save_manual_entry` to create or update their own draft and to submit it. Drafts
may be incomplete; submission requires the confirmed standard field set. Only
admins call `approve_manual_entry` or `reject_manual_entry`. An admin submission
may immediately call the same approval RPC without a second admin, while a CAM
submission remains pending. The RPCs self-authorise and write `AUDIT_LOG` in the
same transaction as each draft/status/review change. Approval also re-runs F042's
duplicate rule and requires the human link-existing/create-new decision before
creating an active organisation. Direct INSERT, UPDATE and DELETE privileges are
withheld from authenticated users. `get_organisation_sources_with_actor` exposes
only safe provenance metadata and the creating user's display name to active
users; it does not expose the full draft or pending submission.

# F037 manual URL import access

A URL import writes through `create_url_import_draft`, which active CAMs and admins
may execute and viewers may not. It always writes the caller as the submitter and
always writes a `draft`: there is no parameter that submits, so an import cannot
reach an organisation without the CAM opening the draft and pressing submit through
F036's own path. It refuses to create a row without the URL the values came from,
and audits as `url_import_drafted`.

`set_url_import_provenance` narrows `imported_field_paths` only, and only for the
submitter's own draft — a field can stop being labelled as imported when the CAM
edits it, and can never start. `discard_manual_entry_draft` deletes the submitter's
own `draft` row after writing `manual_entry_draft_discarded` to `AUDIT_LOG`; a
submitted or reviewed entry cannot be discarded, and no DELETE privilege or policy
is granted to authenticated users for the table. `get_organisation_import_origin`
returns the source URL and the imported-field list to any active user, because "where
did this client come from" is a question every CAM viewing a profile needs answered;
it exposes nothing else from the submission.

The fetched page is stored in `RAW_SOURCE_RECORDS` with `record_source = 'website'`,
under the same admin-read, service-role-write rules as every API source.

# F047 data-quality review flags

`DATA_QUALITY_EVENTS` is readable only by active admins and writable only through
the service-role validation worker. `record_client_criteria_outcome` is not
executable by `anon` or `authenticated`; it atomically records the distinct
`needs_review`/`does_not_meet` rule and holds the raw record out of the active
client list.
