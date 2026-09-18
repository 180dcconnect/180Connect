-- Migration: seed_model_pricing
-- Sequence: fix-forward addition to 20260831100300_create_model_pricing.sql.
-- Story: F214 Natural Language Charity Search (#209), closing F213's open item.
-- Spec: docs/rls-permission-matrix.md (existing MODEL_PRICING row, unchanged)
--
-- PURPOSE: put real rates in MODEL_PRICING, and make the age of a rate visible.
--
--   The creating migration deliberately seeded this table empty, on the grounds
--   that a fabricated rate misreports spend as confidently as a correct one. That
--   was right, and this migration does not overturn it — it satisfies it. The
--   rates below were read from ai.google.dev/gemini-api/docs/pricing on
--   2026-09-09 and match the team's own LLM Provider Research doc for both
--   models; nothing here is inferred.
--
--   What the original migration wanted to avoid was recording projected dollars
--   as invoiced ones while the project's key sits on the free tier. Two things
--   answer that:
--     * `confirmed_on` and `source_url`, added here, say when a human last
--       checked a rate and against what, so a reader can tell a current figure
--       from a stale one instead of trusting the number's existence.
--     * The rates are list prices, and every surface that totals them must say
--       "estimated at list price" rather than "spent". A free-tier key bills $0;
--       what this table buys is knowing what the same usage *would* cost, which
--       is the number worth having before a billing account is ever linked.
--
--   With the table empty, cost_usd was null on all 31 generations recorded to
--   date and the AI-spend surfaces showed nothing at all — which is a worse
--   answer than a labelled estimate, not a safer one.
--
-- KEEPING THESE CURRENT (the reason this file exists rather than a one-off SQL
--   statement someone runs by hand):
--     * Rates change on a date Google announces in advance. Gemini 3.6 Flash's
--       promotional rate ends 2026-12-31 and doubles on 2027-01-01, to
--       $1.50/$7.50 per million. This table has no effective-dating, so that
--       change is a follow-up migration someone must remember — tracked as its
--       own issue rather than bolted on here, since effective-dating changes the
--       unique key and all four read sites.
--     * The way this actually goes stale is a model swap, not a repricing:
--       GEMINI_MODEL and GEMINI_SEARCH_MODEL are meant to be changed freely, and
--       a model with no row here used to price as null in total silence. That is
--       now an ERROR_LOG report on the first generation after the swap
--       (src/lib/ai/model-rate.ts), which is where the alarm belongs — a CI gate
--       could only check a freshly-migrated local database, where the question
--       has no answer yet.
--
-- Schema change approval record (SOP §7):
--   Change        | Add MODEL_PRICING.confirmed_on (date) and .source_url (text);
--                 | insert rates for gemini-3.6-flash and gemini-3.5-flash-lite.
--   Reason        | F213's cost tracking reports nothing while this table is empty;
--                 | F214 adds a second model whose cost needs to be visible.
--   Compatibility | Additive. Both columns are nullable or defaulted; computeCostUsd
--                 | reads only the two rate columns and is untouched.
--   Data migration| Two inserts, idempotent on the existing unique key on `model`.
--   Security      | Unchanged. RLS on; SELECT for active users; no write grant to
--                 | authenticated — a rate change stays a migration.
--   Documentation | Data Model tab 04 — MODEL_PRICING gains two columns.
--   Approved by   | Bashir (Project Leader), 9 Sep 2026 — SOP §7.
--
-- Reversibility: paired rollback in
--   ../rollback/20260925090100_seed_model_pricing.down.sql

alter table public.model_pricing
  add column if not exists confirmed_on date,
  add column if not exists source_url text;

comment on column public.model_pricing.confirmed_on is
  'The date a human last read this rate from the provider''s published pricing. Not '
  'updated_at, which moves for any edit: this is specifically "when was this last '
  'verified against the source", and a rate months past it should be re-checked '
  'before anyone quotes the totals built on it.';

comment on column public.model_pricing.source_url is
  'Where the rate was read from, so re-verifying is a click rather than a search.';

-- List prices, per 1,000 tokens (the unit this table stores; the provider
-- publishes per million, hence the division by 1,000 in each figure below).
--
--   gemini-3.6-flash       $0.75 / $3.75 per 1M  (promotional, through 2026-12-31)
--   gemini-3.5-flash-lite  $0.30 / $2.50 per 1M
--
-- Both verified 2026-09-09 against ai.google.dev/gemini-api/docs/pricing.
insert into public.model_pricing (
  model, input_usd_per_1k_tokens, output_usd_per_1k_tokens, confirmed_on, source_url
) values
  ('gemini-3.6-flash',      0.000750, 0.003750, date '2026-09-09', 'https://ai.google.dev/gemini-api/docs/pricing'),
  ('gemini-3.5-flash-lite', 0.000300, 0.002500, date '2026-09-09', 'https://ai.google.dev/gemini-api/docs/pricing')
on conflict (model) do update
   set input_usd_per_1k_tokens  = excluded.input_usd_per_1k_tokens,
       output_usd_per_1k_tokens = excluded.output_usd_per_1k_tokens,
       confirmed_on             = excluded.confirmed_on,
       source_url               = excluded.source_url;
