-- F194 (#) — Tag Colours.
--
-- Two additive changes to the TAGS table F188 created:
--   1. A CHECK constraint on tags.colour so the column can only ever hold
--      null or a #rrggbb hex string. F188 left colour nullable and unchecked
--      precisely because setting it was this ticket's job; now that it is
--      written by real UI, the DB gets the same backstop as name
--      (tags_name_not_blank). Deliberately a FORMAT check only, not palette
--      membership: the curated palette is a product rule owned by
--      src/lib/tags/tag-colours.ts and may evolve without a migration, while
--      "this column holds hex or nothing" is the invariant worth a constraint.
--   2. set_tag_colour(uuid, text), a SECURITY DEFINER RPC that lets any active
--      CAM or admin change (or clear) a tag's colour.
--
-- WHY AN RPC RATHER THAN LOOSENING THE UPDATE POLICY:
--   Postgres row-level security sees rows, not columns. Widening
--   tags_update_admin_only to app.can_write() so CAMs could recolour would
--   also let a crafted CAM request RENAME tags straight through PostgREST,
--   silently undoing F189's admin-only rename guarantee at the DB layer
--   (docs/rls-permission-matrix.md §3.23). This is the matrix's established
--   pattern for column-scoped writes (§2 item 4, as set_user_role): the
--   policy stays admin-only, and the RPC updates ONLY the colour column in
--   a body that re-checks the wider rule itself.
--
-- NO AUDIT ROW:
--   Tags are not ownership, status, role or approval state
--   (docs/audit-log-pattern.md §1). The write is attributed through
--   auth.uid() being who the RPC checks; colour changes are visible on the
--   tag itself, which is the record users act on.
--
-- Schema change approval record (SOP §7):
--   Change        | Add check constraint tags_colour_hex_format on
--                 | public.tags(colour); add set_tag_colour(uuid, text)
--                 | SECURITY DEFINER RPC. No column added or dropped, no
--                 | policy changed.
--   Reason        | F194 Tag Colours: CAMs pick a tag's colour at creation;
--                 | any CAM or admin can recolour afterwards (AC1/AC3).
--   Compatibility | Purely additive. Existing rows all satisfy the constraint
--                 | (colour has never been written non-null). Renaming keeps
--                 | its admin-only UPDATE policy; create/assign/remove paths
--                 | are untouched.
--   Data migration| None. No backfill — existing tags simply have no colour
--                 | until someone picks one.
--   Security      | Constraint validates existing rows on apply. EXECUTE on
--                 | the RPC revoked from public/anon, granted to
--                 | authenticated; the body re-checks app.is_active_user()
--                 | and app.can_write(), so viewers and deactivated accounts
--                 | are refused even holding a valid token. Direct UPDATE on
--                 | tags stays admin-only (F189 preserved).
--   Documentation | docs/rls-permission-matrix.md §3.23 amended in the same
--                 | PR. No Data Model change: colour already exists in tabs
--                 | 02/04; this adds no table or field.
--   Approved by   | Bashir (Project Leader), 24 Aug 2026.
--
-- Reversibility: paired rollback in
--   ../rollback/20260829000000_tag_colour_check_and_set_colour_rpc.down.sql

alter table public.tags
  add constraint tags_colour_hex_format
  check (colour is null or colour ~* '^#[0-9a-f]{6}$');

create or replace function public.set_tag_colour(
  p_tag_id uuid,
  p_colour text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_colour text;
begin
  -- The permission rule this RPC exists to express: resharing/recolouring the
  -- shared taxonomy is CAM/admin work (app-layer "tags:manage"), viewers are
  -- read-only. Re-checked here because anyone can call a SECURITY DEFINER
  -- function directly through PostgREST.
  if not coalesce(app.is_active_user(), false)
     or not coalesce(app.can_write(), false) then
    raise insufficient_privilege;
  end if;

  -- Format guard mirroring the CHECK constraint, raised as a clean
  -- invalid_parameter_value rather than letting the UPDATE hit 23514 — same
  -- user-facing outcome either way, but the caller can distinguish "bad
  -- input" from "constraint violated".
  if p_colour is not null and p_colour !~* '^#[0-9a-f]{6}$' then
    raise invalid_parameter_value using message = 'colour must be #rrggbb';
  end if;

  v_colour := lower(p_colour);

  update public.tags
     set colour = v_colour
   where id = p_tag_id
   returning name into v_name;

  if v_name is null then
    raise no_data_found using message = 'tag not found';
  end if;

  return jsonb_build_object(
    'id', p_tag_id,
    'name', v_name,
    'colour', v_colour
  );
end;
$$;

revoke all on function public.set_tag_colour(uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_tag_colour(uuid, text) to authenticated;
