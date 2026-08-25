-- F119 (#116) AC1/AC2: persist the CAM-reviewed recipient on outreach messages.
--
-- Until now the recipient only existed as client-side state: a manual override of
-- the contact's email was lost on save, and a saved draft reopened with whatever
-- the contact record said *at reopen time*, not what the CAM had reviewed. This
-- column stores the recipient exactly as last reviewed/saved, following the same
-- "reviewed content is what sends" rule as subject and body (F116/F123).
--
-- Named per Data Model tab 07 / tab 02 (SENT_TO_EMAIL): "exactly as reviewed and
-- approved by the CAM before sending; never re-derived from the contact record".
-- One deliberate wording divergence to flag to the data-model owner: the
-- dictionary says "null until sent", but AC2 requires the address already on a
-- still-unsent draft (that is the whole point of saving it), so it is written at
-- save/review time too.
--
-- Nullable: rows written before this migration keep null.
--
-- No RLS change: this is a column on an existing table whose row-level policies
-- and grants already govern access (20260804190000_create_outreach.sql).
-- Reversibility: paired rollback in ../rollback/20260902090000_add_recipient_to_outreach_messages.down.sql

alter table public.outreach_messages
  add column sent_to_email text;

comment on column public.outreach_messages.sent_to_email is
  'The recipient address exactly as reviewed/saved by a CAM (F119/F116), or null '
  'for legacy rows. Never re-derived from contacts.email on read — a reviewed '
  'override must survive save/reopen round-trips.';
