-- Migration: clear_read_override_on_new_reply
-- Story: /inbox — a fresh client reply was rendering as already-read.
--
-- INBOX_THREAD_STATE.read_state (20260924090000) is a per-viewer override of
-- the server-derived unread flag, and by design it survives navigation and
-- page loads on purpose: a thread the server calls unread that the CAM has
-- read must stay read. But a "thread" here is an entire organisation's
-- outreach history, not one message — so once a CAM reads it, that `'read'`
-- row has no way to know a brand-new, different reply has since landed on
-- the same organisation. The override was written for content that no
-- longer matches what is now sitting unread underneath it.
--
-- Gmail's own behaviour is the model: a new message reopens a read thread as
-- unread regardless of what was read before. This trigger reproduces that —
-- clearing (not flipping to 'unread', just back to NULL, "no opinion") every
-- viewer's `'read'` override for an organisation the moment a new reply is
-- captured, so the server's own derivation (unread, correctly) is what
-- actually renders. A CAM's `'unread'` override (marked unread on purpose)
-- is left untouched — it already reads as unread, nothing to clear.
--
-- Runs in the same transaction as F133's notify trigger
-- (20260912170300_notify_on_gmail_reply.sql), on the same table, for the
-- same reason: REPLY_EVENTS is the one write every linked reply goes
-- through, deduplicated by that row's own insert.
--
-- No table/column change — INBOX_THREAD_STATE.read_state already exists and
-- is nullable by design (20260924090000).
-- Reversibility: ../rollback/20261003160000_clear_read_override_on_new_reply.down.sql
--
-- Re-appliable on purpose (`or replace`, `drop trigger if exists`): staging
-- received these same objects early under 20260913231412, a version that never
-- landed in git and was forgotten via `migration repair --status reverted`
-- (Sep 2026). A plain CREATE would fail there with "already exists" while a
-- fresh replay must still build them — the guards satisfy both.

create or replace function public.clear_read_override_on_new_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.inbox_thread_state
     set read_state = null
   where organisation_id = new.organisation_id
     and read_state = 'read';

  return new;
end;
$$;

comment on function public.clear_read_override_on_new_reply() is
  'After a reply is captured, clears every viewer''s stale read override for that organisation so the fresh reply renders unread.';

revoke execute on function public.clear_read_override_on_new_reply() from public, anon, authenticated;

drop trigger if exists reply_events_clear_read_override on public.reply_events;
create trigger reply_events_clear_read_override
  after insert on public.reply_events
  for each row execute function public.clear_read_override_on_new_reply();
