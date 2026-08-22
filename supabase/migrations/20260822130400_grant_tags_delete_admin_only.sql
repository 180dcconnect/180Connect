-- Schema change approval record (SOP §7):
--   Change        | Grant DELETE on public.tags to authenticated,
--                 | restricted to admins only via RLS.
--   Reason        | F190 (Delete Tag). The User Story is explicitly "As an
--                 | admin", unlike F189's genuinely open permission
--                 | question — so this one is a clean, confirmed admin-only
--                 | restriction, not an assumption pending a decision.
--   Compatibility | Additive only. Does not affect SELECT/INSERT/UPDATE,
--                 | which stay exactly as F188/F189 defined them.
--   Data migration| None.
--   Security      | Admin-only via app.is_admin(), same pattern as F189's
--                 | UPDATE grant.
create policy tags_delete_admin_only on public.tags
  for delete to authenticated
  using (app.is_active_user() and app.is_admin());

grant delete on public.tags to authenticated;
