-- Migration: create_set_scout_weights_rpc
-- Story: F096 (#95) Admin Score Settings.
-- Spec: Data Model tab 06 (MODEL_VERSIONS.config as the weights record); audit-log
--   pattern docs/audit-log-pattern.md; matrix rows for model_versions
--   (docs/rls-permission-matrix.md, "Intelligence" block).
--
-- WHAT THIS DOES:
--   Gives admins the write-path the F096 ticket needs: adjust the relative weight
--   of each scoring parameter (sector, geography, size, partnership history,
--   previous contact) and have every existing client rescored under the new
--   weights, not just future imports.
--
-- WHY AN RPC ON MODEL_VERSIONS, NOT A NEW TABLE:
--   20260831200000 already decided where weights live: MODEL_VERSIONS.config, one
--   row per weights generation ("if weights ever change, a NEW version row is added
--   and this one gets deprecated_at — history, not an edit"). F096 is exactly that
--   event, so this migration adds the function that performs it rather than a
--   parallel table that could disagree with the version history. No schema change:
--   the Data Model tab 06 shape is untouched, so no dictionary update ships here.
--
-- SECURITY DEFINER, SELF-AUTHORISING (docs/audit-log-pattern.md §2-3):
--   model_versions grants authenticated SELECT only, and only for admins — the
--   weights are deliberately hidden from CAMs ("gameable knowledge"). So the write
--   must run as the table owner, and the function re-checks app.is_admin() itself
--   because SECURITY DEFINER bypasses the RLS that would otherwise stop a non-admin.
--   Intentionally in `public` so it is reachable as a PostgREST RPC; same accepted
--   advisor exception as set_user_role (matrix §7).
--
-- THE WRITE IS TRANSACTIONAL WITH ITS AUDIT ROW (pattern §1):
--   Deactivating the old SCOUT version, inserting the new one, and writing the
--   audit_log entry ('scout_weights_changed', from/to weights) all happen in this
--   one function = one transaction, so the trail cannot diverge from the change.
--   No-op submissions (same weights as the active version) return without writing
--   or auditing — the trail records real transitions, not noise.
--
-- RECALCULATION IS DELIBERATELY *NOT* IN HERE:
--   Rescoring every client is application work (the rule engine is TypeScript —
--   src/lib/scoring/score-client.ts), and it is best-effort by contract: a failed
--   rescore must be visible (error log) without being silently entangled with the
--   weight change. The Server Action calls set_scout_weights first, then sweeps
--   LATEST_SCORES through the same rescore path the hooks use.
--
-- Reversibility: paired rollback in ../rollback/20260903120000_create_set_scout_weights_rpc.down.sql

create or replace function public.set_scout_weights(p_weights jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid := (select auth.uid());
  v_active       record;
  v_next_number  int;
  v_new_version  text;
  v_new_id       public.model_versions.id%type;
  v_key          text;
  v_value        jsonb;
begin
  -- Authorisation, re-checked inside the definer boundary.
  if not app.is_admin() then
    raise exception 'only an admin may change scoring weights'
      using errcode = '42501';
  end if;

  -- Shape validation before anything else: five named parameters, each a number
  -- in [0, 1], with at least one positive — an all-zero submission would flatten
  -- every score to 0 (the engine divides by the weight sum).
  if p_weights is null or jsonb_typeof(p_weights) <> 'object' then
    raise exception 'weights must be a JSON object'
      using errcode = '22023';
  end if;

  foreach v_key in array array['sector', 'geography', 'size', 'partnershipHistory', 'previousContact'] loop
    v_value := p_weights -> v_key;
    if v_value is null or jsonb_typeof(v_value) <> 'number'
       or (v_value #>> '{}')::double precision < 0
       or (v_value #>> '{}')::double precision > 1 then
      raise exception 'weight "%" must be a number between 0 and 1', v_key
        using errcode = '22023';
    end if;
  end loop;

  -- Exactly the five named keys: an extra key would be stored verbatim into
  -- config.weights, where it would defeat the no-op equality check below and
  -- pollute the version history with junk that reads as meaningful.
  if exists (
    select 1
      from jsonb_object_keys(p_weights) as k(key)
     where k.key not in ('sector', 'geography', 'size', 'partnershipHistory', 'previousContact')
  ) then
    raise exception 'weights must contain only sector, geography, size, partnershipHistory and previousContact'
      using errcode = '22023';
  end if;

  if ((p_weights ->> 'sector')::double precision
    + (p_weights ->> 'geography')::double precision
    + (p_weights ->> 'size')::double precision
    + (p_weights ->> 'partnershipHistory')::double precision
    + (p_weights ->> 'previousContact')::double precision) <= 0 then
    raise exception 'at least one weight must be greater than 0'
      using errcode = '22023';
  end if;

  select * into v_active
    from public.model_versions
   where model_name = 'SCOUT' and is_active
   limit 1;

  if v_active.id is null then
    raise exception 'no active SCOUT model version found'
      using errcode = 'P0002';
  end if;

  -- No-op changes are not audited (pattern §3 step 5): jsonb equality is
  -- semantic, so key order in the submission cannot manufacture a "change".
  if v_active.config -> 'weights' = p_weights then
    return v_active.id;
  end if;

  -- History, not an edit: retire the old version row and add a new one.
  --
  -- The new config records ONLY the weights. Band cut-offs are deliberately not
  -- carried over: F096 tunes weights, and the engine reads thresholds from code
  -- (PRIORITY_BAND_THRESHOLDS in score-client.ts) — copying them here would
  -- store a decorative value that looks configurable but is never read. v1's
  -- bands stay untouched as historical record; if band tuning ever becomes a
  -- product surface it should be its own audited RPC.

  select coalesce(max(nullif(regexp_replace(version, '\D', '', 'g'), '')::int), 0) + 1
    into v_next_number
    from public.model_versions
   where model_name = 'SCOUT';

  v_new_version := 'v' || v_next_number;

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
     jsonb_build_object('weights', p_weights),
     true,
     'F096: weights adjusted from the admin score settings screen',
     v_actor)
  returning id into v_new_id;

  -- Audit in the same transaction as the change (docs/audit-log-pattern.md §1):
  -- who changed what, and when, so a prioritisation shift is traceable.
  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor,
    'scout_weights_changed',
    'model_versions',
    v_new_id,
    jsonb_build_object(
      'from_version', v_active.version,
      'to_version', v_new_version,
      'from', v_active.config -> 'weights',
      'to', p_weights
    )
  );

  return v_new_id;
end;
$$;

comment on function public.set_scout_weights(jsonb) is
  'F096: admin-only scoring-weight change. SECURITY DEFINER because model_versions '
  'takes no authenticated writes; self-checks app.is_admin(), retires the active '
  'SCOUT version, inserts the next one, and writes an audit_log row — all in one '
  'transaction. Same-weights submissions are accepted no-ops. Accepted advisor '
  'exception — an intentional, self-authorising RPC (matrix §7).';

-- anon can never call it; authenticated can (the body rejects non-admins). Revoke
-- from public AND anon explicitly — EXECUTE defaults to public on create, and
-- Supabase also default-grants execute to anon, which a public revoke alone does
-- not remove (see set_user_role, 20260723100100).
revoke execute on function public.set_scout_weights(jsonb) from public;
revoke execute on function public.set_scout_weights(jsonb) from anon;
grant execute on function public.set_scout_weights(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- SCHEMA CHANGE APPROVAL RECORD (SOP §7)
--   Change         | Add function set_scout_weights(jsonb). No tables or columns.
--   Reason         | F096 needs an auditable admin write-path onto the weights
--                  | already recorded in MODEL_VERSIONS.config (tab 06).
--   Compatibility  | Additive. Nothing existing reads or calls it until the F096
--                  | Server Action lands in the same PR.
--   Data migration | None — the active SCOUT v1 row stays exactly as it is until
--                  | an admin submits a change.
--   Security       | EXECUTE revoked from public/anon, granted to authenticated;
--                  | the body re-checks app.is_admin(). model_versions RLS is
--                  | unchanged.
--   Documentation  | Matrix gains a set_scout_weights row; tab 06 semantics
--                  | (config-as-history) already cover the data written here.
-- ---------------------------------------------------------------------------
