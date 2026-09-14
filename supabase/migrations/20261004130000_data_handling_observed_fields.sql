-- data_handling_observed_fields — the field names a source has actually sent.
-- Story: F246 Public Data Handling Rules (#241), usability follow-up.
--
-- WHAT THIS IS: adding a data handling rule for a field outside the built-in list
--   used to mean typing the exact path into a source's API response
--   ("officers[*].usual_residential_address"). An admin cannot know that name, and
--   a wrong one is the worst kind of failure for a privacy control: the rule
--   matches nothing, strips nothing, and still shows as a protection. This
--   function lists the field names that really occur in what a source has sent,
--   so the settings screen can offer a choice instead of a text box — a wrong
--   name becomes impossible rather than merely unlikely.
--
-- NAMES, NEVER VALUES: returns each field's path and how many of the sampled
--   records contain it. It never returns a value from a payload, so the list is
--   safe to show even for fields that hold the personal data being protected.
--
-- SAMPLED: walks the most recent 300 records of the one source asked for, to a
--   depth of four. Walking every stored payload took 7.7s on staging (15.7k rows),
--   against an ~8s statement timeout for authenticated requests; the sample takes
--   under 2s across all sources and far less for one. A field only present in
--   older records can be missed — acceptable, because the developer form remains
--   for that case, and current imports are what a new rule will act on.
--
-- PATH SYNTAX matches src/lib/ingestion/field-filter.ts exactly: dot-separated
--   keys, `[*]` after a key whose value is an array of objects. A path returned
--   here is a path the filter will match.
--
-- Schema change approval record (SOP §7):
--   Change        | New public.data_handling_observed_fields(text).
--   Reason        | Data handling rules screen usable by non-technical admins.
--   Compatibility | New function only. No table, grant or policy changes.
--   Data migration| None.
--   Security      | SECURITY DEFINER to read raw_source_records regardless of the
--                 | caller's grants; self-checks app.is_admin() and
--                 | app.is_active_user(), same gate as data_handling_filter_summary.
--                 | Returns paths and counts only, never payload values.
--   Documentation | Function only; no Data Model entity or dictionary change.
--
-- Timestamp: dated after 20261004120000, the latest migration in the tree.
--
-- Reversibility: paired rollback in
-- ../rollback/20261004130000_data_handling_observed_fields.down.sql

create or replace function public.data_handling_observed_fields(p_source text)
returns table (
  field_path      text,
  records_seen    bigint,
  records_sampled bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sample_size constant integer := 300;
  v_max_depth   constant integer := 4;
begin
  if not (app.is_admin() and app.is_active_user()) then
    raise exception 'Only admins can read the fields a source has sent'
      using errcode = '42501';
  end if;

  if p_source is null or btrim(p_source) = '' then
    raise exception 'Choose a source'
      using errcode = '22023';
  end if;

  return query
    with recursive sample as (
      select r.id, r.raw_payload
        from public.raw_source_records r
       where r.record_source::text = p_source
       order by r.received_at desc
       limit v_sample_size
    ),
    walk (record_id, path, value, depth) as (
      select s.id, e.key, e.value, 1
        from sample s
        cross join lateral jsonb_each(
          case when jsonb_typeof(s.raw_payload) = 'object' then s.raw_payload else '{}'::jsonb end
        ) e
      union all
      select w.record_id,
             case when jsonb_typeof(w.value) = 'array'
                  then w.path || '[*].' || c.key
                  else w.path || '.' || c.key end,
             c.value,
             w.depth + 1
        from walk w
        cross join lateral (
          -- An object's own keys, or the keys of every object in an array.
          select el
            from jsonb_array_elements(
                   case when jsonb_typeof(w.value) = 'array' then w.value else '[]'::jsonb end
                 ) el
           where jsonb_typeof(el) = 'object'
          union all
          select w.value where jsonb_typeof(w.value) = 'object'
        ) parent (el)
        cross join lateral jsonb_each(parent.el) c
       where w.depth < v_max_depth
    )
    select w.path,
           count(distinct w.record_id),
           (select count(*) from sample)
      from walk w
     -- Leaves only: a nested object is described by its children, and an array of
     -- objects by its `[*]` paths. An array of plain values is a leaf.
     where jsonb_typeof(w.value) <> 'object'
       and not (
         jsonb_typeof(w.value) = 'array'
         and jsonb_path_exists(w.value, '$[*] ? (@.type() == "object")')
       )
     group by w.path
     order by w.path;
end;
$$;

comment on function public.data_handling_observed_fields(text) is
  'F246: the field paths that occur in the most recent 300 stored records from one '
  'source, with how many of those records contain each. Names and counts only, never '
  'values. Admin-only. Feeds the data handling rules picker so a rule can only name a '
  'field the source really sends.';

revoke execute on function public.data_handling_observed_fields(text) from public;
revoke execute on function public.data_handling_observed_fields(text) from anon;
grant execute on function public.data_handling_observed_fields(text) to authenticated;
