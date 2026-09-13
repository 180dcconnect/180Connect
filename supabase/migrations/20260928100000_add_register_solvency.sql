-- Migration: add_register_solvency
-- Story: F051 (Organisation record) / F229 (Staging) — extends the charity
-- register import.
--
-- WHY THIS MIGRATION EXISTS: the Charity Commission publishes, on every row of
-- the bulk extract, whether a charity is insolvent or in administration. The
-- register file we ship keeps both columns (REGISTER_SCHEMA, `insolvent` and
-- `in_administration`), and the import screen has offered "Exclude insolvent or
-- in administration" as a filter since the redesign — so a criterion can be
-- *applied* to these facts, and once a charity is on the client list the fact
-- itself is discarded. `toRawPayload` never carried them, so nothing downstream
-- could store them.
--
-- The cost of that is visible on the record. A charity can enter administration
-- after we imported it, and the client page will go on describing it as a
-- perfectly good prospect: the priority score reads sector, income and grants,
-- none of which know. For a student consultancy choosing which organisations to
-- approach with unpaid-but-not-free work, "the regulator has appointed
-- administrators" is the single most decision-relevant fact the register
-- publishes, and it was the one we threw away.
--
-- ── Why two nullable booleans and not one status enum ──
--
-- The register's own shape. `insolvent` and `in_administration` are two
-- independent flags in the extract, and a charity can carry either, both, or
-- neither. Collapsing them into one enum would invent a precedence the
-- regulator does not state, and the first time a row carried both we would have
-- to choose which one to lose.
--
-- Nullable rather than `not null default false` is the load-bearing part. Nine
-- tenths of the client list was imported before this column existed, and for
-- those rows the honest answer is "the register was never asked", which is not
-- the same claim as "the register says this charity is solvent". A default of
-- false would manufacture 2,700 assertions of solvency that no register ever
-- made, and nothing downstream could ever tell them from the real ones.
--
-- ── Why these are outside field provenance ──
--
-- Same reasoning as `sector`, `registered_on` and `charity_activities` (see
-- annotateOrganisationOrReport): these are read-only register facts nobody on
-- the team can edit, so there is no "who changed this and to what" history for
-- FIELD_SOURCES to hold. They are also deliberately not in
-- `keyof StandardOrganisation`, which is what TRACKED_FIELD_SOURCES and the
-- field_sources CHECK constraint are built from.
--
-- Schema change approval record (SOP §7):
--   Change        | Two nullable boolean columns on public.organisations:
--                 | `insolvent`, `in_administration`. No default, no backfill.
--   Reason        | Surface the regulator's solvency flags on the client record
--                 | and let the record warn before outreach, rather than
--                 | discarding them at import.
--   Compatibility | Additive and nullable. Every existing row reads null, which
--                 | every consumer treats as "not known" — the same as today's
--                 | behaviour, since today nothing can read them at all.
--   Data migration| None possible. The facts are per-charity and only exist in
--                 | the register file; a re-run of the register import (or the
--                 | profile backfill) fills them for any charity still pending,
--                 | and rows already promoted are filled by the next status
--                 | recheck, which re-annotates what it reads.
--   Security      | No new read surface. ORGANISATIONS already carries
--                 | column-agnostic RLS policies, so two more columns change no
--                 | policy and no grant. End users gain no write path: the
--                 | columns are written by the ingestion store under the
--                 | service role, exactly like `sector` and `registered_on`.
--   Documentation | Data Model tab 04 gains the two rows; run
--                 | `npm run export:data-model` to refresh docs/data-model/.
--
-- Reversibility: ../rollback/20260928100000_add_register_solvency.down.sql

alter table public.organisations
  add column if not exists insolvent boolean,
  add column if not exists in_administration boolean;

comment on column public.organisations.insolvent is
  'Charity Commission: the charity is insolvent. Null means the register has '
  'never been read for this organisation — not that it is solvent. Read-only '
  'register fact, written by the bulk import and the status recheck, never '
  'editable from the app.';

comment on column public.organisations.in_administration is
  'Charity Commission: the charity is in administration. Null means the register '
  'has never been read for this organisation. Independent of `insolvent` — the '
  'extract carries both and a charity may hold either, both, or neither. '
  'Read-only register fact, never editable from the app.';

-- Partial indexes rather than plain ones: both columns are almost always null
-- or false, so the only query that ever wants an index is the one asking for the
-- handful of organisations the regulator has actually flagged.
create index if not exists organisations_insolvent_idx
  on public.organisations (id)
  where insolvent is true;

create index if not exists organisations_in_administration_idx
  on public.organisations (id)
  where in_administration is true;
