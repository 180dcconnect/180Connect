-- Rollback: add_stage_two_news_hook_columns (F110)
--
-- Drops the news hook columns. Drafts generated with a live hook lose their
-- verification link (the hook text remains in ai_generations.prompt_user via
-- the F112 verbatim prompt record). Routes that write the columns must be
-- deployed out before this runs, or their inserts will reference missing
-- columns.

comment on column public.outreach_messages.news_source is null;
comment on column public.outreach_messages.news_hook is null;
comment on column public.outreach_messages.news_url is null;

alter table public.outreach_messages
  drop column if exists news_source;

alter table public.outreach_messages
  drop column if exists news_hook;

alter table public.outreach_messages
  drop column if exists news_url;
