-- Outcome mirror trigger tests.
-- Spec: 20261003170000_outcome_mirror_trigger.sql. OUTCOMES must equal each
-- client's terminal pipeline status no matter what wrote the status — the
-- system writers (reply detection, no-response sweep) and a raw update, not
-- only the set_outreach_status RPCs (those are conversion_outcome's territory).
-- Run by `supabase test db` (pg_prove).
--
-- The triggers are deferred to commit and every suite here rolls back, so each
-- check forces them with `set constraints ... immediate` first.
--
-- Everything runs inside one transaction and is rolled back; fixtures never persist.

begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

create schema if not exists tests;

create or replace function tests.fire_outcome_mirror()
returns void language plpgsql as $$
begin
  set constraints public.organisations_outcome_mirror_on_insert,
                  public.organisations_outcome_mirror_on_update immediate;
  set constraints public.organisations_outcome_mirror_on_insert,
                  public.organisations_outcome_mirror_on_update deferred;
end;
$$;

create or replace function tests.outcome_types_of(p_org uuid)
returns text[] language sql as $$
  select coalesce(array_agg(outcome_type::text order by outcome_type::text), '{}')
    from public.outcomes
   where organisation_id = p_org;
$$;

create or replace function tests.suite_outcome_mirror()
returns setof text language plpgsql as $$
declare
  v_owner    uuid := '00000000-0000-4000-a000-000000000201';
  v_raw      uuid := '00000000-0000-4000-c000-000000000201';
  v_swept    uuid := '00000000-0000-4000-c000-000000000202';
  v_replied  uuid := '00000000-0000-4000-c000-000000000203';
  v_seeded   uuid := '00000000-0000-4000-c000-000000000204';
  v_message  uuid := '00000000-0000-4000-b000-000000000201';
  v_withdrawn_audits bigint;
begin
  -- Lets the file merge ahead of its migration, same convention as the other suites.
  if to_regprocedure('public.organisations_outcome_mirror()') is null then
    return next skip(1, 'outcome mirror trigger not yet migrated');
    return;
  end if;

  insert into auth.users (id, instance_id, aud, role, email)
  values (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mirror-cam@180dc.org')
  on conflict (id) do nothing;
  insert into public.users (id, email, full_name, role, is_active)
  values (v_owner, 'mirror-cam@180dc.org', 'Mirror CAM', 'cam', true)
  on conflict (id) do nothing;

  insert into public.organisations (id, legal_name, entry_method, organisation_type, owner_id, outreach_status)
  values
    (v_raw,     'Raw Update Client', 'manual', 'other', v_owner, 'not_contacted'),
    (v_swept,   'Swept Client',      'manual', 'other', v_owner, 'follow_up_sent'),
    (v_replied, 'Replied Client',    'manual', 'other', v_owner, 'initial_outreach_sent');

  insert into public.outreach_messages (id, organisation_id, subject, body, send_status, sent_at)
  values (v_message, v_raw, 'Hello', 'hello', 'sent', now() - interval '3 days');

  -- A raw status write that skips every RPC still records the outcome,
  -- attributed to the latest sent email.
  update public.organisations set outreach_status = 'converted' where id = v_raw;
  perform tests.fire_outcome_mirror();
  return next is(tests.outcome_types_of(v_raw), array['converted'],
    'a direct update to converted records a converted outcome');
  return next is(
    (select outreach_message_id from public.outcomes where organisation_id = v_raw),
    v_message,
    'the recorded outcome is attributed to the latest sent email');

  -- Moving it off a terminal status withdraws the row, audited.
  update public.organisations set outreach_status = 'follow_up_sent' where id = v_raw;
  perform tests.fire_outcome_mirror();
  return next is(tests.outcome_types_of(v_raw), '{}'::text[],
    'leaving a terminal status withdraws its outcome');
  select count(*) into v_withdrawn_audits
    from public.audit_log
   where action = 'outcome_deleted'
     and detail ->> 'organisation_id' = v_raw::text;
  return next is(v_withdrawn_audits, 1::bigint, 'the withdrawal is audited');

  -- Terminal -> terminal swaps the row rather than keeping both.
  update public.organisations set outreach_status = 'soft_no' where id = v_raw;
  perform tests.fire_outcome_mirror();
  update public.organisations set outreach_status = 'hard_no' where id = v_raw;
  perform tests.fire_outcome_mirror();
  return next is(tests.outcome_types_of(v_raw), array['hard_no'],
    'terminal to terminal leaves only the new outcome');

  -- The no-response sweep's writer never touched OUTCOMES before this trigger.
  perform public.mark_organisation_no_response(v_swept);
  perform tests.fire_outcome_mirror();
  return next is(tests.outcome_types_of(v_swept), array['no_response'],
    'the no-response sweep records a no_response outcome');

  -- Reply detection's writer: responded lands as 'reply'.
  update public.organisations set outreach_status = 'responded' where id = v_replied;
  perform tests.fire_outcome_mirror();
  return next is(tests.outcome_types_of(v_replied), array['reply'],
    'responded records a reply outcome');

  -- A seeded client inserted already terminal gets its row too.
  insert into public.organisations (id, legal_name, entry_method, organisation_type, owner_id, outreach_status)
  values (v_seeded, 'Seeded Converted', 'manual', 'other', v_owner, 'converted');
  perform tests.fire_outcome_mirror();
  return next is(tests.outcome_types_of(v_seeded), array['converted'],
    'inserting a client already converted records its outcome');

  -- Firing again with nothing changed is a no-op: one row, no new audit entry.
  update public.organisations set legal_name = 'Seeded Converted (renamed)' where id = v_seeded;
  perform tests.fire_outcome_mirror();
  return next is(
    (select count(*) from public.outcomes where organisation_id = v_seeded),
    1::bigint,
    'an unrelated update does not duplicate the outcome');
end;
$$;

select * from tests.suite_outcome_mirror();

select * from finish();

rollback;
