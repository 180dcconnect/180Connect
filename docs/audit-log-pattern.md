# Audit Log Pattern

**Story:** F221 — Audit Logs. **Owner:** Ben. **Reviewer:** Mohammed.
**Status:** draft, pending review. **Last updated:** 26 July 2026.

This document is the contract every future feature must follow to satisfy F221's
acceptance criterion *"every significant data-changing action is recorded in an
audit log with who did it, what changed, and when."* F221 itself only builds the
`audit_log` table, its read-only admin page, and this pattern — it does not (and
cannot) retroactively wire up features that don't exist yet, such as ownership
assignment or pipeline stage overrides. Each of those features is responsible for
following this pattern when it is built, as part of its own Definition of Done
line "all database writes follow the approved schema."

---

## 1. The rule

**Any database write that changes ownership, status, role, approval state, or
similar must insert a row into `public.audit_log` in the same transaction as the
change.** Not a separate step called afterwards from application code — the same
Postgres transaction, so the two cannot diverge (a crash between them would leave
a change with no record it happened, which defeats the point of an audit trail).

## 2. Why this has to be a `SECURITY DEFINER` RPC, not a Server Action

`public.audit_log` grants no `INSERT` to `authenticated` at all (see
`supabase/migrations/20260723100000_create_audit_log.sql`) — there is deliberately
no door for a client to write through directly. The only way in is a Postgres
function that runs as the table owner (`SECURITY DEFINER`), bypassing that gap
on purpose. This mirrors the reason sensitive columns like `users.role` are
handled the same way: see `docs/rls-permission-matrix.md` §2.

A plain Server Action calling `supabase.from(...).update(...)` runs as the
signed-in user's own Postgres role (`authenticated`) and would simply be refused
— either by a missing column grant or, same effect, by RLS. This is intentional:
it forces every state-changing write through code that can be reviewed for
correctness in one place, rather than trusting every call site in the app.

## 3. The reference implementation

`supabase/migrations/20260723100100_create_user_role_rpc.sql` — `set_user_role` —
is the worked example. Copy its shape:

1. `security definer`, `set search_path = ''`, in the `public` schema (so it's
   reachable as a PostgREST RPC — see that migration's comment for why `app`
   schema functions are *not* reachable this way).
2. Re-check the relevant permission **inside** the function body — e.g.
   `app.is_admin()` — because `SECURITY DEFINER` bypasses RLS, so the function
   must enforce its own authorisation rather than relying on the caller having
   already been checked.
3. Do the actual write (the `update`/`insert`/whatever the feature needs).
4. In the **same function**, `insert into public.audit_log (actor_user_id,
   action, target_table, target_id, detail) values (...)`:
   - `actor_user_id` — `(select auth.uid())`, captured once at the top of the
     function.
   - `action` — a stable machine token, e.g. `'ownership_assigned'`,
     `'status_overridden'`. Follow the existing convention (`role_changed`) —
     past tense, snake_case.
   - `target_table` / `target_id` — what the change was about.
   - `detail` — a JSON object with before/after values or whatever context a
     reader would need, e.g. `jsonb_build_object('from', old_value, 'to',
     new_value)`.
5. Skip the audit insert for genuine no-ops (see `set_user_role`'s "same role"
   early return) — the trail should record real transitions, not noise.
6. `revoke execute ... from public, anon; grant execute ... to authenticated;`
   so the function is callable by signed-in users but the body's own check
   decides who actually succeeds.

## 4. What you get for free

Nothing on `src/app/admin/audit-log/page.tsx` needs to change. That page reads
`audit_log` generically — it has no per-action-type logic — so any row your new
RPC inserts shows up there automatically, filterable by actor and by target,
with no further work.

## 5. Checklist for a new write-path

- [ ] Write goes through a `SECURITY DEFINER` RPC, not a direct client update.
- [ ] The RPC re-checks authorisation itself.
- [ ] The RPC inserts into `audit_log` in the same transaction as the write.
- [ ] No-op changes are not audited.
- [ ] `EXECUTE` is revoked from `public`/`anon` and granted only to the roles
      that should be able to call it.
- [ ] The migration includes a schema-change approval record (SOP §7), same as
      `create_audit_log` and `create_user_role_rpc`.
