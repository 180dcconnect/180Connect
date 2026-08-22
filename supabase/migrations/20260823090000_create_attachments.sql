-- Migration: create_attachments
-- Story: F080 View Client Attachments (#83). Also resolves the schema/storage
--   half of F217 (attachment storage) and F218 (attachment metadata) — neither
--   is defined anywhere in the PRD's own feature table (only ever referenced as
--   a dependency of F080/F081/F118) or in this codebase; this migration is the
--   minimal read-side schema those two names would otherwise cover.
-- Spec: docs/rls-permission-matrix.md §3.21
--
-- SCOPE (decided with the Project Lead — ticket's own "Blocked By: storage
--   location"): this migration is read-only. It creates the ATTACHMENTS
--   metadata table, a private Supabase Storage bucket, and RLS/storage
--   policies so a CAM can list and open/download whatever ends up there — but
--   it adds NO way to create a row. Uploading is F081 (Upload Client
--   Attachment, P3, not yet built) and owns its own size/type/security-limit
--   decisions (PRD §7.11/§11.3); inventing those now, with no upload UI to
--   apply them to, would be scope this ticket doesn't own. Until F081 ships,
--   every client's attachment list is empty — correctly, not as a placeholder.
--
-- STORAGE LOCATION: Supabase Storage, per the architecture table already in
--   180_Connect_Complete_PRD.md §7 ("Supabase Storage | Attachments and future
--   model artifacts") — the PRD had already answered this; the ticket's own
--   "Blocked By" just hadn't been checked against it yet.
--
-- BUCKET: `client-attachments`, private (not public). A signed URL, generated
--   server-side per request and short-lived, is what AC2's "open or download"
--   uses — never a public bucket URL, since nothing about client data is
--   meant to be reachable by an unauthenticated guess at a path.
--
-- PATH SCHEME: `<organisation_id>/<attachment_id>-<filename>` — organisation_id
--   leads so a future per-organisation storage policy (e.g. ownership-scoped
--   access, if F081 ever narrows read access) can match on the path prefix
--   without a table lookup; attachment_id before the filename keeps two
--   uploads of "invoice.pdf" to the same client from colliding.
--
-- WHY SHARED READ, NOT OWNER/ADMIN-SCOPED: same reasoning as NOTES (§3.3) and
--   CLIENT_EDIT_SUGGESTIONS (§3.2) — F019 read-only shared client visibility
--   and this ticket's own "timeline/context visibility" testing note both
--   point at every active role seeing the same attachment list any CAM would.
--
-- Schema change approval record (SOP §7):
--   Change        | New table ATTACHMENTS (not previously reserved in the
--                 | Data Model). New private Storage bucket
--                 | `client-attachments` + one SELECT policy on
--                 | storage.objects.
--   Reason        | F080 — closes the "no table, no storage location" gap
--                 | blocking the view.
--   Compatibility | Additive only. No existing table, policy, bucket or query
--                 | changes.
--   Data migration| None.
--   Security      | RLS on ATTACHMENTS: shared SELECT, no INSERT/UPDATE/DELETE
--                 | grant to authenticated (nothing can create a row yet).
--                 | Storage bucket is private; storage.objects SELECT policy
--                 | mirrors the table's (any active user), no INSERT/UPDATE/
--                 | DELETE policy there either — object PUTs stay service-role
--                 | or a future F081 RPC only.
--   Documentation | Data Model tab 04 (ATTACHMENTS) + tab 02 Data Dictionary +
--                 | tab 11 sequence — still owed against the spreadsheet, same
--                 | as every table added directly by a migration ahead of it.
--
-- Reversibility: paired rollback in
-- ../rollback/20260823090000_create_attachments.down.sql

create table public.attachments (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  filename          text not null,
  -- Bucket-relative path (see migration header's path scheme), not a URL — a
  -- URL for a private object is meaningless without a signed token anyway, and
  -- storing the path keeps the signing decision (expiry, who may ask for one)
  -- at request time, in application code, not baked into a stored string.
  storage_path      text not null unique,
  content_type      text,
  size_bytes        bigint,
  uploaded_by       uuid references public.users (id),
  created_at        timestamptz not null default now(),

  constraint attachments_filename_not_blank check (btrim(filename) <> ''),
  constraint attachments_size_non_negative check (size_bytes is null or size_bytes >= 0)
);

comment on table public.attachments is
  'F080: metadata for a file attached to a client. Read-only from the '
  'application today — see migration header. The actual bytes live in the '
  'client-attachments Storage bucket at storage_path.';
comment on column public.attachments.storage_path is
  'Path within the client-attachments bucket, not a URL. AC2''s open/download '
  'link is a short-lived signed URL generated per request, never a stored one.';
comment on column public.attachments.uploaded_by is
  'Nullable: a future non-CAM creation path (e.g. an automated import) may '
  'have no human uploader. F081 decides how this gets populated.';

create index attachments_organisation_id_idx
  on public.attachments (organisation_id, created_at desc);

-- Revoke before grant (MIGRATIONS.md RLS recipe step 1). No INSERT/UPDATE/
-- DELETE grant at all — see migration header; F081 adds a write path later.
revoke all on public.attachments from anon, authenticated;
grant select on public.attachments to authenticated;

alter table public.attachments enable row level security;

-- Shared read, same shape as NOTES (§3.3) and CLIENT_EDIT_SUGGESTIONS (§3.2).
create policy attachments_select_active on public.attachments
  for select to authenticated
  using (app.is_active_user());

-- ---------------------------------------------------------------------------
-- Storage: a private bucket, and the one policy that lets AC2's signed-URL
-- request succeed for an active user.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('client-attachments', 'client-attachments', false)
on conflict (id) do nothing;

-- createSignedUrl checks RLS on storage.objects the same way a table SELECT
-- does; without this policy every signed-URL request 403s regardless of the
-- ATTACHMENTS row being readable. Mirrors attachments_select_active exactly —
-- one door, not two independently-maintained ones. storage.objects already
-- ships with RLS enabled by the Storage extension itself, so this migration
-- only adds the policy, not `enable row level security`.
create policy attachments_bucket_select_active on storage.objects
  for select to authenticated
  using (
    bucket_id = 'client-attachments'
    and app.is_active_user()
  );

-- No INSERT/UPDATE/DELETE policy on storage.objects: object writes are
-- service-role only until F081 adds a signed-upload or RPC-mediated path.
