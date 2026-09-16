-- Rollback of 20261004220000_news_hook_columns_cover_stage_one.
--
-- That migration changed three COMMENTs and nothing else, so this restores the
-- three previous comment strings verbatim. No data, no column, no policy: there
-- is nothing else to reverse, and nothing is lost by reverting.

comment on column public.outreach_messages.news_source is
  'Where the draft''s news hook came from: live (Exa lookup at generation time, F110), stored (enrichment_results), or null when the draft has no hook.';

comment on column public.outreach_messages.news_hook is
  'Prompt-ready hook text (title, outlet, date) for a live Stage 2 news hook, F110. Null unless news_source is live.';

comment on column public.outreach_messages.news_url is
  'Verifiable article URL for a live Stage 2 news hook, F110. Shown in review so the CAM can check the source before approving. Null unless news_source is live.';
