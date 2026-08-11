drop function if exists public.get_organisation_sources_with_actor(uuid);
drop function if exists public.approve_manual_entry(uuid, boolean, text, uuid, text);
drop function if exists public.reject_manual_entry(uuid, text);
drop function if exists public.save_manual_entry(
  uuid, text, text, public.organisation_type, text, text, text, text,
  text, text, text, text, text, boolean
);
drop table if exists public.manual_entry_records;
drop type if exists public.manual_review_status;
