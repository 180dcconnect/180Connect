-- F095 (#94): Score Breakdown — persist the per-factor inputs beside the score.
--
--   WHAT: adds latest_scores.score_factors (jsonb, nullable). The payload is
--         self-consistent: { "factors": {sector, geography, size,
--         partnershipHistory, previousContact}, "weights": {...the sanitized
--         SCOUT weights the score was computed under...} }. Storing the weights
--         snapshot with the factors means a breakdown row can always reproduce
--         its own priority_score exactly, even after admins reweight via
--         set_scout_weights and old MODEL_VERSIONS rows go inactive.
--
--   WHY:  AC1/AC3 need per-parameter contributions that provably add up to the
--         displayed score. Recomputing at read time could drift from the stored
--         score when organisation data changes after a rescore; persisting the
--         inputs in the same write makes consistency true by construction.
--
--   WHO:  Read by any active user (the table's existing SELECT grant/policy
--         already covers new columns — no policy change). Written only by the
--         service role through persist-latest-score.ts / the backfill script.
--         Derived scoring data, not an ownership/status/approval change — no
--         audit-log entry required (same reasoning as migration 20260831200000).
--
--   Backfill: existing rows keep score_factors NULL until the next
--   `npm run backfill:scores` sweep populates them. NULL is a first-class state
--   ("scored before F095") and the UI renders it as an explainer, not an error.

alter table public.latest_scores
  add column if not exists score_factors jsonb;

-- Shape guard, not a full validator: when present, the column must be an
-- object carrying a five-key factor object (each a number in [0,1]) and a
-- weights object. Deep weight validation stays in the application layer
-- (sanitizeWeights), which is the only writer.
--
-- Every factor condition is preceded by a `?` existence check: `->` on a
-- missing key yields NULL, and a bare `jsonb_typeof(NULL) = 'number'` is NULL
-- too — which a CHECK treats as pass. A missing key must fail the constraint,
-- not silently satisfy it (caught by the pgTAP suite in CI). `?` itself is
-- never NULL, so FALSE AND anything stays FALSE down the chain.
alter table public.latest_scores
  add constraint latest_scores_score_factors_shape
  check (
    score_factors is null
    or (
      jsonb_typeof(score_factors) = 'object'
      and jsonb_typeof(score_factors -> 'factors') = 'object'
      and jsonb_typeof(score_factors -> 'weights') = 'object'
      and (score_factors -> 'factors') ? 'sector'
      and jsonb_typeof(score_factors -> 'factors' -> 'sector') = 'number'
      and (score_factors -> 'factors' ->> 'sector')::numeric between 0 and 1
      and (score_factors -> 'factors') ? 'geography'
      and jsonb_typeof(score_factors -> 'factors' -> 'geography') = 'number'
      and (score_factors -> 'factors' ->> 'geography')::numeric between 0 and 1
      and (score_factors -> 'factors') ? 'size'
      and jsonb_typeof(score_factors -> 'factors' -> 'size') = 'number'
      and (score_factors -> 'factors' ->> 'size')::numeric between 0 and 1
      and (score_factors -> 'factors') ? 'partnershipHistory'
      and jsonb_typeof(score_factors -> 'factors' -> 'partnershipHistory') = 'number'
      and (score_factors -> 'factors' ->> 'partnershipHistory')::numeric between 0 and 1
      and (score_factors -> 'factors') ? 'previousContact'
      and jsonb_typeof(score_factors -> 'factors' -> 'previousContact') = 'number'
      and (score_factors -> 'factors' ->> 'previousContact')::numeric between 0 and 1
    )
  );

comment on column public.latest_scores.score_factors is
  'F095: per-factor inputs behind priority_score — {"factors": {five 0-1 values}, "weights": {sanitized SCOUT weights used}}. Null for rows scored before this column existed; repopulated by backfill:scores.';
