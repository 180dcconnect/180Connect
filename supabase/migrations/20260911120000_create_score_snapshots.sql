-- Migration: create_score_snapshots
-- Sequence: addition (needs public.organisations, public.outreach_messages,
--   public.model_versions, public.audit_log, app.is_active_user, app.is_admin).
-- Story: F097 (#96) — Outcome Feedback into Score.
--
-- THE PROBLEM THIS TABLE EXISTS FOR:
--   LATEST_SCORES is a cache of the *current* score per client — upserted, one
--   row per organisation, history deliberately excluded (20260831200000). That
--   is correct for F058/F059's filtering, and fatal for F097: once an
--   organisation's inputs change (income filed, status moved, grants matched,
--   an admin reweights SCOUT via set_scout_weights), "what was true about this
--   client when we emailed them" is unrecoverable. F097 AC1 requires outcomes
--   stored "linked back to the client's scoring inputs at the time of outreach";
--   this table is that link. One row per *sent* email — including attempts that
--   end in no_response, because the negatives are half the training set.
--
-- SNAPSHOT AT SEND TIME, NOT OUTCOME TIME (PM-approved):
--   The factors are computed by the application just before the send is
--   recorded and handed to the send RPCs, which insert the row inside the SAME
--   transaction as the draft→sent flip and pipeline advance. Computing at
--   outcome-recording time would capture whatever the inputs say weeks later —
--   precisely the drift this ticket exists to defeat. previousContact therefore
--   reflects the pre-send status, which is the honest reading of "at the time
--   of outreach".
--
-- WHY FACTORS TRAVEL AS A PARAMETER RATHER THAN BEING RECOMPUTED IN SQL:
--   The scorers are TypeScript (score-client.ts and friends); porting them into
--   plpgsql would duplicate the rule engine and let the two copies drift —
--   exactly what 20260831200000's header declined to do for the same reason.
--   The RPCs accept the computed vector as jsonb and validate it hard (every
--   factor must be a number in [0,1], band in vocabulary, score in range):
--   garbage silently entering the training set is worse than no row.
--
-- NO AUDIT ROW FOR THE INSERT ITSELF: this records derived data, not an
--   ownership/status/approval change — same scope line as LATEST_SCORES
--   ("the audit-log RPC pattern does not apply"). The send itself is already
--   audited ('outreach_email_sent') in the same transaction.
--
-- LABELS ARE NOT STORED HERE: outcome labels keep landing in OUTCOMES
--   (F143/F144), joined by outreach_message_id. Training examples are the join
--   of these two tables — built out in F098, which also owns export/query UX
--   and the F246/F247 privacy-exclusion proof. No free text is copied into a
--   snapshot row: personal-data-bearing content stays referenced by message id,
--   never duplicated (storage and privacy by construction).
--
-- Schema change approval record (SOP §7):
--   Change        | Add SCORE_SNAPSHOTS table; extend mark_outreach_sent and
--               | mark_scheduled_outreach_delivered with a trailing
--               | p_score_snapshot jsonb DEFAULT NULL parameter (existing
--               | 4-argument calls remain valid and skip the insert).
--   Reason        | F097 AC1/AC3: every recorded-outcome attempt must be
--               | storable with its point-in-time feature context, usable as a
--               | labelled example later. AC2 respected: nothing here touches
--               | the live score — LATEST_SCORES is written by nobody new.
--   Compatibility | Purely additive. Both RPCs keep their old behaviour when
--               | p_score_snapshot is omitted; both production callers are
--               | updated in this PR to always pass it. No reads of the new
--               | table exist yet (F098 adds them).
--   Data migration| None, deliberately (PM-approved): already-sent emails get
--               | no snapshot. Backfilling would mean reconstructing past
--               | inputs from mutated live tables — fabricating exactly the
--               | point-in-time truth this table preserves. Training starts
--               | from launch.
--   Security      | RLS on, admin-only SELECT (weights are gameable knowledge;
--               | same rationale as MODEL_VERSIONS). Zero write grants — rows
--               | are written only inside the SECURITY DEFINER send RPCs'
--               | transactions. p_score_snapshot is validated before insert;
--               | a malformed vector raises and rolls back the whole send
--               | recordal rather than storing junk.
--   Documentation | docs/rls-permission-matrix.md Intelligence block updated
--               | in the same PR. Data Model tab 06 gains SCORE_SNAPSHOTS
--               (spreadsheet edit owned by Bashir, then npm run
--               export:data-model).
--   Approved by   | Bashir (Project Manager), 26 Aug 2026 — send-time
--               | snapshots, admin-only reads, no backfill.
--
-- Reversibility: paired rollback in ../rollback/20260911120000_create_score_snapshots.down.sql

create table public.score_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete cascade,
  -- Exactly one snapshot per sent email — the send RPCs are the only writers,
  -- and re-recording a send raises before reaching here anyway.
  outreach_message_id uuid not null unique references public.outreach_messages (id) on delete cascade,
  -- Which weights generation produced the score. Nullable only because v1's
  -- config predates id-level tracking in the reader; a missing reference is
  -- visible, not fabricated.
  model_version_id   uuid references public.model_versions (id),
  sector             double precision not null constraint score_snapshots_sector_range check (sector between 0 and 1),
  geography          double precision not null constraint score_snapshots_geography_range check (geography between 0 and 1),
  size               double precision not null constraint score_snapshots_size_range check (size between 0 and 1),
  partnership_history double precision not null constraint score_snapshots_partnership_range check (partnership_history between 0 and 1),
  previous_contact   double precision not null constraint score_snapshots_previous_contact_range check (previous_contact between 0 and 1),
  priority_score     double precision not null constraint score_snapshots_score_range check (priority_score between 0 and 1),
  priority_band      text not null constraint score_snapshots_band_check check (priority_band in ('high', 'medium', 'low')),
  -- When the inputs were read (≈ send moment), distinct from created_at.
  scored_at          timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

comment on table public.score_snapshots is
  'F097: point-in-time scoring features captured when an outreach email is '
  'actually sent — the feature half of the ML training set. Labels live in '
  'OUTCOMES joined by outreach_message_id; the training view is F098''s. '
  'Admin-only read (weights are gameable); writes happen only inside the send '
  'RPCs'' transactions.';
comment on column public.score_snapshots.model_version_id is
  'The active SCOUT MODEL_VERSIONS row whose config.weights produced '
  'priority_score. Null only when the config could not be resolved at send '
  'time — visible gap, never backfilled.';

create index score_snapshots_organisation_idx on public.score_snapshots (organisation_id);
create index score_snapshots_model_version_idx on public.score_snapshots (model_version_id);

-- ---------------------------------------------------------------------------
-- Security — REVOKE before GRANT (MIGRATIONS.md §2.1). Admin-only SELECT;
-- writes ride the definer RPCs, so no INSERT/UPDATE/DELETE grant for anyone.
-- ---------------------------------------------------------------------------
revoke all on public.score_snapshots from anon, authenticated;

alter table public.score_snapshots enable row level security;

grant select on public.score_snapshots to authenticated;

create policy score_snapshots_select_admin on public.score_snapshots
  for select to authenticated
  using (app.is_active_user() and app.is_admin());

comment on policy score_snapshots_select_admin on public.score_snapshots is
  'F097: admins only. CAM-visible scores stay LATEST_SCORES''s job; the raw '
  'feature vectors plus the weights generation behind them are gameable '
  'knowledge, exactly like MODEL_VERSIONS.';

-- ---------------------------------------------------------------------------
-- Shared validation + insert — internal, definer-called only. One body, stated
-- once, so the manual and scheduled paths cannot drift (same structure as
-- advance_outreach_pipeline_on_send).
-- ---------------------------------------------------------------------------
create function public.insert_score_snapshot(
  p_message_id uuid,
  p_organisation_id uuid,
  p_snapshot jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_factor jsonb;
  v_key    text;
  v_score  double precision;
begin
  if p_snapshot is null then
    return;  -- caller could not build one (logged app-side); send stands alone
  end if;

  -- Every factor key must be present and a real number in [0,1]. A wrong shape
  -- is a programming error — fail the recordal loudly rather than store a
  -- poisoned training row.
  foreach v_key in array array['sector', 'geography', 'size', 'partnership_history', 'previous_contact']
  loop
    v_factor := p_snapshot -> v_key;
    if v_factor is null
       or jsonb_typeof(v_factor) <> 'number'
       or (v_factor #>> '{}')::double precision is null
       or (v_factor #>> '{}')::double precision < 0
       or (v_factor #>> '{}')::double precision > 1 then
      raise exception 'score snapshot factor % must be a number between 0 and 1', v_key
        using errcode = '22023';
    end if;
  end loop;

  v_factor := p_snapshot -> 'priority_score';
  if v_factor is null
     or jsonb_typeof(v_factor) <> 'number'
     or (v_factor #>> '{}')::double precision is null
     or (v_factor #>> '{}')::double precision < 0
     or (v_factor #>> '{}')::double precision > 1 then
    raise exception 'score snapshot priority_score must be a number between 0 and 1'
      using errcode = '22023';
  end if;
  v_score := (v_factor #>> '{}')::double precision;

  if p_snapshot ->> 'priority_band' not in ('high', 'medium', 'low') then
    raise exception 'score snapshot priority_band must be high, medium or low'
      using errcode = '22023';
  end if;

  insert into public.score_snapshots (
    organisation_id,
    outreach_message_id,
    model_version_id,
    sector,
    geography,
    size,
    partnership_history,
    previous_contact,
    priority_score,
    priority_band,
    scored_at
  )
  select
    p_organisation_id,
    p_message_id,
    (p_snapshot ->> 'model_version_id')::uuid,
    ((p_snapshot -> 'sector') #>> '{}')::double precision,
    ((p_snapshot -> 'geography') #>> '{}')::double precision,
    ((p_snapshot -> 'size') #>> '{}')::double precision,
    ((p_snapshot -> 'partnership_history') #>> '{}')::double precision,
    ((p_snapshot -> 'previous_contact') #>> '{}')::double precision,
    v_score,
    p_snapshot ->> 'priority_band',
    coalesce((p_snapshot ->> 'scored_at')::timestamptz, now());
end;
$$;

comment on function public.insert_score_snapshot(uuid, uuid, jsonb) is
  'F097 internal: validates a send-time scoring vector (all five factors '
  'numeric in [0,1], score ranged, band in vocabulary) and inserts the '
  'SCORE_SNAPSHOTS row inside the caller''s transaction. Null snapshot = no-op '
  '(caller failed to build one; logged app-side). Called only by '
  'mark_outreach_sent and mark_scheduled_outreach_delivered; EXECUTE revoked '
  'from every role.';

revoke all on function public.insert_score_snapshot(uuid, uuid, jsonb) from public;
revoke all on function public.insert_score_snapshot(uuid, uuid, jsonb) from anon;
revoke all on function public.insert_score_snapshot(uuid, uuid, jsonb) from authenticated;
revoke all on function public.insert_score_snapshot(uuid, uuid, jsonb) from service_role;

-- ---------------------------------------------------------------------------
-- mark_outreach_sent(v4) — same behaviour as v3, plus the optional score
-- snapshot in the same transaction
-- ---------------------------------------------------------------------------
drop function public.mark_outreach_sent(uuid, text, text, text);

create function public.mark_outreach_sent(
  p_message_id uuid,
  p_provider_message_id text,
  p_provider_thread_id text,
  p_recipient_email text,
  p_score_snapshot jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := (select auth.uid());
  v_message record;
  v_sent    uuid;
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  -- Locked on BOTH rows: the message so the draft→sent flip stays race-free as
  -- before, the organisation so the pipeline advance below cannot interleave
  -- with another send's advance.
  select m.id,
         m.sent_by_user_id,
         m.organisation_id,
         o.owner_id as org_owner_id,
         m.send_status
    into v_message
    from public.outreach_messages m
    join public.organisations o on o.id = m.organisation_id
   where m.id = p_message_id
     for update of m, o;

  if v_message.id is null then
    raise exception 'that draft could not be found'
      using errcode = 'P0002';
  end if;

  if not (
    app.is_admin()
    or v_message.org_owner_id = v_actor
    or v_message.sent_by_user_id = v_actor
  ) then
    raise exception 'only the client''s owner or an admin may record this send'
      using errcode = '42501';
  end if;

  -- Conditional on still being a draft: a second invocation raises instead of
  -- recording a second sent state. The pipeline advance and snapshot below only
  -- run on the winning invocation.
  update public.outreach_messages
     set send_status = 'sent',
         sent_at     = now(),
         scheduled_at = null,
         sent_to_email = p_recipient_email
   where id = v_message.id
     and send_status = 'draft'
  returning id into v_sent;

  if v_sent is null then
    raise exception 'this email has already been recorded as sent'
      using errcode = 'P0002';
  end if;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor, 'outreach_email_sent', 'outreach_messages', v_sent,
    jsonb_build_object(
      'organisation_id', v_message.organisation_id,
      'provider', 'gmail',
      'provider_message_id', p_provider_message_id,
      'provider_thread_id', p_provider_thread_id,
      'sent_to', p_recipient_email
    )
  );

  -- F157 AC3: status move and recordal share one transaction.
  perform public.advance_outreach_pipeline_on_send(v_message.organisation_id, v_actor);

  -- F097 AC1: the feature context captured before this send lands beside it —
  -- one transaction, so a rolled-back recordal never leaves an orphan snapshot
  -- and a stored send never lacks its vector when the caller built one.
  perform public.insert_score_snapshot(p_message_id, v_message.organisation_id, p_score_snapshot);

  return v_sent;
end;
$$;

comment on function public.mark_outreach_sent(uuid, text, text, text, jsonb) is
  'F123/F116/F157/F097: records a delivered outreach email — conditional '
  'draft→sent flip, audited recipient + pipeline advance, and (when '
  'p_score_snapshot is provided) the client''s point-in-time scoring vector, '
  'ALL in one transaction. A malformed snapshot raises and rolls the whole '
  'recordal back; a null one skips silently. Raises if already recorded as '
  'sent.';

revoke execute on function public.mark_outreach_sent(uuid, text, text, text, jsonb) from public;
revoke execute on function public.mark_outreach_sent(uuid, text, text, text, jsonb) from anon;
grant execute on function public.mark_outreach_sent(uuid, text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- mark_scheduled_outreach_delivered — same behaviour, plus the optional score
-- snapshot
-- ---------------------------------------------------------------------------
drop function public.mark_scheduled_outreach_delivered(uuid, text, text, timestamptz);

create function public.mark_scheduled_outreach_delivered(
  p_message_id uuid,
  p_provider_message_id text,
  p_provider_thread_id text,
  p_claim_token timestamptz,
  p_score_snapshot jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  -- Definer bypasses RLS, so authorise explicitly: service_role worker only.
  if (select auth.uid()) is not null then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select m.id, m.organisation_id
    into v_row
    from public.outreach_messages m
    join public.organisations o on o.id = m.organisation_id
   where m.id = p_message_id
     for update of m, o;

  if v_row.id is null then
    return false;
  end if;

  -- Pinned to OUR claim token: raced-away messages are never recorded here.
  update public.outreach_messages
     set send_status = 'sent',
         sent_at = now(),
         scheduled_at = null,
         send_claimed_at = null
   where id = p_message_id
     and send_status = 'scheduled'
     and send_claimed_at = p_claim_token
  returning id into v_row.id;

  if v_row.id is null then
    return false;
  end if;

  insert into public.send_events (
    outreach_message_id, event_type, occurred_at, metadata
  ) values (
    p_message_id, 'sent', now(),
    jsonb_build_object(
      'provider', 'gmail',
      'message_id', p_provider_message_id,
      'thread_id', p_provider_thread_id,
      'scheduled', true
    )
  );

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    null,
    'outreach_email_sent',
    'outreach_messages',
    p_message_id,
    jsonb_build_object(
      'organisation_id', v_row.organisation_id,
      'provider', 'gmail',
      'provider_message_id', p_provider_message_id,
      'provider_thread_id', p_provider_thread_id,
      'scheduled', true
    )
  );

  perform public.advance_outreach_pipeline_on_send(v_row.organisation_id, null);

  perform public.insert_score_snapshot(p_message_id, v_row.organisation_id, p_score_snapshot);

  return true;
end;
$$;

comment on function public.mark_scheduled_outreach_delivered(uuid, text, text, timestamptz, jsonb) is
  'F126/F129/F157/F097: service_role-only scheduled→sent transition for the '
  'cron worker — claim-pinned flip, SEND_EVENTS ''sent'' row, audit entry, '
  'pipeline advance, and (when provided) the point-in-time scoring vector, ALL '
  'in one transaction. False means the message was raced away: reported '
  'ambiguous by the caller, never retried.';

revoke execute on function public.mark_scheduled_outreach_delivered(uuid, text, text, timestamptz, jsonb) from public;
revoke execute on function public.mark_scheduled_outreach_delivered(uuid, text, text, timestamptz, jsonb) from anon;
revoke execute on function public.mark_scheduled_outreach_delivered(uuid, text, text, timestamptz, jsonb) from authenticated;
grant execute on function public.mark_scheduled_outreach_delivered(uuid, text, text, timestamptz, jsonb) to service_role;
