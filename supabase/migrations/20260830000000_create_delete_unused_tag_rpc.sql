-- F190 (#186) — Delete Tag: atomic "delete only if unused" RPC.
--
-- WHY AN RPC RATHER THAN COUNT-THEN-DELETE FROM THE APP:
--   org_tags.tag_id references public.tags ON DELETE CASCADE. An app-side
--   check ("count assignments, then delete") spans two database round
--   trips, so a CAM assigning the tag between those calls loses the new
--   assignment silently to the cascade — exactly the accidental deletion
--   AC2 exists to prevent. delete_unused_tag(p_tag_id uuid) does count and
--   delete in ONE transaction, taking an EXCLUSIVE lock on org_tags first:
--   concurrent assignment INSERTs block until the transaction commits, so
--   a tag can never be deleted while an assignment sneaks in.
--
-- DIRECT DELETES STAY IMPOSSIBLE:
--   No DELETE grant or policy on public.tags is added (and none existed
--   before this ticket): PostgREST-level deletes fail on the missing
--   GRANT regardless of role. Deletion happens ONLY through this RPC,
--   whose body re-checks app.is_active_user() and app.is_admin() because
--   SECURITY DEFINER bypasses RLS.
--
-- NO AUDIT ROW:
--   Tags are not ownership, status, role or approval state
--   (docs/audit-log-pattern.md §1), matching the F194 set_tag_colour
--   precedent. The actor is auth.uid(), checked in the body.
--
-- Schema change approval record (SOP §7):
--   Change        | Add delete_unused_tag(uuid) returning jsonb, SECURITY
--                 | DEFINER. No table or column change, no policy change.
--   Reason        | F190 Delete Tag: admin-only delete of an unused tag;
--                 an in-use tag is refused with its assignment count
--                 instead of being silently cascaded.
--   Compatibility | Purely additive; nothing existing changes shape or
--                 permissions.
--   Data migration| None.
--   Security      | EXECUTE revoked from public/anon, granted to
--                 authenticated; body re-checks active user + admin.
--                 EXCLUSIVE lock on org_tags closes the assign-between-
--                 checks race against ON DELETE CASCADE.
--   Documentation | docs/rls-permission-matrix.md note for §tags deletion
--                 path amended in the same PR.
--   Approved by   | Bashir (Project Manager), 24 Aug 2026.
--
-- Reversibility: paired rollback in
--   ../rollback/20260830000000_create_delete_unused_tag_rpc.down.sql

create or replace function public.delete_unused_tag(p_tag_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment_count integer;
begin
  if not app.is_active_user() or not app.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  -- Blocks concurrent INSERT/UPDATE/DELETE on org_tags until this
  -- transaction ends; readers are unaffected. This is what makes the
  -- count-then-decide atomic with respect to new assignments.
  lock table public.org_tags in exclusive mode;

  select count(*) into v_assignment_count
    from public.org_tags where tag_id = p_tag_id;

  if v_assignment_count > 0 then
    return jsonb_build_object(
      'status', 'in_use',
      'assigned_count', v_assignment_count
    );
  end if;

  delete from public.tags where id = p_tag_id;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object('status', 'deleted');
end;
$$;

revoke execute on function public.delete_unused_tag(uuid) from public;
revoke execute on function public.delete_unused_tag(uuid) from anon;
grant execute on function public.delete_unused_tag(uuid) to authenticated;
