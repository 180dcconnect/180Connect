-- Migration: delete_client_attachment
-- Story: Delete Client Attachment (follow-up to F080 View / F081 Upload).
--
-- WHAT THIS ADDS:
--   delete_attachment — the SECURITY DEFINER RPC that is the only way an
--   ATTACHMENTS metadata row gets removed. Same shape as record_attachment
--   (20260824000000_add_attachment_upload.sql): no direct DELETE grant to
--   authenticated — the pgTAP suite asserts a client-side
--   `delete from public.attachments` stays 42501 — so the function self-checks
--   app.can_write() and verifies the row belongs to the organisation in the
--   URL. A mismatched id pair reports "not found" (P0002), never an existence
--   oracle for another client's files.
--
--   The function deletes the row and returns its storage_path. Link rows in
--   outreach_message_attachments go with it through that table's
--   ON DELETE CASCADE (20260913090000_create_outreach_message_attachments.sql)
--   — detaching first would be a no-op write; a file removed from under an
--   unsent draft simply stops riding along with it, and no sent-history UI
--   reads those links, so nothing already delivered is rewritten.
--
-- WHY THE RPC DOES NOT DELETE THE STORAGE OBJECT ITSELF: Postgres cannot call
--   the Storage API, and deleting the storage.objects row by SQL would drop
--   the metadata while leaving the bytes behind on disk. The caller (the
--   colocated server action) removes the object through the service-role
--   Storage API immediately after the RPC returns the path — the same split
--   the discard-draft orphan sweep already uses (outreach-actions.ts). No
--   UPDATE/DELETE policy is added to storage.objects: object removal stays
--   service_role-only.
--
--   No audit_log entry: deleting a file changes no ownership/status/role/
--   approval state (docs/audit-log-pattern.md §1), same reasoning as
--   record_attachment and NOTES.
--
-- Spec: docs/rls-permission-matrix.md §3.21
--
-- Schema change approval record (SOP §7):
--   Story / PR     | Delete Client Attachment
--   Affected       | ATTACHMENTS (rows only); delete_attachment(uuid,uuid)
--   Migration      | 20261003130300 (after every migration applied to staging)
--   Compatibility  | Additive function only. No table, policy, bucket or query
--                 | changes. Existing readers work.
--   Data migration | None.
--   Security       | No new table grants. Deletion is only through a SECURITY
--                 | DEFINER RPC which checks app.can_write() and the
--                 | attachment/client pairing itself. Direct DELETE stays
--                 | refused for every client role; storage.objects keeps no
--                 | UPDATE/DELETE policy (service_role-only removal).
--   Documentation | RLS matrix §3.21 delete paragraph updated.
--
-- Reversibility: paired rollback in
-- ../rollback/20261003130300_delete_client_attachment.down.sql

create or replace function public.delete_attachment(
  p_attachment_id uuid,
  p_organisation_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_storage_path text;
begin
  if not app.can_write() then
    raise exception 'only a CAM or admin can delete a file' using errcode = '42501';
  end if;

  -- Scoped to both ids, never by attachment id alone, so a caller cannot
  -- remove another client's file by guessing its id. storage_path is
  -- not null, so a null return unambiguously means "no such row".
  delete from public.attachments
   where id = p_attachment_id
     and organisation_id = p_organisation_id
  returning storage_path into v_storage_path;

  if v_storage_path is null then
    raise exception 'that attachment could not be found' using errcode = 'P0002';
  end if;

  return v_storage_path;
end;
$$;

comment on function public.delete_attachment(uuid, uuid) is
  'Deletes one ATTACHMENTS row belonging to the given client and returns its '
  'client-attachments storage_path so the caller can remove the object bytes. '
  'SECURITY DEFINER because ATTACHMENTS grants no DELETE to authenticated; '
  'self-checks app.can_write(). Draft links cascade with the row.';

revoke execute on function public.delete_attachment(uuid, uuid)
  from public, anon;
grant execute on function public.delete_attachment(uuid, uuid)
  to authenticated;
