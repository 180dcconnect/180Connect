-- Schema change approval record (SOP §7):
--   Change        | Grant DELETE on public.org_tags to authenticated.
--   Reason        | F192 (Remove Tag from Client) needs a CAM to be able to
--                 | remove a tag assignment. F191's migration only granted
--                 | SELECT and INSERT on org_tags — no DELETE existed yet.
--   Compatibility | Additive only. Does not touch tags or organisations,
--                 | does not affect other assignments (AC1: removing one
--                 | assignment never touches another client's row for the
--                 | same tag, since each row is scoped by organisation_id).
--   Data migration| None.
--   Security      | Any active CAM or admin (app.can_write()) may remove any
--                 | assignment, not just their own — the ticket does not
--                 | restrict removal to the CAM who added it (unlike notes,
--                 | which are author-scoped). Matches the shared, not
--                 | personal, nature of tags established in F188.
create policy org_tags_delete_can_write on public.org_tags
  for delete to authenticated
  using (app.is_active_user() and app.can_write());

grant delete on public.org_tags to authenticated;
