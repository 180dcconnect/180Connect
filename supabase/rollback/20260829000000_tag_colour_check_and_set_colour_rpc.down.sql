-- Rollback for 20260829000000_tag_colour_check_and_set_colour_rpc.sql (F194).

drop function if exists public.set_tag_colour(uuid, text);

alter table public.tags
  drop constraint if exists tags_colour_hex_format;
