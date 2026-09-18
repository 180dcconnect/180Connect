-- Rollback: trim_send_event_type
-- Restores send_event_type to the five values it held before
-- ('sent','delivered','bounced','opened','failed') and re-types SEND_EVENTS.event_type
-- onto it.
--
-- No data is recovered or lost either way: the forward migration can only run against a
-- table with no 'delivered'/'opened' rows, so this only widens the type's domain back.
-- The comments are restored to their previous wording, including the Gmail attribution
-- D-05 found to be wrong — a rollback returns the schema to what it was, not to what it
-- ought to have been.

create type public.send_event_type_restored as enum ('sent', 'delivered', 'bounced', 'opened', 'failed');

alter table public.send_events
  alter column event_type type public.send_event_type_restored
  using (event_type::text::public.send_event_type_restored);

drop type public.send_event_type;
alter type public.send_event_type_restored rename to send_event_type;

comment on type public.send_event_type is
  'Delivery lifecycle events written by the Gmail send path. ''failed'' '
  '(F129) records a send attempt that did not reach Gmail successfully; '
  'metadata holds {reason, retryable, provider, scheduled}.';

comment on table public.send_events is
  'Delivery events reported by Gmail (Data Model tab 07). Append-only: written by the '
  'webhook through service_role, with no write policy for any end-user role.';

comment on column public.send_events.occurred_at is null;
comment on column public.send_events.metadata is null;
