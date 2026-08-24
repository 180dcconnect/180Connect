-- Migration: create_model_pricing
-- Sequence: fix-forward addition alongside 20260831100200_add_usage_to_ai_generations.sql.
-- Story: F213 LLM Cost Tracking (#208)
-- Spec: docs/rls-permission-matrix.md (new row added by this migration, see below)
--
-- PURPOSE: the $-per-1K-token rate this app prices a generation's cost against
--   (AI_GENERATIONS.cost_usd, previous migration). Kept as its own small reference
--   table rather than a hardcoded map in application code, because a rate is a
--   business fact someone owns and can change (a provider repricing, a new tier),
--   not a constant that belongs in a deploy.
--
-- DELIBERATELY SEEDED EMPTY: this migration does not insert a row for any model.
-- Real per-token USD rates are not something to invent — an incorrect fabricated
-- rate would misreport real spend as confidently as a correct one, and nothing in
-- this codebase or session has verified current, tier-specific Gemini pricing. The
-- app already treats an unpriced model as "cost unknown", not "free" (see the
-- previous migration's comment on cost_usd) specifically so this table can ship
-- empty without silently reporting $0 spend. Whoever owns billing (Bashir, per
-- this repo's established schema-approval chain) should add the real row(s) once
-- confirmed — direct SQL for now; no admin RPC/UI to edit rates exists yet
-- (a reasonable follow-up, not built here to keep this migration's scope to the
-- table itself).
--
-- WRITE PATH: no INSERT/UPDATE/DELETE grant to authenticated, same as
-- DATA_HANDLING_RULES and other admin-owned reference data — until a real
-- editing RPC exists, changing a rate is a direct SQL statement by whoever is
-- authorized to touch the database, not an app action.
--
-- Schema change approval record (SOP §7):
--   Change        | Add MODEL_PRICING table (model text unique, input/output
--                 | USD-per-1K-token rates).
--   Reason        | F213 — the rate AI_GENERATIONS.cost_usd is computed against.
--   Compatibility | New table, no existing behaviour touched.
--   Data migration| None — deliberately seeded empty, see header above.
--   Security      | RLS on; SELECT all active users (the admin generation-history
--                 | page and the generation route both read it); no
--                 | INSERT/UPDATE/DELETE grant to authenticated — see WRITE PATH.
--   Documentation | Data Model tab 04 + tab 02 — pending spreadsheet sign-off,
--                 | same open item as AI_GENERATIONS itself.
--   Approved by   | Pending — flagged for Bashir per SOP §7, not yet confirmed.
--
-- Reversibility: paired rollback in
--   ../rollback/20260831100300_create_model_pricing.down.sql

create table public.model_pricing (
  id                       uuid primary key default gen_random_uuid(),
  model                    text not null unique,
  input_usd_per_1k_tokens  numeric(12, 6) not null,
  output_usd_per_1k_tokens numeric(12, 6) not null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint model_pricing_rates_non_negative
    check (input_usd_per_1k_tokens >= 0 and output_usd_per_1k_tokens >= 0)
);

comment on table public.model_pricing is
  'F213: $-per-1K-token rate for each model, used to price AI_GENERATIONS.cost_usd '
  'at generation time. Deliberately seeded empty by its own migration — see that '
  'file for why. A model absent from this table prices as unknown cost, not free.';

create trigger model_pricing_set_updated_at
  before update on public.model_pricing
  for each row execute function public.set_updated_at();

-- Revoke before grant (MIGRATIONS.md §RLS recipe step 1).
revoke all on public.model_pricing from anon, authenticated;
grant select on public.model_pricing to authenticated;

alter table public.model_pricing enable row level security;

create policy model_pricing_select_active on public.model_pricing
  for select to authenticated
  using (app.is_active_user());
