-- Migration: news_hook_columns_cover_stage_one
-- Story: F110 (Live News Hook), extended to first-contact emails.
--
-- COMMENTS ONLY. No column is added, dropped or altered; no data moves; no
--   policy, index or grant changes. The three columns already exist
--   (20260926090000_add_stage_two_news_hook_columns.sql) and already hold
--   exactly what they say they hold. What changed is *who writes them*.
--
-- WHY: those comments each said "Stage 2", because when they were written the
--   live lookup ran only for follow-ups. The first-contact prompt has always
--   carried a "Relevant news hook" opening, but the only source it ever read
--   was ENRICHMENT_RESULTS.news_hooks — a column nothing in the application
--   has ever written, and which holds zero non-null values on either
--   environment. So that opening silently fell through its own "if no news
--   hook is supplied, fall back to a mission-led opening" clause: a CAM who
--   picked it got the default email. Stage 1 now runs the same Exa lookup
--   Stage 2 does, when (and only when) that opening is chosen, and writes the
--   same three columns on the draft row.
--
--   A comment that names the wrong stage is how the next person concludes the
--   column is not for them and adds a fourth. Correcting it is cheap; the
--   confusion is not.
--
-- Schema change approval record (SOP §7):
--   Change        | COMMENT ON three existing OUTREACH_MESSAGES columns. No DDL.
--   Reason        | The columns are now written by first-contact drafts as well as
--                 | follow-ups; the comments named only follow-ups.
--   Compatibility | No structural change. Nothing reads these comments at runtime.
--   Data migration| None.
--   Security      | None. RLS, grants and policies untouched.
--   Documentation | Data Model tab 04 (OUTREACH_MESSAGES) description text owed
--                 | against the spreadsheet, same three rows.
--
-- Reversibility: paired rollback in
--   ../rollback/20261004220000_news_hook_columns_cover_stage_one.down.sql
--   restores the previous wording verbatim. The same three statements are
--   repeated as a comment at the end of this file so the reversal is readable
--   next to what it reverses; the file above is the artifact to deploy.

comment on column public.outreach_messages.news_source is
  'Where the draft''s news hook came from: live (Exa lookup at generation time, F110 — both the first-contact email, when the news-hook opening was chosen, and every follow-up), stored (enrichment_results), or null when the draft has no hook.';

comment on column public.outreach_messages.news_hook is
  'Prompt-ready hook text (title, outlet, date) for a live news hook, F110. Null unless news_source is live.';

comment on column public.outreach_messages.news_url is
  'Verifiable article URL for a live news hook, F110. Shown in review so the CAM can check the source before approving. Null unless news_source is live.';

-- Rollback:
--   comment on column public.outreach_messages.news_source is
--     'Where the draft''s news hook came from: live (Exa lookup at generation time, F110), stored (enrichment_results), or null when the draft has no hook.';
--   comment on column public.outreach_messages.news_hook is
--     'Prompt-ready hook text (title, outlet, date) for a live Stage 2 news hook, F110. Null unless news_source is live.';
--   comment on column public.outreach_messages.news_url is
--     'Verifiable article URL for a live Stage 2 news hook, F110. Shown in review so the CAM can check the source before approving. Null unless news_source is live.';
