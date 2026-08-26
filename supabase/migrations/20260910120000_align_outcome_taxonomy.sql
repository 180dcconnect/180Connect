-- Migration: align_outcome_taxonomy
-- Sequence: addition (needs public.outcomes, public.outreach_messages,
--   public.organisations, public.audit_log, public.app helpers; stacks directly
--   on record_conversion_outcome (#501), whose current-state conversion model
--   this generalises).
-- Stories: F144 (#139) Track Email Outcome. Feeds F206/F207 analytics,
--   F097 outcome feedback into score, and F098's future training dataset.
--
-- THE TAXONOMY (signed off by the PM, 26 Aug 2026)
--
-- OUTCOMES.OUTCOME_TYPE is now exactly what issue #139 defines — one outcome
-- set for every completed outreach attempt:
--
--     reply        they answered us            (pipeline status 'responded')
--     converted    they signed as a project    (pipeline status 'converted')
--     no_response  silence after outreach      (pipeline status 'no_response')
--     soft_no      not now                     (pipeline status 'soft_no')
--     hard_no      never                       (pipeline status 'hard_no')
--
-- The old value set ('converted', 'no_response', 'rejected', 'follow_up',
-- 'referral') predates the F146-F155 pipeline statuses and never matched them.
-- Nothing outside the status RPCs reads OUTCOMES in app code yet, so the
-- realignment breaks nothing today.
--
-- CURRENT-STATE TRACKING, UNIFIED ACROSS ALL FIVE (PM, 26 Aug 2026)
--
-- #501 made OUTCOMES track *currently*-converted clients: landing on
-- 'converted' writes the row, leaving it deletes the row again, audited. The
-- PM has confirmed that model generalises to all five outcomes: OUTCOMES
-- mirrors each client's current terminal state. Landing on any terminal
-- status writes its row; leaving it — to another terminal status or back to a
-- non-terminal one — withdraws it. Every withdrawal is audited as
-- 'outcome_deleted' (this supersedes #501's 'conversion_outcome_deleted'
-- token, which nothing consumes yet), keeping who, when, which type, so
-- history survives in the trail even though the table holds only the present.
-- Statuses that are not outcomes (not_contacted, initial_outreach_sent,
-- follow_up_sent, future_potential, loss_due_timing) record nothing: an
-- attempt that has not resolved stays unresolved rather than being forced
-- into a final category (F144 AC2). Labels update automatically with the
-- status they mirror — there is no separate tagging step (F144 AC1/AC3).
--
-- ALL THREE STATUS WRITERS maintain the mirror: the two status RPCs below and
-- #503's advance_outreach_pipeline_on_send (the automatic advance on send),
-- which is replaced at the foot of this migration with a version that
-- withdraws the outcome row when a send pulls a client off a terminal status.
--
-- THE ENUM REBUILD
--
-- Postgres cannot drop enum values, so the type is rebuilt under the same
-- name: rename the old type, create the new value set, cast the column across
-- with an explicit mapping of any legacy rows, drop the old type. Expected
-- row count with legacy values is zero; the mapping exists so staging cannot
-- surprise us into a failed push.
--
-- GOTCHA THAT SHAPES THE ORDER: #501's partial index predicate compares the
-- column against an enum literal. Once the old type is renamed, that literal
-- resolves to the NEW enum while the column still holds the old one, and
-- ALTER TYPE's index rebuild cannot resolve the equality at all. The index is
-- therefore dropped BEFORE the rename.
--
-- DIRECT END-USER WRITES ARE WITHDRAWN ENTIRELY
--
-- #501 already barred CAMs from hand-writing 'converted'. With all five
-- values system-managed, the remaining CAM insert/update policies would be
-- dead letters that only permit desyncing OUTCOMES from the pipeline they
-- mirror — so they are dropped outright. Admins retain their correction paths
-- (outcomes_insert_admin / outcomes_update_admin / outcomes_delete_admin).
--
-- Schema change approval record (SOP §7):
--   Change        | Rebuild OUTCOME_TYPE enum to the five issue-defined values;
--                 | replace the conversion-only partial index with unique
--                 | (organisation_id, outcome_type); both status RPCs now
--                 | maintain the outcome mirror for all five terminal statuses
--                 | (write on entry, audited delete on leave); direct end-user
--                 | outcome writes withdrawn; backfill extended to clients on
--                 | any terminal status.
--   Reason        | F144 Track Email Outcome — every attempt labelled with
--                 | exactly one outcome from the defined set, updating
--                 | automatically with the pipeline status.
--   Compatibility | Superset of #501's behaviour ('converted' unchanged apart
--                 | from the audit token). The unique index now caps one row
--                 | per client per type across all writers; admin correction
--                 | inserts of a second row for the same client/type will
--                 | conflict rather than silently duplicate.
--   Data migration| Legacy-value remap: rejected -> hard_no, follow_up/referral
--                 | -> reply (expected to affect zero rows). Backfill extended
--                 | to all terminal statuses (idempotent).
--   Security      | No new grants or RPCs; no new table policies — two CAM
--                 | policies are dropped, narrowing write access. Inserts and
--                 | withdrawals run inside the existing SECURITY DEFINER RPCs,
--                 | permission checking unchanged.
--   Documentation | Function comments updated here. Data Model tab 07's
--                 | OUTCOMES.OUTCOME_TYPE row must be updated in the spreadsheet
--                 | by the PM, then docs regenerated via npm run export:data-model
--                 | (generated files are not hand-edited). Approved by Bashir
--                 | (PM), 26 Aug 2026.
--
-- Reversibility: paired rollback in ../rollback/20260910120000_align_outcome_taxonomy.down.sql
--   Best-effort only, and documented as such there: the old taxonomy had no
--   value meaning "they replied", so rows recorded under the new set cannot be
--   faithfully translated back.

-- ---------------------------------------------------------------------------
-- Enum rebuild
-- ---------------------------------------------------------------------------

-- Dropped BEFORE the rename, deliberately: its predicate compares the column
-- against an enum literal, and once the old type is renamed the literal would
-- resolve to the NEW enum while the column still holds the old one — the index
-- rebuild inside ALTER TYPE would fail to resolve the equality at all.
drop index if exists public.outcomes_one_conversion_per_client;

-- Dropped BEFORE the retype for the same class of reason: #501's CAM policies
-- reference the column in WITH CHECK / USING, and Postgres refuses to alter a
-- column a policy depends on. They are withdrawn anyway (see below) — doing it
-- here keeps one causal order: dependencies first, then the rebuild.
drop policy if exists outcomes_insert_cam on public.outcomes;
drop policy if exists outcomes_update_own on public.outcomes;

alter type public.outcome_type rename to outcome_type_superseded;

create type public.outcome_type as enum
  ('reply', 'converted', 'no_response', 'soft_no', 'hard_no');

comment on type public.outcome_type is
  'The five outcomes a completed outreach attempt can resolve to, per F144 '
  '(#139): reply, converted, no_response, soft_no, hard_no. Tokens deliberately '
  'match the F146-F155 pipeline statuses that produce them, except responded '
  '-> reply. Every value is system-managed: written and withdrawn only by '
  'set_outreach_status / set_outreach_status_bulk.';

alter table public.outcomes alter column outcome_type drop default;

alter table public.outcomes
  alter column outcome_type type public.outcome_type
  using (
    case outcome_type::text
      -- Survivors keep their label AND their attribution: these rows are live
      -- #501 data (backfill plus real conversions), not hypotheticals.
      when 'converted'   then 'converted'
      when 'no_response' then 'no_response'
      when 'rejected'    then 'hard_no'
      -- follow_up and referral predate the taxonomy decision; both meant
      -- "engagement happened via a reply" closely enough to land there.
      else 'reply'
    end
  )::public.outcome_type;

drop type public.outcome_type_superseded;

comment on column public.outcomes.outcome_type is
  'Which of the five F144 outcomes this row records. Mirrors the client''s '
  'current terminal pipeline status (responded writes reply): written on entry, '
  'deleted on leave, never by a separate manual tagging step.';

-- ---------------------------------------------------------------------------
-- One row per client per outcome type
-- ---------------------------------------------------------------------------

-- Defensive dedup ahead of the unique index: pre-F157-tightening policies let
-- a CAM hand-log unlimited rows of the same type for the same client. Expected
-- count is zero; if staging surprises us, keep each (client, type)'s newest row
-- rather than aborting the whole migration on index creation.
with ranked as (
  select id,
         row_number() over (partition by organisation_id, outcome_type
                            order by created_at desc, id desc) as recency
    from public.outcomes
)
delete from public.outcomes o
 using ranked r
 where o.id = r.id
   and r.recency > 1;

create unique index outcomes_one_outcome_per_type
  on public.outcomes (organisation_id, outcome_type);

comment on index public.outcomes_one_outcome_per_type is
  'F144: OUTCOMES mirrors current state, so a client holds at most one row per '
  'type. The RPCs keep it true by deleting on leave; this index makes it hold '
  'against every writer, including admin corrections.';

comment on table public.outcomes is
  'Ground truth for scoring and analytics: how each client''s engagement '
  'actually went, right now (Data Model tab 07). One row per client per outcome '
  'type, maintained by set_outreach_status / set_outreach_status_bulk as a '
  'mirror of the client''s terminal pipeline status — attributed to the most '
  'recent sent email, deleted (audited) when the status moves on. History lives '
  'in the audit trail, not here.';

-- ---------------------------------------------------------------------------
-- set_outreach_status — single change maintains the mirror for all five
-- ---------------------------------------------------------------------------

create or replace function public.set_outreach_status(
  p_organisation_id uuid,
  p_new_status public.outreach_status
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid := (select auth.uid());
  v_org          record;
  v_old_terminal boolean;
  v_new_terminal boolean;
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  select o.id, o.owner_id, o.outreach_status into v_org
    from public.organisations o
   where o.id = p_organisation_id
     for update;

  if v_org.id is null then
    raise exception 'that client could not be found'
      using errcode = 'P0002';
  end if;

  -- Permission restriction (F145 testing notes): the CAM who owns this client, or
  -- an admin. A CAM who does not yet own the client claims it first
  -- (claim_organisation) rather than setting its status.
  if not (app.is_admin() or v_org.owner_id = v_actor) then
    raise exception 'only the client''s owner or an admin may change its status'
      using errcode = '42501';
  end if;

  -- No-op changes are not audited — the trail records real transitions only,
  -- same convention as set_user_role / claim_organisation.
  if v_org.outreach_status = p_new_status then
    return v_org.id;
  end if;

  update public.organisations
     set outreach_status = p_new_status
   where id = v_org.id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor, 'status_changed', 'organisations', v_org.id,
    jsonb_build_object('from', v_org.outreach_status, 'to', p_new_status)
  );

  -- F144: the five terminal tokens are the outcome taxonomy, so the status
  -- change a CAM already performs maintains the OUTCOMES mirror — no separate
  -- tagging step. Entering a terminal status records its outcome; leaving one
  -- withdraws whatever row mirrored the previous state; terminal -> terminal
  -- does both. Withdrawals are audited ('outcome_deleted'), so nothing is
  -- silently lost. Non-terminal statuses on both sides record nothing:
  -- unresolved stays unresolved (AC2).
  --
  -- The case expression is the whole status->outcome mapping: every terminal
  -- token names its outcome except 'responded', which lands as 'reply'.
  v_old_terminal := v_org.outreach_status::text
                      in ('converted', 'responded', 'no_response', 'soft_no', 'hard_no');
  v_new_terminal := p_new_status::text
                      in ('converted', 'responded', 'no_response', 'soft_no', 'hard_no');

  if v_old_terminal or v_new_terminal then
    -- A scalar subquery, not a join, for the attribution: a client never
    -- emailed must still get its outcome row, carrying a null
    -- outreach_message_id rather than no row at all.
    with gone as (
      delete from public.outcomes
       where organisation_id = v_org.id
      returning id, outcome_type
    )
    insert into public.audit_log
      (actor_user_id, action, target_table, target_id, detail)
    select
      v_actor,
      'outcome_deleted',
      'outcomes',
      gone.id,
      jsonb_build_object('organisation_id', v_org.id, 'outcome_type', gone.outcome_type)
      from gone;

    if v_new_terminal then
      insert into public.outcomes
        (organisation_id, outreach_message_id, outcome_type, recorded_by_user_id)
      values (
        v_org.id,
        (
          select om.id
            from public.outreach_messages om
           where om.organisation_id = v_org.id
             and om.sent_at is not null
           order by om.sent_at desc
           limit 1
        ),
        (case when p_new_status = 'responded' then 'reply' else p_new_status::text end)::public.outcome_type,
        v_actor
      )
      on conflict do nothing;
    end if;
  end if;

  return v_org.id;
end;
$$;

comment on function public.set_outreach_status(uuid, public.outreach_status) is
  'F145: the client''s owner (CAM) or an admin sets its pipeline status to any of the '
  'ten F146-F155 values. SECURITY DEFINER so the write and its audit_log row commit '
  'in one transaction; direct UPDATE on organisations.outreach_status is revoked from '
  'authenticated, so this is the only ordinary write path. No-op (same status) is not '
  'an error and is not audited. F143/F144: OUTCOMES mirrors the client''s terminal '
  'state — entering a terminal status records its outcome (reply / converted / '
  'no_response / soft_no / hard_no), linked to the most recent sent email; leaving '
  'one deletes that row with an ''outcome_deleted'' audit entry. A reason-required '
  'admin override is a separate, future RPC (override_outreach_status, F224) — this '
  'one is unconditional within permission.';

-- ---------------------------------------------------------------------------
-- set_outreach_status_bulk — batch changes maintain the mirror too
-- ---------------------------------------------------------------------------

create or replace function public.set_outreach_status_bulk(
  p_organisation_ids uuid[],
  p_new_status public.outreach_status
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor     uuid := (select auth.uid());
  v_ids       uuid[];
  v_requested int;
  v_found     int;
  v_denied    int;
  v_changed   int;
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  -- Duplicates and nulls are the caller's problem to not send, but they are also
  -- harmless to absorb: deduping here means the count reported back matches the
  -- number of distinct clients affected, which is the number AC2's confirmation
  -- step showed the CAM.
  select coalesce(array_agg(distinct candidate), '{}'::uuid[])
    into v_ids
    from unnest(coalesce(p_organisation_ids, '{}'::uuid[])) as candidate
   where candidate is not null;

  v_requested := coalesce(array_length(v_ids, 1), 0);

  -- F064 testing notes: "zero selected records". An empty selection is a mistake,
  -- not a no-op to swallow silently — the CAM pressed apply expecting something.
  if v_requested = 0 then
    raise exception 'select at least one client before changing status'
      using errcode = '22023';
  end if;

  if v_requested > 500 then
    raise exception 'a bulk status change covers at most 500 clients at once'
      using errcode = '22023';
  end if;

  -- Lock every target row up front, ordered by id. The order is what stops two
  -- concurrent bulk updates over overlapping selections from deadlocking by
  -- taking the same rows in opposite orders; the lock itself is what makes the
  -- permission check below and the write beneath it describe the same rows.
  select count(*)
    into v_found
    from (
      select o.id
        from public.organisations o
       where o.id = any(v_ids)
       order by o.id
         for update
    ) locked;

  if v_found <> v_requested then
    raise exception 'one or more of those clients could not be found'
      using errcode = 'P0002';
  end if;

  -- Same rule as set_outreach_status, applied to the whole batch: owner or admin.
  -- Reported as a count, never as a list of names — the caller already knows
  -- which clients it selected, and naming rows back at a request that was
  -- refused would hand a crafted call a way to probe ownership.
  if not app.is_admin() then
    select count(*)
      into v_denied
      from public.organisations o
     where o.id = any(v_ids)
       and o.owner_id is distinct from v_actor;

    if v_denied > 0 then
      raise exception 'you can only change the status of clients you own (% of % selected are not yours)',
        v_denied, v_requested
        using errcode = '42501';
    end if;
  end if;

  -- One statement, so the audit rows are written from the same snapshot the
  -- update reads: `snapshot` sees pre-update values even though `updated` runs in
  -- the same statement, which is how `from` stays the status the client was
  -- actually on. Rows already on the target status never enter `snapshot`, so
  -- they are neither written nor audited.
  --
  -- F144: `recorded` and `withdrawn` run off that same snapshot and maintain
  -- the OUTCOMES mirror for exactly the rows that really moved. Their row
  -- sets can never collide: a withdrawn row carries the OLD status's outcome
  -- type, a recorded row the NEW status's, and snapshot guarantees those
  -- differ — so the sibling CTEs cannot fight over the same unique key.
  with snapshot as (
    select o.id, o.outreach_status as from_status
      from public.organisations o
     where o.id = any(v_ids)
       and o.outreach_status is distinct from p_new_status
  ),
  updated as (
    update public.organisations o
       set outreach_status = p_new_status
      from snapshot s
     where o.id = s.id
    returning o.id
  ),
  audited as (
    insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
    select
      v_actor,
      'status_changed',
      'organisations',
      s.id,
      jsonb_build_object(
        'from', s.from_status,
        'to', p_new_status,
        -- Marks the row as part of a batch without inventing a second action
        -- token: 'trigger' is the existing key for "what caused this", already
        -- carrying 'self_claim' and 'bulk_assign' elsewhere in the trail.
        'trigger', 'bulk_update',
        'batch_size', v_requested
      )
      from snapshot s
    returning 1
  ),
  recorded as (
    insert into public.outcomes
      (organisation_id, outreach_message_id, outcome_type, recorded_by_user_id)
    select s.id,
           latest_message.id,
           (case when p_new_status = 'responded' then 'reply' else p_new_status::text end)::public.outcome_type,
           v_actor
      from snapshot s
           left join lateral (
             select om.id
               from public.outreach_messages om
              where om.organisation_id = s.id
                and om.sent_at is not null
              order by om.sent_at desc
              limit 1
           ) latest_message on true
     where p_new_status::text in ('converted', 'responded', 'no_response', 'soft_no', 'hard_no')
    on conflict do nothing
    returning 1
  ),
  withdrawn as (
    delete from public.outcomes o
     using snapshot s
     where o.organisation_id = s.id
       and (s.from_status::text in ('converted', 'responded', 'no_response', 'soft_no', 'hard_no')
            or p_new_status::text in ('converted', 'responded', 'no_response', 'soft_no', 'hard_no'))
    returning o.id, o.organisation_id, o.outcome_type
  ),
  withdrawal_audited as (
    insert into public.audit_log
      (actor_user_id, action, target_table, target_id, detail)
    select
      v_actor,
      'outcome_deleted',
      'outcomes',
      w.id,
      jsonb_build_object('organisation_id', w.organisation_id, 'outcome_type', w.outcome_type)
      from withdrawn w
    returning 1
  )
  select count(*) into v_changed from updated;

  return jsonb_build_object(
    'requested', v_requested,
    'changed', v_changed,
    'unchanged', v_requested - v_changed
  );
end;
$$;

comment on function public.set_outreach_status_bulk(uuid[], public.outreach_status) is
  'Same permission rule as F145''s set_outreach_status (the client''s owner or an '
  'admin), applied to a whole batch of up to 500 in one atomic statement. F143/F144: '
  'OUTCOMES mirrors each client''s terminal state — rows moved onto a terminal status '
  'record its outcome, linked to the most recent sent email; rows moved off one have '
  'theirs deleted (audited as ''outcome_deleted'').';

-- ---------------------------------------------------------------------------
-- Direct end-user writes are withdrawn entirely
-- ---------------------------------------------------------------------------
--
-- #501 barred CAMs from hand-writing 'converted'. With every value in the
-- taxonomy system-managed — each one is just a terminal pipeline status seen
-- from the analytics side — the remaining CAM policies would permit exactly
-- the desync AC3 forbids: an outcome label disconnected from the status it is
-- supposed to mirror. Both were already dropped above, ahead of the column
-- retype that their WITH CHECK / USING clauses would have blocked; admins keep
-- their correction paths (outcomes_insert_admin / outcomes_update_admin /
-- outcomes_delete_admin), which now also serve as the escape hatch for
-- genuine mistakes.

-- ---------------------------------------------------------------------------
-- Backfill — terminal states that predate tracking
-- ---------------------------------------------------------------------------

-- Extended from #501's converted-only backfill: the mirror must cover every
-- client currently sitting on a terminal status, whichever one it is.
insert into public.outcomes
  (organisation_id, outreach_message_id, outcome_type, recorded_by_user_id)
select o.id,
       latest_message.id,
       (case when o.outreach_status = 'responded' then 'reply' else o.outreach_status::text end)::public.outcome_type,
       o.owner_id
  from public.organisations o
       left join lateral (
         select om.id
           from public.outreach_messages om
          where om.organisation_id = o.id
            and om.sent_at is not null
          order by om.sent_at desc
          limit 1
       ) latest_message on true
 where o.outreach_status::text in ('converted', 'responded', 'no_response', 'soft_no', 'hard_no')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- advance_outreach_pipeline_on_send — the third status writer joins the mirror
-- ---------------------------------------------------------------------------

-- #503 (F157, 20260909090000) added a third writer of
-- organisations.outreach_status: an automatic advance on send
-- (not_contacted -> initial_outreach_sent; anything else -> follow_up_sent),
-- fired from the send path. Without mirror maintenance here, a client sitting
-- on responded / no_response / soft_no / converted who receives another email
-- would move to follow_up_sent with its outcome row still standing — exactly
-- the stale-label desync AC3 forbids. This replacement keeps #503's behaviour
-- byte-for-byte and adds the same withdrawal set_outreach_status performs:
-- leaving a terminal status deletes that client's outcome row, audited.
-- v_next is never terminal, so no write branch is needed on the way in.

create or replace function public.advance_outreach_pipeline_on_send(
  p_organisation_id uuid,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.outreach_status;
  v_next    public.outreach_status;
begin
  -- Lock the row: serializes two near-simultaneous sends so the second sees
  -- the first's committed status and lands on follow_up_sent, never a second
  -- 'initial'.
  select o.outreach_status into v_current
    from public.organisations o
   where o.id = p_organisation_id
     for update;

  if v_current is null then
    -- The message's organisation vanished mid-transaction; there is nothing to
    -- advance and nothing to audit. The caller's own flip already succeeded.
    return;
  end if;

  -- F147 AC1/AC2: the very first send leaves not_contacted; any later send
  -- reads follow_up_sent, whatever the client currently says.
  v_next := case when v_current = 'not_contacted'
                 then 'initial_outreach_sent'::public.outreach_status
                 else 'follow_up_sent'::public.outreach_status end;

  if v_current = v_next then
    return;  -- same-status no-op is not audited (audit-log-pattern.md §5)
  end if;

  update public.organisations
     set outreach_status = v_next
   where id = p_organisation_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    p_actor, 'status_changed', 'organisations', p_organisation_id,
    jsonb_build_object('from', v_current, 'to', v_next)
  );

  -- F144: the send pulled the client off a terminal status — withdraw the
  -- OUTCOMES row that mirrored it, audited exactly as in set_outreach_status.
  if v_current::text in ('converted', 'responded', 'no_response', 'soft_no', 'hard_no') then
    with gone as (
      delete from public.outcomes
       where organisation_id = p_organisation_id
      returning id, outcome_type
    )
    insert into public.audit_log
      (actor_user_id, action, target_table, target_id, detail)
    select
      p_actor,
      'outcome_deleted',
      'outcomes',
      gone.id,
      jsonb_build_object('organisation_id', p_organisation_id, 'outcome_type', gone.outcome_type)
      from gone;
  end if;
end;
$$;

comment on function public.advance_outreach_pipeline_on_send(uuid, uuid) is
  '#503/F147: automatic pipeline advance on send — not_contacted moves to '
  'initial_outreach_sent, everything else to follow_up_sent. SECURITY DEFINER, '
  'service-role caller. F144: moving off a terminal status additionally '
  'withdraws the client''s OUTCOMES row (audited ''outcome_deleted''), keeping '
  'the outcome mirror aligned across all three status writers.';
