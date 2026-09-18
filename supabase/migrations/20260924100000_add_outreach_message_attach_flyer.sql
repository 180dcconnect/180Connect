-- Migration: add_outreach_message_attach_flyer
-- Story: F217 (attachment storage), extending it to the branch's own collateral.
--
-- WHY A COLUMN AND NOT A LINKED ATTACHMENT: OUTREACH_MESSAGE_ATTACHMENTS links a
--   message to a row in ATTACHMENTS, and ATTACHMENTS is keyed per organisation
--   (`<organisation_id>/<attachment_id>-<filename>`, 20260823090000). The 180DC
--   flyer belongs to the branch, not to any client, so linking it would store one
--   identical copy per organisation against a 1 GB Storage quota (AGENTS.md
--   "Infrastructure budget"). The file ships with the code instead
--   (src/lib/outreach/assets/), and all a message needs to record is whether it
--   goes out — one boolean, not a file reference.
--
-- WHY IT MUST BE PERSISTED AT ALL: the choice is made in the compose window, but
--   the send runs later — through sendReviewedDraft after human review, or through
--   deliverDueScheduledEmails with no UI present at all. A flag passed only as a
--   send-time argument would be lost by a scheduled send, which would then either
--   drop the flyer or attach one the draft never mentioned. Either way the email's
--   own wording ("I've attached a flyer") would stop matching what was sent.
--
-- DEFAULT FALSE, NOT TRUE: the column is what the drafting prompt's attachment
--   rule is derived from (attachmentRule, src/lib/outreach/stage-one-prompt.ts).
--   Every message already in the table was drafted under the old rule, which
--   forbade referring to an attachment, so false is what those rows actually mean.
--   The compose window defaults its own toggle to true; that is a UI default for
--   new first-contact emails, deliberately not a column default, so a row written
--   by any other path is never assumed to carry collateral.
--
-- Schema change approval record (SOP §7):
--   Change        | New column OUTREACH_MESSAGES.attach_flyer (boolean, not null,
--                 | default false).
--   Reason        | F217 — records whether the branch flyer is sent with a
--                 | first-contact email, so review, scheduled delivery and the
--                 | draft's own wording all agree on what is enclosed.
--   Compatibility | Additive only. Existing rows take the default, which matches
--                 | how they were drafted. No policy, index or query changes: the
--                 | column is read only by the send path, which is already
--                 | row-scoped by the existing OUTREACH_MESSAGES policies.
--   Data migration| None.
--   Security      | Inherits OUTREACH_MESSAGES RLS unchanged. The column carries
--                 | no client data — it is a boolean about branch collateral —
--                 | and grants no read or write path that did not already exist.
--   Documentation | Data Model tab 04 (OUTREACH_MESSAGES) + tab 02 Data
--                 | Dictionary still owed against the spreadsheet.
--
-- Reversibility: paired rollback below.

alter table public.outreach_messages
  add column if not exists attach_flyer boolean not null default false;

comment on column public.outreach_messages.attach_flyer is
  'Whether the 180DC Sheffield flyer (shipped in src/lib/outreach/assets/, not Storage) is sent with this message. Set at compose time for first-contact emails; read by the send path and by the drafting prompt''s attachment rule.';

-- Rollback:
--   alter table public.outreach_messages drop column if exists attach_flyer;
