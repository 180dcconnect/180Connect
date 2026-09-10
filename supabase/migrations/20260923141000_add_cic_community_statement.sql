-- Migration: add_cic_community_statement
-- Sequence: no new step in Data Model tab "11 Supabase Migration Sequence" —
--   this adds two nullable columns to ORGANISATIONS, created at step 4.0.
-- Story: giving companies the equivalent of ORGANISATIONS.charity_activities.
--
-- WHY THIS COLUMN EXISTS
--
-- 20260923140000_add_sic_codes.sql gave companies their first descriptive
-- field, and was honest about its ceiling: a SIC code is the drawer the
-- registrar filed a company in, not what it set out to do. 118 of the 413
-- companies on staging share 85590 "Other education n.e.c."; it cannot tell two
-- of them apart, and a booklet written from it would say the same thing about
-- all 118.
--
-- Every one of those companies is a Community Interest Company, and every CIC
-- files a CIC36 — the community interest statement — at incorporation. Section
-- A names the community it intends to benefit; Section B describes the day-to-day
-- activities. It is the company's own filed account of its purpose, approved by
-- the CIC Regulator, on the public record. It is the exact companies-side
-- counterpart of the charity's filed activities, and this column is its home.
--
-- WHY IT NEEDS OCR, AND WHY THAT IS ACCEPTABLE
--
-- Companies House publishes no structured field for it. It exists only inside
-- the incorporation filing PDF (filing type CICINC), and in every filing
-- sampled the CIC36 pages are images rather than text — the first ~9-14 pages
-- of the document are machine-readable and the CIC36 is not among them.
--
-- The images are 1-bit bitmaps at 200 DPI of printed, typed forms, stored
-- uncompressed-per-page under FlateDecode, so they are extracted with zlib and
-- read with tesseract.js: no rasteriser, no native dependency, no model.
-- Measured mean word confidence across three sampled filings, including one
-- genuine photocopy: 94.5, 94.7, 88.2.
--
-- This is transcription, not generation. That distinction is the whole reason
-- the column is allowed to exist alongside the Data Model's rule that mission
-- text is register-sourced: nothing here invents a sentence the company did not
-- file. But transcription of scanned paper is not lossless, and the text can
-- carry OCR errors that no test will catch — which is why the column comment
-- says so, and why the value is labelled as filed-and-transcribed everywhere it
-- is shown.
--
-- WHY A SECOND COLUMN FOR THE CURSOR
--
-- cic_statement_checked_at is the queue, exactly as grants_fetched_at is for
-- 360Giving (20260923124000). Without it, a company that has no CICINC filing —
-- an ordinary limited company, or a CIC whose filing we could not read — is
-- indistinguishable from one never attempted, and the backfill retries it on
-- every run forever. Set on every attempt, success or not:
--
--   null                     never attempted -> queued
--   <timestamp>, text null   attempted, nothing to store; do not retry
--   <timestamp>, text set    attempted and read
--
-- WHY NOT A NEW DATA SOURCE
--
-- The job reads a Companies House document with the Companies House
-- credentials, so it runs as `companies_house` throughout — its ingestion_runs
-- rows and its data-handling policy lookup both. DATA_SOURCES and the
-- data_source_name domain are unchanged. This mirrors the register profile
-- backfill, which records itself as charity_commission_bulk rather than
-- inventing a source for a job that fetches nothing new.
--
-- PERSONAL DATA
--
-- A CIC incorporation filing is full of it: director names, dates of birth,
-- service addresses, and on the CIC36's own contact page an email address.
-- None of it is stored. The extractor returns two named boxes from the
-- statement pages or nothing at all — it never returns "the page", the PDF is
-- never written to disk, and no other page's text is kept. What is extracted
-- then passes through applyDataHandling before any write, so the global
-- redact_email rule catches an address a company typed into its own statement.
--
-- The residual risk is the one docs/personal-data-exclusions.md already
-- documents and accepts under "Documented limits": a person's name written in
-- ordinary prose is not caught, because the platform runs no NER. A director
-- who names themselves inside their own community interest statement would
-- survive, the same way a founder named on an About page survives today. This
-- is a known boundary being inherited deliberately, not a new exposure.
--
-- Schema change approval record (SOP §7):
--   Change        | Two nullable columns on public.organisations:
--                 | cic_community_statement text, cic_statement_checked_at
--                 | timestamptz. One partial index on the cursor.
--   Reason        | Companies have no filed purpose text in the platform. SIC
--                 | codes fill the field but cannot differentiate — 118 of 413
--                 | imported companies share one code. The CIC36 community
--                 | interest statement is the company's own filed description
--                 | and is available for every CIC on the client list.
--   Compatibility | Additive and nullable, no default. Nothing reads either
--                 | column before the job added in the same commit; every
--                 | existing row reads as "never attempted", which is true.
--   Data migration| None, and none is possible — there is nothing in
--                 | RAW_SOURCE_RECORDS to copy from. The text has never been
--                 | fetched; the backfill job populates it.
--   Security      | No new table, so no new RLS surface — ORGANISATIONS keeps
--                 | its existing column-agnostic policies. See PERSONAL DATA
--                 | above for what is and is not stored. Externally authored
--                 | free text: every reader must treat it as untrusted input,
--                 | and the booklet prompt already fences profile data against
--                 | injection (PRD §11.5, src/lib/booklet/build-prompt.ts).
--   Documentation | Data Model tab "04 Entities" gains two fields on
--                 | ORGANISATIONS. Run npm run export:data-model.
--   Approved by   | Bashir (Project Leader).
--
-- Reversibility: paired rollback in
-- ../rollback/20260923141000_add_cic_community_statement.down.sql

alter table public.organisations
  add column if not exists cic_community_statement text,
  add column if not exists cic_statement_checked_at timestamptz;

comment on column public.organisations.cic_community_statement is
  'The community interest statement a Community Interest Company filed on form '
  'CIC36 at incorporation — Section A (the community it intends to benefit) and '
  'Section B (its day-to-day activities). The companies-side counterpart of '
  'charity_activities: the organisation''s own filed words, on the public '
  'record, never generated. Transcribed by OCR because Companies House '
  'publishes it only as a scanned page, so it may carry transcription errors '
  'and is usually truncated — the form clips each box and invites the filer to '
  'continue on a separate sheet we do not read. Null for a charity, for a '
  'non-CIC company, and for a CIC whose filing could not be read; '
  'cic_statement_checked_at says which. Externally authored free text: treat as '
  'untrusted input anywhere it reaches a model.';

comment on column public.organisations.cic_statement_checked_at is
  'When the CIC36 was last looked for. Null means never asked, which is what '
  'queues the organisation for the backfill. A timestamp means asked and '
  'answered — including answered with nothing, which is why it is set even when '
  'no statement was found. Without it, every company with no CIC36 would be '
  'retried on every run forever.';

-- The backfill asks one question: "which organisations are due?", oldest first
-- with nulls ahead of every timestamp. `nulls first` matches that ordering
-- exactly so draining the queue is an index scan rather than a sort over the
-- whole table — the same shape as organisations_grants_fetched_at_idx.
create index if not exists organisations_cic_statement_checked_at_idx
  on public.organisations (cic_statement_checked_at nulls first);
