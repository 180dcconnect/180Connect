-- Migration: create_model_versions_and_latest_scores
-- Story: F058 (#60) Filter by Priority Score and F059 (#61) Sort by Priority Score,
--   standing on F088 (#424) Base Client Priority Score.
-- Spec: Data Model tab 06 (Predictions — MODEL_VERSIONS, LATEST_SCORES); sequence
--   steps 8.0/9.0; Security Controls Register rows at docs/rls-permission-matrix.md
--   ("Intelligence" block): LATEST_SCORES read-all / service-role-only writes,
--   MODEL_VERSIONS admin-only read.
--
-- WHY THESE TWO TABLES, AND NOT THE REST OF TAB 06:
--   F058/F059 need somewhere to *read* each client's current priority score from.
--   The scoring engine itself is pure TypeScript on dev
--   (src/lib/scoring/calculate-priority-score.ts, EQUAL_WEIGHTS confirmed with the
--   team lead), so this migration persists its output; it does not port the rule
--   engine into SQL. AGENT_RUNS (tab 06 "p") and the step-8 companions
--   (SCORING_WEIGHTS, FEATURE_DEFINITIONS, AGENT_PROMPTS) are deferred: nothing in
--   these two tickets reads them, and creating empty scaffolding ahead of the agent
--   tickets that own them would be dead weight. Consequence, deliberate: the
--   scout_run_id / compass_run_id columns are NOT created yet — they are pure FKs
--   into AGENT_RUNS and get added by whichever migration lands that table, exactly
--   like any other fix-forward schema change.
--
-- ONE ROW PER ORGANISATION, NOT A HISTORY:
--   LATEST_SCORES is the cache the name says — the latest score per client, upserted
--   by the rescore write path (src/lib/scoring/persist-latest-score.ts) and kept
--   fresh by hooks at the places that mutate scoring inputs (ingestion promote,
--   manual-entry approval) plus scripts/backfill-priority-scores.mts for existing
--   rows. Run history belongs to AGENT_RUNS/P once those land, not here.
--
-- BAND THRESHOLDS (pending team confirmation, Bashir):
--   priority_band mirrors the score the engine produced so the F058 filter can
--   select whole ranges without every caller re-deriving cut-offs:
--     high   >= 0.70
--     medium >= 0.40 and < 0.70
--     low    <  0.40
--   The band is written by the application at rescore time; the check constraint
--   only guards vocabulary, not arithmetic.
--
-- SECURITY — WEIGHTS ARE NOT CAM-READABLE:
--   The matrix is explicit that LATEST_SCORES is read-all but write-service-role,
--   while the weights that produce scores stay hidden from CAMs ("knowing the
--   weights makes them gameable"). So: SELECT for active users on latest_scores;
--   NO insert/update/delete grants for authenticated on either table — the rescore
--   path connects with the service role (admin client), which holds its privileges
--   independently of what we grant here. MODEL_VERSIONS is readable by admins only.
--   These writes record derived scores, not ownership/status/approval changes, so
--   the audit-log RPC pattern does not apply (docs/audit-log-pattern.md scope).
--
-- SCHEMA CHANGE APPROVAL RECORD — SPREADSHEET GAP (SOP §7):
--   Tab 06 of the spreadsheet already models both tables (this migration follows it;
--   Bashir owns the sheet). Two deviations to fold back into the sheet at the next
--   export, flagged here rather than blocking:
--     1. scout_run_id / compass_run_id omitted until AGENT_RUNS exists (above).
--     2. Sequence tab gets one annotation row crediting 8.0/9.0 to F058/F059, same
--        kind of note as the step-21 F195 row.
--   Change         | Add MODEL_VERSIONS, LATEST_SCORES (new tables, from tab 06)
--   Reason         | F058/F059 read each client's persisted current score.
--   Compatibility  | New tables. Nothing existing reads or writes them; the list
--                  | query gains an embedded latest_scores join behind the same RLS.
--   Data migration | None for existing rows — scripts/backfill-priority-scores.mts
--                  | populates LATEST_SCORES from the rule engine after apply.
--   Security       | RLS on both, policies in this migration. latest_scores: SELECT
--                  | for app.is_active_user(). model_versions: SELECT for
--                  | app.is_active_user() AND app.is_admin(). No write verbs for
--                  | anon/authenticated on either — service role only.
--   Documentation  | Matrix rows already present; spreadsheet annotations above.
--
-- Reversibility: paired rollback in ../rollback/20260831200000_create_model_versions_and_latest_scores.down.sql

create table public.model_versions (
  id                   uuid primary key default gen_random_uuid(),
  model_name           text not null constraint model_versions_name_check
                         check (model_name in ('SCOUT', 'VOICE', 'COMPASS', 'PULSE')),
  version              text not null,
  implementation_type  text not null constraint model_versions_implementation_check
                         check (implementation_type in ('rules', 'llm', 'ml_model')),
  -- Weights snapshot for rules; prompt identifier/settings for LLMs. For the SCOUT
  -- v1 rules row below this is EQUAL_WEIGHTS verbatim, so what produced a score is
  -- always reconstructable even after weights change.
  config               jsonb,
  is_active            boolean not null default false,
  notes                text,
  created_by_user_id   uuid references public.users (id),
  created_at           timestamptz not null default now(),
  deprecated_at        timestamptz,

  -- The data dictionary's "only one version should be active per model" phrased as
  -- a partial unique index rather than a trigger: cheap, and impossible to violate
  -- from any write path including the service role.
  constraint model_versions_name_version_unique unique (model_name, version),
  constraint model_versions_deprecated_requires_inactive_check
    check (deprecated_at is null or is_active = false)
);

-- Only one active version per model. (Partial unique indexes cannot be table
-- constraints; declared separately for that reason.)
create unique index model_versions_one_active_per_model
  on public.model_versions (model_name) where is_active;

create table public.latest_scores (
  id                       uuid primary key default gen_random_uuid(),
  -- One latest-score row per organisation — the upsert target keyed on this column,
  -- same shape as client_booklets (20260827000001).
  organisation_id          uuid not null unique references public.organisations (id) on delete cascade,
  priority_score           double precision
                             constraint latest_scores_priority_score_range
                             check (priority_score is null or (priority_score >= 0 and priority_score <= 1)),
  priority_band            text constraint latest_scores_priority_band_check
                             check (priority_band in ('high', 'medium', 'low')),
  fit_reason               text,
  recommended_service      text,
  -- COMPASS / PULSE outputs (tab 06). Nullable until those agents exist; the rule
  -- engine only fills the priority_* pair today.
  partnership_value_score  double precision
                             constraint latest_scores_partnership_range
                             check (partnership_value_score is null or (partnership_value_score >= 0 and partnership_value_score <= 1)),
  partnership_band         text constraint latest_scores_partnership_band_check
                             check (partnership_band in ('high', 'medium', 'low')),
  estimated_project_type   text,
  semester_fit_score       double precision
                             constraint latest_scores_semester_range
                             check (semester_fit_score is null or (semester_fit_score >= 0 and semester_fit_score <= 1)),
  sector_growth_score      double precision
                             constraint latest_scores_sector_growth_range
                             check (sector_growth_score is null or (sector_growth_score >= 0 and sector_growth_score <= 1)),
  score_source             text not null default 'rule_engine'
                             constraint latest_scores_source_check
                             check (score_source in ('rule_engine', 'llm', 'ml_model')),
  -- When the organisation was last scored — distinct from updated_at (last row
  -- touch) for the same reason client_booklets separates generated_at/updated_at.
  scored_at                timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- A stored score must say which band it was banded into, and vice versa — the
  -- F058 filter trusts priority_band, so a row with one and not the other would
  -- silently drop out of every band selection.
  constraint latest_scores_score_band_pair_check check (
    (priority_score is null) = (priority_band is null)
  )
);

comment on table public.model_versions is
  'Scoring-model versions (Data Model tab 06). config snapshots the exact weights or '
  'prompt a version used, so any stored score stays reconstructable after a reweight.';
comment on table public.latest_scores is
  'The latest priority score per organisation (F088 rule engine today), read by the '
  'client list for F058 filtering and F059 sorting. Upserted by the service-role '
  'rescore path; never written by CAM-facing roles.';
comment on column public.latest_scores.scored_at is
  'When the organisation was last scored. A stale scored_at relative to recent data '
  'changes means the rescore hook did not fire — visible in staging, not silent.';

create index latest_scores_priority_score_idx on public.latest_scores (priority_score);
create index latest_scores_priority_band_idx on public.latest_scores (priority_band);

create trigger latest_scores_set_updated_at
  before update on public.latest_scores
  for each row execute function public.set_updated_at();

-- The active SCOUT rules version this generation of scores was produced under.
-- config is calculate-priority-score.ts's EQUAL_WEIGHTS verbatim (confirmed with the
-- team lead — see that file's header); if weights ever change, a NEW version row is
-- added and this one gets deprecated_at — history, not an edit.
insert into public.model_versions (model_name, version, implementation_type, config, is_active, notes)
values (
  'SCOUT',
  'v1',
  'rules',
  '{"weights": {"sector": 0.25, "geography": 0.25, "size": 0.25, "previousContact": 0.25},
    "bands": {"high": 0.70, "medium": 0.40}}',
  true,
  'F088 equal-weight rule-engine MVP (F058/F059 persistence)'
)
on conflict (model_name, version) do nothing;


-- ---------------------------------------------------------------------------
-- Security. REVOKE before GRANT (matrix §2.1) — see MIGRATIONS.md's five-step recipe.
-- ---------------------------------------------------------------------------
revoke all on public.model_versions from anon, authenticated;
revoke all on public.latest_scores from anon, authenticated;

alter table public.model_versions enable row level security;
alter table public.latest_scores enable row level security;

-- LATEST_SCORES: read-all (active users) — CAMs work the prioritised queue.
grant select on public.latest_scores to authenticated;

create policy latest_scores_select_active on public.latest_scores
  for select to authenticated
  using (app.is_active_user());

-- Writes: deliberately ungranted. The rescore path runs as service_role, which
-- retains its own privileges regardless of these revokes; a CAM-side tamper path
-- (e.g. a hand-built supabase-js call writing someone a 1.0 score) is closed here.
-- See the security block in this migration's header.

-- MODEL_VERSIONS: admin-only read — the weights are gameable knowledge.
grant select on public.model_versions to authenticated;

create policy model_versions_select_admin on public.model_versions
  for select to authenticated
  using (app.is_active_user() and app.is_admin());
