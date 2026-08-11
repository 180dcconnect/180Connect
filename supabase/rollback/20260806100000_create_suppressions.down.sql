-- Rollback: create_suppressions

drop function if exists public.decide_suppression_request(uuid, boolean, text);
drop function if exists public.request_suppression(uuid, text);

-- Restore app.can_contact_organisation to its pre-F251 definition
-- (20260722103200_create_rls_helpers.sql), without the suppression check.
create or replace function app.can_contact_organisation(p_organisation_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.is_admin()
      or (
        app.is_cam()
        and (
          app.owns_organisation(p_organisation_id)
          or app.organisation_is_unowned(p_organisation_id)
        )
      );
$$;

comment on function app.can_contact_organisation(uuid) is
  'PRD 4.3: admin may contact any organisation; a CAM may contact one they own or one '
  'nobody owns; a CAM may never contact another CAM''s organisation. Use as the WITH '
  'CHECK on OUTREACH_MESSAGES INSERT. Claiming an unowned organisation is a separate '
  'atomic RPC (claim_organisation) — do not let a policy imply the claim.';

drop function if exists app.organisation_is_suppressed(uuid);

drop table if exists public.suppressions;

drop type if exists public.suppression_status;
