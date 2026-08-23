-- Migration: normalize_city_casing
-- Purpose: fix city column inconsistencies: ALL_CAPS vs Title Case,
--          street fragments ("35 Ballards Lane", "1 Ardwyn Walk", "HA8 7AR",
--          "Tindale Crescent, Bishop Auckland"), county names stored as city,
--          and casing duplication in /clients "Filter by city".
-- Mirrors src/lib/city.ts normalizeCity (Title Case). Postgres
-- initcap(lower(trim(city))) is equivalent.

-- 1. Clear obviously invalid city values: street fragments, lone numbers,
--    postcodes, and comma-addresses. These came from Charity Commission
--    address-ladder mis-parsing (see src/lib/standardize/charity-commission.ts).
update public.organisations
set city = null
where city is not null
  and (
    trim(city) ~ '^\d+\s*$'
    or trim(city) ~ '^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$'
    or trim(city) ~ '^\d+\s+\w+\s+(Walk|Lane|Avenue|Street|Road|Close|Gardens?)$'
    or city in ('1 Ardwyn Walk', '35 Ballards Lane', '65 West Avenue', 'HA8 7AR', '10', 'Tindale Crescent, Bishop Auckland')
    or trim(city) like '%,%'
  );

-- 2. Clear county values stored as city (not a town/city).
update public.organisations
set city = null
where city is not null
  and lower(trim(city)) in ('cumbria', 'surrey', 'essex', 'east sussex', 'east yorkshire');

-- 3. Title Case remaining cities. initcap(lower(trim(city))) maps
--    "ALDERSHOT" -> "Aldershot", "LONDON" -> "London",
--    "ST. ALBANS" -> "St. Albans", "BURTON-ON-TRENT" -> "Burton-On-Trent".
update public.organisations
set city = initcap(lower(trim(city)))
where city is not null
  and trim(city) <> ''
  and city <> initcap(lower(trim(city)));

update public.organisations
set city = trim(city)
where city is not null
  and city <> trim(city);
