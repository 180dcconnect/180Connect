-- F139: store the elapsed seconds from each sent outreach attempt to its first reply.
alter table public.reply_events
  add column response_time_seconds bigint;

alter table public.reply_events
  add constraint reply_events_response_time_nonnegative
  check (response_time_seconds is null or response_time_seconds >= 0);

-- One stored metric per outreach attempt. Later back-and-forth replies remain events,
-- but do not distort the first-response metric or its averages.
create unique index reply_events_one_response_time_per_attempt_idx
  on public.reply_events (outreach_message_id)
  where response_time_seconds is not null;

create function app.set_reply_response_time()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sent_at timestamptz;
  v_current_first_id uuid;
  v_current_first_received_at timestamptz;
begin
  new.response_time_seconds := null;
  if new.outreach_message_id is null then
    return new;
  end if;

  -- Different Gmail messages can be processed concurrently for one outreach.
  perform pg_advisory_xact_lock(hashtextextended(new.outreach_message_id::text, 139));

  select sent_at
    into v_sent_at
    from public.outreach_messages
   where id = new.outreach_message_id
     and send_status = 'sent';

  -- Preserve the reply even if legacy send tracking is incomplete. The null metric
  -- remains visibly distinguishable from a genuine zero-second response.
  if v_sent_at is null then
    return new;
  end if;

  select id, received_at
    into v_current_first_id, v_current_first_received_at
    from public.reply_events
   where outreach_message_id = new.outreach_message_id
     and response_time_seconds is not null
   limit 1;

  if v_current_first_id is null then
    new.response_time_seconds := greatest(
      0,
      floor(extract(epoch from (new.received_at - v_sent_at)))::bigint
    );
  elsif new.received_at < v_current_first_received_at then
    -- Gmail can deliver history out of order. Move the metric to the true first
    -- reply while retaining both immutable reply facts.
    update public.reply_events
       set response_time_seconds = null
     where id = v_current_first_id;
    new.response_time_seconds := greatest(
      0,
      floor(extract(epoch from (new.received_at - v_sent_at)))::bigint
    );
  end if;

  return new;
end;
$$;

revoke all on function app.set_reply_response_time() from public, anon, authenticated;

create trigger reply_events_set_response_time
before insert on public.reply_events
for each row execute function app.set_reply_response_time();

-- Backfill the first chronological reply for every existing outreach attempt.
with first_replies as (
  select distinct on (r.outreach_message_id)
    r.id,
    greatest(
      0,
      floor(extract(epoch from (r.received_at - m.sent_at)))::bigint
    ) as response_time_seconds
  from public.reply_events r
  join public.outreach_messages m on m.id = r.outreach_message_id
  where r.outreach_message_id is not null
    and m.send_status = 'sent'
    and m.sent_at is not null
  order by r.outreach_message_id, r.received_at, r.id
)
update public.reply_events r
   set response_time_seconds = f.response_time_seconds
  from first_replies f
 where r.id = f.id;

comment on column public.reply_events.response_time_seconds is
  'F139: elapsed whole seconds from the linked sent outreach attempt to its first '
  'chronological matched reply. Null on later replies or when sent_at is unavailable.';

