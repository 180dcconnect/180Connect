-- F190 follow-up — Allow deleting a tag that is on clients.
--
-- WHY A SECOND RPC RATHER THAN CHANGING delete_unused_tag:
--   delete_unused_tag (20260830000000_create_delete_unused_tag_rpc.sql)
--   keeps its contract — "delete only if unused" — untouched. Existing
--   callers and the pgTAP suite keep passing. The delete-with-assignments
--   path is a new, separate function with an unambiguous name.
--
-- WHY THE DELETE IS SAFE FOR ITS ASSIGNMENTS:
--   org_tags.tag_id references public.tags (id) on delete cascade
--   (20260822130200_create_org_tags_table.sql line 18), so deleting the tag
--   row removes every org_tags row carrying it in the same statement. There
--   is no code path left that reads a detached assignment.
--
-- WHY THE LOCK:
--   Same shape as delete_unused_tag: an EXCLUSIVE lock on org_tags taken
--   before the delete closes the race where a CAM assigns the tag a moment
--   before deletion — a concurrent INSERT blocks until this transaction
--   commits, then finds its tag gone and fails cleanly on the FK, instead
--   of re-attaching a tag that has just been deleted.
--
-- NO AUDIT ROW:
--   Tags are not ownership, status, role or approval state
--   (docs/audit-log-pattern.md §1), matching the set_tag_colour and
--   delete_unused_tag precedents. The actor is auth.uid(), checked in the body.
--
-- Schema change approval record (SOP §7):
--   Change        | Add delete_tag_force(uuid) returning jsonb, SECURITY
--                 | DEFINER. No table or column change, no policy change.
--   Reason        | Admin may delete a tag that is on clients; the cascade
--                 | removes its org_tags rows in the same transaction.
--   Compatibility | Purely additive; delete_unused_tag unchanged.
--   Data migration| None.
--   Security      | EXECUTE revoked from public/anon, granted to
--                 | authenticated; body re-checks active user + admin
--                 | (SECURITY DEFINER bypasses RLS, so it cannot rely on
--                 | policies).
--   Documentation | docs/rls-permission-matrix.md tags section updated in
--                 | the same PR.
--   Approved by   | Bashir (Project Manager), 17 Sep 2026.
--
-- Reversibility: paired rollback in
--   ../rollback/20261017020000_allow_tag_delete_while_in_use.down.sql

create or replace function public.delete_tag_force(p_tag_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removed_count integer := 0;
begin
  if not app.is_active_user() or not app.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  -- See WHY THE LOCK above: an assignment inserted concurrently blocks on
  -- this lock until the delete commits.
  lock table public.org_tags in exclusive mode;

  -- Count what the cascade is about to remove so the outcome can say how
  -- many assignments went with the tag. Cheap: org_tags_tag_id_idx.
  select count(*) into v_removed_count
    from public.org_tags where tag_id = p_tag_id;

  delete from public.tags where id = p_tag_id;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object(
    'status', 'deleted',
    'removed_count', v_removed_count
  );
end;
$$;

revoke execute on function public.delete_tag_force(uuid) from public;
revoke execute on function public.delete_tag_force(uuid) from anon;
grant execute on function public.delete_tag_force(uuid) to authenticated;
