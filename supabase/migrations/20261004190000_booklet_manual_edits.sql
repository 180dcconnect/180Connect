-- Migration: booklet_manual_edits
-- Story: Manual booklet editing — a CAM corrects a generated booklet by hand.
--
-- WHY COLUMNS, NOT A NEW TABLE OR AN UPDATE:
--   F086 made CLIENT_BOOKLETS append-only (UPDATE revoked): a regeneration is a
--   new row, never an overwrite, so a bad regeneration is recoverable. A manual
--   edit follows the same shape — a new row carrying the corrected text — which
--   keeps one rule for every version ("rows are immutable, latest wins") and
--   makes an edit undoable from the History list for free. booklet_generations
--   (the F112 audit log of what Gemini produced) is untouched by design: an
--   edit changes what is displayed, never what was generated — the same split
--   the admin-only delete path already draws.
--
-- NULLS READ AS GENERATED: edited_by_user_id null means this version came from
--   Gemini, not from a person. No backfill — every existing row is generated.
--
-- SCHEMA CHANGE APPROVAL RECORD — DEVIATION, NOT YET MIRRORED (SOP §7):
--   CLIENT_BOOKLETS itself is still not in the Data Model spreadsheet (flagged
--   in 20260827000001 and 20260828000000); these two columns join that same
--   pending entry rather than opening a new one.
--   Change        | Alter CLIENT_BOOKLETS: add edited_by_user_id +
--                 | edited_from_version_id (both nullable)
--   Reason        | Manual correction of a generated booklet, saved as a new
--                 | version so history stays truthful
--   Compatibility | Additive only. Readers that ignore the columns see no change;
--                 | "latest row wins" ordering is unchanged.
--   Data migration| None — existing rows are all generated (nulls).
--   Security      | RLS unchanged: INSERT still requires
--                 | app.can_contact_organisation() (client:contact), SELECT stays
--                 | shared. An edit is the same INSERT a regeneration already does.
--   Documentation | Data Model spreadsheet pending (same entry as the table).
--
-- Reversibility: paired rollback in ../rollback/20261004190000_booklet_manual_edits.down.sql

alter table public.client_booklets
  add column edited_by_user_id uuid references public.users (id) on delete set null,
  add column edited_from_version_id uuid references public.client_booklets (id) on delete set null;

comment on column public.client_booklets.edited_by_user_id is
  'Who corrected this version by hand. Null means the version came from Gemini, not from a person.';
comment on column public.client_booklets.edited_from_version_id is
  'The version this manual edit was made from. Null on generated versions. '
  'Edits always target the then-current version, so this chains the history.';
