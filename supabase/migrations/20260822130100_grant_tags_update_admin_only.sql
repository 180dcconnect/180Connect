-- Schema change approval record (SOP §7):
--   Change        | Grant UPDATE on public.tags to authenticated, restricted
--                 | to admins only via RLS.
--   Reason        | F189 (Edit Tag). The ticket's own "Blocked By" note
--                 | flags "Who can edit shared tags" as an open question,
--                 | and its Additional Context says "Could be admin-only."
--                 | Editing a SHARED tag's name affects every client it's
--                 | assigned to across the whole team, unlike creating or
--                 | assigning a tag (more additive, lower-impact actions).
--                 | Defaulting to admin-only here as the more cautious
--                 | choice pending a real team decision — flagged clearly,
--                 | not silently assumed. If the team decides any CAM
--                 | should be able to edit tags, this migration's policy
--                 | is the one line to change.
--   Compatibility | Additive only. Does not affect SELECT/INSERT, which
--                 | stay exactly as F188 defined them.
--   Data migration| None.
--   Security      | Admin-only via app.is_admin(), matching the same
--                 | pattern used for admin-write tables elsewhere in this
--                 | codebase (e.g. organisation_identifiers, financial_periods).
create policy tags_update_admin_only on public.tags
  for update to authenticated
  using (app.is_active_user() and app.is_admin())
  with check (app.is_active_user() and app.is_admin());

grant update on public.tags to authenticated;
