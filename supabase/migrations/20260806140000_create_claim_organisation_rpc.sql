-- Migration: create_claim_organisation_rpc
-- Sequence: addition (after create_reassign_ownership_rpc; needs public.organisations,
--   public.audit_log, app.is_cam, app.is_admin, app.is_active_user). Not a numbered step —
--   RPC-only migrations are not rows in Data Model tab 11, following
--   create_reassign_ownership_rpc.
-- Story: F162 (#157) Take Ownership of Client.
-- Spec: docs/rls-permission-matrix.md §3.2, §3.11
--
-- WHAT THIS CLOSES:
--   create_organisations (F233) let a CAM claim an unowned organisation directly
--   through the UPDATE policy's WITH CHECK — no RPC, no audit row. The matrix flagged
--   this at the time as "policy shipped; claim_organisation() RPC deferred to F162 for
--   atomic race-safety + an audit row" (matrix §3.2). F162's AC3 ("taking ownership is
--   recorded with who and when, consistent with the audit requirement") cannot hold
--   while a second, unaudited write path to the same column stays open — a caller
--   going straight to PostgREST instead of the RPC would claim a client with no trace.
--   So this migration does two things together: adds the RPC, and closes the policy
--   path that would otherwise let a CAM route around it.
--
-- WHY THE POLICY CLOSES RATHER THAN COEXISTS:
--   A table can't have two write paths where one is audited and the other isn't and
--   call the column "audited" — whichever path is easier is the one that gets used,
--   accidentally or otherwise. Removing the `owner_id is null` branch from the CAM's
--   USING clause means a CAM's direct UPDATE on an unowned row now matches zero rows
--   (same as any other RLS-blocked write: silently zero rows, no error — see matrix
--   §5, "SELECT blocked by policy"). The admin branch is untouched; admin's arbitrary
--   owner_id write is a separate, already-documented gap (matrix §3.2 note on F164)
--   this migration does not touch.
--
-- WHY A CONFLICT ERROR RATHER THAN A SILENT SKIP:
--   AC2 requires that a CAM cannot take ownership of a client someone else already
--   owns "without going through the conflict-warning flow (F165) — self-assignment
--   doesn't silently override an existing owner." F165 itself (the dedicated
--   conflict-resolution UI) is not a listed dependency of this issue and is not yet
--   built, so the RPC's job is to make silent override impossible: it raises a
--   distinct, catchable error (55000, distinguishable from 42501/P0002/22023 already
--   in use elsewhere) rather than either overwriting the owner or quietly no-opping.
--   The caller (src/app/api/clients/[id]/claim) maps that to 409 and the UI renders
--   an explicit conflict message instead of treating it as a generic failure — the
--   minimum F162 needs to keep AC2 true, leaving F165's fuller UX for its own story.
--
-- Schema change approval record (SOP §7):
--   Change        | Add claim_organisation() SECURITY DEFINER RPC; alter
--               | organisations_update_owner_or_admin to remove the CAM direct-claim
--               | branch from USING.
--   Reason        | F162 AC1 (claim from profile or list), AC2 (no silent override),
--               | AC3 (audited claim).
--   Compatibility | No table or column changes. A CAM's direct UPDATE on an unowned
--               | organisation, previously accepted, now matches zero rows —
--               | existing callers must move to the RPC. No other policy branch
--               | changes.
--   Security      | SECURITY DEFINER, search_path pinned, self-checks caller is an
--               | active CAM or admin. EXECUTE revoked from public/anon, granted to
--               | authenticated.
--   Documentation | Matrix §3.2 and §3.11 updated. No Data Model tab change — no
--               | schema object added.
--               | Approved by Bashir (Project Leader), 6 Aug 2026.
--
-- Reversibility: paired rollback in
--   ../rollback/20260806140000_create_claim_organisation_rpc.down.sql

-- ---------------------------------------------------------------------------
-- Close the direct-claim policy path
-- ---------------------------------------------------------------------------
-- ALTER rather than DROP + CREATE, same reasoning as 20260724100000: the policy keeps
-- its name and identity, and there is no instant where the table has RLS on and no
-- UPDATE policy. Only the CAM branch's USING changes — WITH CHECK is untouched, since
-- it already required `owner_id = auth.uid()` and never admitted a null.
alter policy organisations_update_owner_or_admin on public.organisations
  using (
    app.is_admin()
    or (app.is_cam() and owner_id = (select auth.uid()))
  )
  with check (
    app.is_admin()
    or (app.is_cam() and coalesce(owner_id = (select auth.uid()), false))
  );

-- ---------------------------------------------------------------------------
-- claim_organisation — atomic self-claim of an unowned client, with an audit row
-- ---------------------------------------------------------------------------
create or replace function public.claim_organisation(
  p_organisation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  v_role   text;
  v_org    record;
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  select role into v_role from public.users where id = v_actor;

  -- Clients can only be owned by a CAM or an admin (same rule reassign_ownership
  -- enforces on the incoming owner) — a viewer taking ownership would be the same
  -- escalation F258 already closed for the direct-write path.
  if v_role not in ('cam', 'admin') then
    raise exception 'only a CAM or admin may take ownership of a client'
      using errcode = '42501';
  end if;

  select o.id, o.owner_id into v_org
    from public.organisations o
   where o.id = p_organisation_id
     for update;

  if v_org.id is null then
    raise exception 'that client could not be found'
      using errcode = 'P0002';
  end if;

  -- Idempotent: pressing "claim" again on a client you already own is not an error
  -- and not audited, same convention as reassign_ownership's already-there skip.
  if v_org.owner_id is not distinct from v_actor then
    return v_org.id;
  end if;

  -- AC2: never silently override. A distinct errcode (not 42501/P0002/22023, all
  -- already meaningful elsewhere) lets the caller show a conflict warning instead of
  -- a generic failure, rather than either overwriting the existing owner or quietly
  -- doing nothing.
  if v_org.owner_id is not null then
    raise exception 'this client is already owned by another CAM'
      using errcode = '55000';
  end if;

  update public.organisations
     set owner_id = v_actor
   where id = v_org.id;

  -- Same action token and `from`/`to`/`trigger` keys as reassign_ownership's audit row
  -- (20260804170000, matrix §3.11), so F186's change history and the client timeline
  -- render a self-claim exactly like any other ownership move — `trigger: self_claim`
  -- is a third value alongside its existing 'bulk_assign' and 'offboarding'.
  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor, 'ownership_reassigned', 'organisations', v_org.id,
    jsonb_build_object(
      'from',    null,
      'to',      v_actor,
      'trigger', 'self_claim'
    )
  );

  return v_org.id;
end;
$$;

comment on function public.claim_organisation(uuid) is
  'F162: a CAM or admin claims an unowned client for themselves. SECURITY DEFINER so '
  'the claim and its audit_log row commit in one transaction. Idempotent on a repeat '
  'claim by the current owner; raises 55000 (not silently) if another user already '
  'owns the client, so the caller can show a conflict warning rather than override.';

-- EXECUTE defaults to public on create, and Supabase also default-grants it to anon;
-- a revoke from public alone does not remove the anon grant (matrix §7).
revoke execute on function public.claim_organisation(uuid) from public;
revoke execute on function public.claim_organisation(uuid) from anon;
grant  execute on function public.claim_organisation(uuid) to authenticated;
