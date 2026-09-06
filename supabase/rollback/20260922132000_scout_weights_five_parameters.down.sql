-- Rollback for 20260922132000_scout_weights_five_parameters.sql
--
-- Reactivates the generation this migration retired and removes the one it
-- added, undoing the whole change including its audit row. Deleting an audit
-- entry is normally forbidden — the trail is the record — but this one
-- describes a version row that is about to stop existing, and leaving it would
-- point at nothing.
--
-- Only ever undoes THIS migration's own work: it targets the generation whose
-- notes and null actor identify it, so an admin's later tuning (a version they
-- saved through /settings/score-settings, which carries their user id) is never
-- what gets rolled back.
--
-- Scores are not rewritten here either. Run `npm run backfill:scores` after
-- rolling back to replay the book under the reactivated generation.

do $$
declare
  v_added        record;
  v_from_version text;
begin
  select * into v_added
    from public.model_versions
   where model_name = 'SCOUT'
     and created_by_user_id is null
     and notes like 'Adds the partnershipHistory weight%'
   order by created_at desc
   limit 1;

  if v_added.id is null then
    raise notice 'nothing to roll back — this migration did not add a SCOUT version here';
    return;
  end if;

  -- Read which generation was retired before deleting the row that records it.
  select detail ->> 'from_version'
    into v_from_version
    from public.audit_log
   where action = 'scout_weights_changed'
     and target_table = 'model_versions'
     and target_id = v_added.id
   limit 1;

  delete from public.audit_log
   where action = 'scout_weights_changed'
     and target_table = 'model_versions'
     and target_id = v_added.id;

  delete from public.model_versions where id = v_added.id;

  update public.model_versions
     set is_active = true,
         deprecated_at = null
   where model_name = 'SCOUT'
     and version = v_from_version;

  -- No audit row to read (someone removed it, or the forward migration ran
  -- before this pairing existed): fall back to the most recently deprecated
  -- generation, which is the one that was active before.
  if not found then
    update public.model_versions
       set is_active = true,
           deprecated_at = null
     where id = (
       select id
         from public.model_versions
        where model_name = 'SCOUT' and deprecated_at is not null
        order by deprecated_at desc
        limit 1
     );
  end if;
end;
$$;
