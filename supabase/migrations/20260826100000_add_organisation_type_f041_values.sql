-- Migration: add_organisation_type_f041_values
-- Story: F041 expansion (#67) — finer organisation_type vocabulary for CAM filter
--        (charity, NGO, social enterprise, CIC, CIO etc.)
-- Purpose: expand public.organisation_type enum so CAMs can filter to one or more
--          specific types (charity, ngo, cic, cio, social_enterprise) via the
--          standardised F041 field, rather than the coarse charity/company/both/other.
--
-- SOP §7: Data Model tab 04 ORGANISATIONS.organisation_type Notes updated from
--          "charity / company / both / other" to
--          "charity / cio / cic / ngo / social_enterprise / company / both / other"
--          before this migration was written. Run `npm run export:data-model` after
--          merging — docs/data-model/04-entities.md + 02-data-dictionary.md are
--          GENERATED files.
--
-- Compatibility: additive only. Existing rows (charity/company/both/other) stay
--                valid. New values are nullable by virtue of being enum members
--                not yet used. No backfill. PG enum values cannot be dropped
--                once committed — one-way door, so these are not removed without
--                Wednesday-call agreement (see 20260722103100_create_organisations.sql:22).
-- Security: no table/policies — enum value grant is implicit.

-- Each ADD VALUE is its own statement so a re-run is idempotent. IF NOT EXISTS
-- guards replay on a branch that already applied it locally.
alter type public.organisation_type add value if not exists 'cic';
alter type public.organisation_type add value if not exists 'cio';
alter type public.organisation_type add value if not exists 'ngo';
alter type public.organisation_type add value if not exists 'social_enterprise';
