-- Migration: create_training_examples_view
-- Sequence: addition (needs public.score_snapshots, public.outcomes,
--   public.outreach_messages, public.organisations, public.ai_generations).
-- Story: F098 (#97) — ML-Ready Training Dataset.
--
-- WHAT THIS CHANGES:
--   Adds ONE view, public.training_examples: one row per scored outreach
--   attempt (SCORE_SNAPSHOTS is unique per message), carrying its feature
--   vector beside its outcome label. This is the "structured, queryable
--   format" AC1/AC2 ask for — a data scientist runs `select * from
--   training_examples where outcome_label is not null` and has a training
--   set; nothing reverse-engineers live tables by joining four tables with
--   drift-prone semantics.
--
-- THE JOIN SEMANTICS (stated once):
--   features  ← SCORE_SNAPSHOTS (point-in-time at send, F097)
--   label     ← OUTCOMES, latest row per message (a conversation can accrue
--               several outcomes as statuses move — reply then soft_no — and
--               the training example should carry where it ENDED)
--   metadata  ← AI_GENERATIONS latest per message (cam_edited / edit_distance
--               / model — how much human shaping the email got) and
--               OUTREACH_MESSAGES.sent_at (timing)
--   attribute ← ORGANISATIONS.sector as organisation_sector, CURRENT state:
--               unlike everything else in the row this is not point-in-time.
--               Documented caveat, kept because sector moves rarely and the
--               column is too useful to a model to omit; drop it from any
--               training run that disagrees.
--   Attempts WITHOUT an outcome yet appear with outcome_label null (LEFT
--   JOIN): the dataset shows the funnel, not just the completions — an
--   exporter filters them, an analyst counts them.
--
-- PRIVACY (AC3) — what is deliberately NOT here, though every source table
-- carries it:
--   no email subject/body, no recipient address (OUTREACH_MESSAGES), no reply
--   text or sentiment/intent narrative (REPLY_EVENTS), no CAM free-text notes
--   (OUTCOMES.notes — a CAM's "spoke to Jane about X" must never enter a
--   dataset), no prompt text or token/cost accounting nobody trains on
--   (AI_GENERATIONS). Every exposed column is an id, a 0-1 number, an enum
--   token, a boolean/integer derived fact, or a timestamp. The pgTAP suite
--   asserts this as an ALLOWLIST — a new column cannot appear without a
--   test edit, which is exactly the friction F246/F247 taught us to want.
--   The underlying tables' own deny-lists stay authoritative at ingestion;
--   this view adds none of it back.
--
-- SECURITY:
--   security_invoker = true, so the caller's own privileges and RLS apply to
--   every underlying table. SCORE_SNAPSHOTS grants SELECT to admins only, so
--   the view is admin-only BY CONSTRUCTION — a CAM's SELECT returns empty,
--   the same silent-RLS behaviour as querying SCORE_SNAPSHOTS directly. No
--   new policy is created and none can be bypassed: the view adds zero rows
--   the caller could not already read table-by-table.
--
-- Schema change approval record (SOP §7):
--   Change        | Add view public.training_examples (security_invoker),
--               | SELECT granted to authenticated (gated by underlying RLS).
--               | No table, column, enum or policy changes underneath.
--   Reason        | F098 AC1 (structured queryable dataset), AC2 (directly
--               | queryable + exportable — scripts/export-training-dataset.mts
--               | lands in this PR), AC3 (allowlisted columns only).
--   Compatibility | Purely additive; nothing reads the view yet except the
--               | export script and its tests. Underlying writers untouched.
--   Data migration| None.
--   Security      | security_invoker view; grant is cosmetic without the
--               | underlying privileges (documented above). Anon gets nothing.
--   Documentation | docs/rls-permission-matrix.md §3.9 updated in the same
--               | PR. Data Model tab 06 gains TRAINING_EXAMPLES (spreadsheet
--               | owned by Bashir; export re-run).
--   Approved by   | Bashir (Project Manager) — F098 unblocked after #509.
--
-- Reversibility: paired rollback in ../rollback/20260912120000_create_training_examples_view.down.sql

create view public.training_examples
with (security_invoker = true) as
select
  ss.outreach_message_id,
  ss.organisation_id,

  -- Feature half (point-in-time at send — F097).
  ss.sector,
  ss.geography,
  ss.size,
  ss.partnership_history,
  ss.previous_contact,
  ss.priority_score,
  ss.priority_band,
  ss.model_version_id,
  ss.scored_at as snapshot_scored_at,

  -- Timing and org attribute.
  om.sent_at,
  o.sector as organisation_sector,  -- CURRENT state, see header caveat

  -- Email metadata: derived facts only, never content (see privacy block).
  ag.cam_edited,
  ag.edit_distance,
  ag.model as generation_model,

  -- Label half.
  oc.outcome_type as outcome_label,
  oc.created_at as outcome_recorded_at
from public.score_snapshots ss
join public.outreach_messages om
  on om.id = ss.outreach_message_id
join public.organisations o
  on o.id = ss.organisation_id
left join lateral (
  select a.cam_edited, a.edit_distance, a.model
    from public.ai_generations a
   where a.outreach_message_id = ss.outreach_message_id
   order by a.created_at desc
   limit 1
) ag on true
left join lateral (
  select oc2.outcome_type, oc2.created_at
    from public.outcomes oc2
   where oc2.outreach_message_id = ss.outreach_message_id
   order by oc2.created_at desc
   limit 1
) oc on true;

comment on view public.training_examples is
  'F098: the ML-ready training dataset — one labelled row per scored outreach '
  'attempt. Features from SCORE_SNAPSHOTS (send-time truth), label from the '
  'latest OUTCOMES row per message (null until an outcome exists), metadata '
  'from AI_GENERATIONS. Allowlist of non-personal columns only (see migration '
  '20260912120000); admin-readable via the underlying SCORE_SNAPSHOTS RLS, '
  'empty for everyone else.';

revoke all on public.training_examples from anon;
grant select on public.training_examples to authenticated;
