-- Migration: add_stage_two_news_hook_columns
-- Story: F110 (Live News Hook for Follow-Up).
--
-- WHY COLUMNS AND NOTHING ELSE: a Stage 2 draft generated with a live news
--   hook must stay verifiable after the transient generation response is gone.
--   The hook text already persists verbatim in ai_generations.prompt_user
--   (F112), but the article URL — the part the CAM actually checks — had no
--   vessel: it travelled only in the route response, which the sole caller
--   drops. Three short nullable strings on the draft row itself close that
--   gap, so reopening the draft restores the verification link. ~150 bytes per
--   hooked draft, null otherwise: nothing against the 500 MB budget (AGENTS.md
--   "Infrastructure budget" targets file bytes, not short strings — the
--   attach_flyer boolean on this same table set that precedent).
--
-- WHY NULLABLE WITH NO DEFAULT: every message already in the table was drafted
--   without a hook, so null is what those rows actually mean. A NOT NULL
--   column would rewrite the table to stamp a lie on every existing draft.
--
-- Schema change approval record (SOP §7):
--   Change        | New columns OUTREACH_MESSAGES.news_source, .news_hook,
--                 | .news_url (text, nullable, no default).
--   Reason        | F110 — retain the verifiable news source on the draft row so a
--                 | saved and reopened Stage 2 draft still shows its article link.
--   Compatibility | Additive only. Existing rows read null, which the UI renders as
--                 | "no hook" — today's behaviour for every old draft. No policy,
--                 | index or query changes: the columns are read by the inbox
--                 | thread/hydrate path, which is already row-scoped by the
--                 | existing OUTREACH_MESSAGES policies.
--   Data migration| None.
--   Security      | Inherits OUTREACH_MESSAGES RLS unchanged. The columns carry the
--                 | same visibility as the draft subject and body they annotate —
--                 | a public news headline and its URL — and grant no read or
--                 | write path that did not already exist.
--   Documentation | Data Model tab 04 (OUTREACH_MESSAGES) + tab 02 Data
--                 | Dictionary still owed against the spreadsheet.
--
-- Reversibility: paired rollback below.

alter table public.outreach_messages
  add column if not exists news_source text,
  add column if not exists news_hook text,
  add column if not exists news_url text;

comment on column public.outreach_messages.news_source is
  'Where the draft''s news hook came from: live (Exa lookup at generation time, F110), stored (enrichment_results), or null when the draft has no hook.';

comment on column public.outreach_messages.news_hook is
  'Prompt-ready hook text (title, outlet, date) for a live Stage 2 news hook, F110. Null unless news_source is live.';

comment on column public.outreach_messages.news_url is
  'Verifiable article URL for a live Stage 2 news hook, F110. Shown in review so the CAM can check the source before approving. Null unless news_source is live.';

-- Rollback:
--   alter table public.outreach_messages drop column if exists news_source;
--   alter table public.outreach_messages drop column if exists news_hook;
--   alter table public.outreach_messages drop column if exists news_url;
