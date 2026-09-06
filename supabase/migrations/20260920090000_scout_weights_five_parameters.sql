-- Migration: scout_weights_five_parameters
-- Story: F096 (#95) Admin Score Settings — corrective follow-up.
-- Spec: Data Model tab 06 (MODEL_VERSIONS.config as the weights record); audit-log
--   pattern docs/audit-log-pattern.md.
--
-- WHAT IS WRONG TODAY:
--   The active SCOUT row is still v1, seeded by 20260831200000 with FOUR weights:
--     {"size": 0.25, "sector": 0.25, "geography": 0.25, "previousContact": 0.25}
--   The rule engine has scored on FIVE parameters since F096 wired in partnership
--   history. sanitizeWeights (src/lib/scoring/calculate-priority-score.ts) fills the
--   missing key with its default 0.2 rather than rejecting the config, so nothing
--   ever failed — it just quietly scored under a weight nobody chose, summing to
--   1.2 and normalising every stated 25% down to 20.8%:
--
--     (0.25*sector + 0.25*geography + 0.25*size + 0.2*partnership + 0.25*contact) / 1.2
--
--   Every one of the 2,738 scores on staging was produced by that sum. The admin
--   screen showed it honestly enough — "Total entered: 120%" — but 120% is not a
--   tuning anyone decided on, and the fifth parameter's weight was an
--   implementation default leaking into a product decision.
--
-- WHAT THIS DOES:
--   Adds the next SCOUT generation carrying all five keys at 0.2 each — the
--   five-way equal baseline DEFAULT_WEIGHTS documents as the confirmed rule-engine
--   MVP, and the tuning v1 was reaching for before the fifth parameter existed.
--   Weights now sum to 1.0, so the number an admin types is the share the
--   parameter actually gets.
--
-- HISTORY, NOT AN EDIT:
--   Same rule 20260831200000 set and set_scout_weights (20260903120000) follows:
--   v1 is retired with deprecated_at, never rewritten, because it is the record of
--   what produced the scores currently in LATEST_SCORES. Every existing
--   latest_scores row also carries its own applied weights in score_factors
--   (20260911090000), so nothing loses the ability to explain itself.
--
--   Written as a data migration rather than a set_scout_weights() call because
--   that function is SECURITY DEFINER on auth.uid() and there is no admin session
--   in a migration. It performs the same three writes in the same transaction:
--   deactivate, insert, audit. actor_user_id is null — the audit trail's way of
--   saying "the platform did this", not a person.
--
-- SCORES ARE NOT REWRITTEN HERE:
--   Rescoring is application work (the engine is TypeScript). Run
--   `npm run backfill:scores` after this lands, or save any change on
--   /settings/score-settings, to replay the book under v2.
--
-- Guarded and idempotent: if the active config already carries all five keys,
-- this does nothing at all — so re-applying it after an admin has tuned the
-- weights themselves cannot stamp their choice back to equal fifths.
--
-- Reversibility: paired rollback in ../rollback/20260920090000_scout_weights_five_parameters.down.sql

do $$
declare
  v_active      record;
  v_new_version text;
  v_new_id      uuid;
  v_weights     constant jsonb := jsonb_build_object(
    'sector',             0.2,
    'geography',          0.2,
    'size',               0.2,
    'partnershipHistory', 0.2,
    'previousContact',    0.2
  );
begin
  select * into v_active
    from public.model_versions
   where model_name = 'SCOUT' and is_active
   limit 1;

  if v_active.id is null then
    raise exception 'no active SCOUT model version found';
  end if;

  -- Already five-keyed (an admin has saved weights since): leave it alone.
  if v_active.config -> 'weights' ?& array[
    'sector', 'geography', 'size', 'partnershipHistory', 'previousContact'
  ] then
    raise notice 'active SCOUT config already carries all five weights — nothing to do';
    return;
  end if;

  select 'v' || (coalesce(max(nullif(regexp_replace(version, '\D', '', 'g'), '')::int), 0) + 1)
    into v_new_version
    from public.model_versions
   where model_name = 'SCOUT';

  update public.model_versions
     set is_active = false,
         deprecated_at = now()
   where id = v_active.id;

  insert into public.model_versions
    (model_name, version, implementation_type, config, is_active, notes, created_by_user_id)
  values
    ('SCOUT',
     v_new_version,
     'rules',
     jsonb_build_object('weights', v_weights),
     true,
     'Adds the partnershipHistory weight the engine has scored on since F096. '
     'v1 carried four keys, so the fifth ran at sanitizeWeights'' 0.2 default and '
     'every stated 25% normalised to 20.8%. Five-way equal, summing to 1.0.',
     null)
  returning id into v_new_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    null,
    'scout_weights_changed',
    'model_versions',
    v_new_id,
    jsonb_build_object(
      'from_version', v_active.version,
      'to_version', v_new_version,
      'from', v_active.config -> 'weights',
      'to', v_weights,
      'reason', 'migration 20260920090000: config predated the partnershipHistory parameter'
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- SCHEMA CHANGE APPROVAL RECORD (SOP §7)
--   Change         | Data only: retire SCOUT v1, insert the next generation with
--                  | five weights. No tables, columns, functions or policies.
--   Reason         | The active config predates the fifth scoring parameter, so
--                  | its weight was an application default rather than a decision.
--   Compatibility  | Additive to MODEL_VERSIONS history. Readers already sanitize
--                  | per key, so a five-key config needs no code change.
--   Data migration | Scores are NOT rewritten here — run `npm run backfill:scores`
--                  | (or save on /settings/score-settings) to replay the book.
--   Security       | No grant, policy or RLS change. Writes run as the migration
--                  | role; the admin write-path (set_scout_weights) is untouched.
-- ---------------------------------------------------------------------------
