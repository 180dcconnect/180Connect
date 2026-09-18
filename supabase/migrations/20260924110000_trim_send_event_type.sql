-- Migration: trim_send_event_type
-- Created: 2026-09-09
-- Feature:  F140 (#135), F141 (#136), F142 (#137) — all three descoped.
--           Decision record: docs/open-questions.md D-05.
--
--   Change        | Recreate send_event_type as ('sent','bounced','failed');
--                 | drop the unreachable 'delivered' and 'opened'
--   Affected      | SEND_EVENTS.event_type and the type itself
--   Dependencies  | create_outreach_events (20260804200000) created the type,
--                 | create_send_failure_handling (20260903140000) added 'failed'
--
-- Why: the type shipped as ('sent','delivered','bounced','opened') on the assumption,
-- written into Data Model tab 07, that these are events "returned by the Gmail API".
-- Gmail returns no such events. `users.messages.send` answers with
-- {id, threadId, labelIds} and nothing more: no delivery receipt, no open event, no
-- engagement webhook at any tier. Reply sync works by polling our own mailbox
-- (20260912160000_capture_gmail_replies), which tells us what arrived for us and
-- nothing about what a recipient did.
--
-- So two of the five values cannot ever be written:
--   'delivered' — nothing can observe it. Note that mark_scheduled_outreach_delivered
--                 (20260909090000) is named for the worker's scheduled->sent transition
--                 and inserts 'sent'; it never used this value.
--   'opened'    — obtainable only from a tracking pixel, which D-05 rejects on
--                 deliverability grounds (every CAM sends from one shared Workspace
--                 mailbox, so a pixel or link redirector risks the branch's whole
--                 sending reputation at once) and on accuracy grounds (Apple Mail
--                 Privacy Protection prefetches remote images by default).
--
-- The three that remain are all real: 'sent' is our own act (outreach-actions.ts and
-- mark_scheduled_outreach_delivered write it), 'failed' is F129's record of a send that
-- did not reach Gmail, and 'bounced' is recoverable by parsing the mailer-daemon message
-- that returns to the mailbox — unbuilt, but observable, which is the distinction this
-- migration draws.
--
-- Why now: leaving them costs nothing today and misleads tomorrow. The next person to
-- pick up delivery status finds 'delivered' in the enum and reasonably assumes something
-- can supply it.
--
-- Postgres cannot drop a value from an enum, so the type is recreated and the column
-- re-typed onto it. The cast would fail on a stranded row; the guard below turns that
-- into a readable message rather than a bare cast error, and refuses to discard evidence
-- this migration assumed could not exist.
--
-- Schema change approval record (SOP §7):
--   Change        | Recreate send_event_type without 'delivered' and 'opened'
--   Reason        | Neither has any possible source (D-05)
--   Compatibility | No reader or writer of either value exists: the only event_type
--                 | literals in the codebase are 'sent' and 'failed'
--                 | (src/app/clients/[id]/outreach-actions.ts, .../outreach/page.tsx)
--   Data migration| None. The guard aborts if any stranded row exists
--   Security      | Unchanged. No policy, grant or RLS state is touched
--   Documentation | Data Model tab 07 corrected in the same PR and re-exported to
--                 | docs/data-model/07-outreach-outcomes.md
--                 | Approved by Bashir (Project Leader), 9 Sep 2026.
--
-- Reversibility: paired rollback in ../rollback/20260924110000_trim_send_event_type.down.sql

do $$
declare
  stranded bigint;
begin
  select count(*) into stranded
  from public.send_events
  where event_type in ('delivered', 'opened');

  if stranded > 0 then
    raise exception
      'send_events holds % row(s) with event_type delivered/opened. Nothing in the '
      'application can write either value, so this needs explaining before the enum is '
      'trimmed (docs/open-questions.md D-05). Not discarding them.', stranded;
  end if;
end
$$;

create type public.send_event_type_trimmed as enum ('sent', 'bounced', 'failed');

alter table public.send_events
  alter column event_type type public.send_event_type_trimmed
  using (event_type::text::public.send_event_type_trimmed);

drop type public.send_event_type;
alter type public.send_event_type_trimmed rename to send_event_type;

comment on type public.send_event_type is
  'Delivery lifecycle events for outreach mail. Only what can actually be observed: '
  '''sent'' is our own send (F123), ''failed'' a send that did not reach Gmail (F129), '
  '''bounced'' the mailer-daemon reply. Gmail reports no delivery confirmation and no '
  'opens or clicks, which is why neither is an event type here — see '
  'docs/open-questions.md D-05.';

comment on table public.send_events is
  'Delivery events for outreach mail (Data Model tab 07). Append-only: written through '
  'service_role, with no write policy for any end-user role. Not "reported by Gmail" — '
  'Gmail reports no engagement; these are events the platform itself observes.';

comment on column public.send_events.occurred_at is
  'When the event happened, as observed by the platform.';

comment on column public.send_events.metadata is
  'Provider or parser detail for the event. NOT "returned by the Gmail API" — the send '
  'call returns only {id, threadId, labelIds}; failure detail is ours, and bounce detail '
  'would come from parsing the mailer-daemon message.';
