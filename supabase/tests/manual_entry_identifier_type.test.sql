-- Manual-entry registration numbers — 20261005100000. Run by `supabase test db`.
--
-- Pins `app.identifier_type_for_registry`, the rule that decides what
-- `organisation_identifiers.identifier_type` a manual entry's registration
-- number is filed under. That column is not a label: 360Giving grant history
-- asks for `uk_charity` / `uk_company` and refuses when it finds neither, the
-- grant matcher pairs grants to clients on `uk_company`, and the client list's
-- filters read it. Filing a charity number as 'manual' — which is what every
-- manual entry did before this migration — hid the number from all of them.
--
-- The rule is mirrored in `registerIdForName` (src/lib/registration-number.ts),
-- which decides what the form *shows* for a stored name. These cases are
-- therefore also the contract for that function's spellings: if the two ever
-- disagree, a name the form reads as the England and Wales register stops being
-- filed as a UK charity number, or the reverse.
--
-- Everything runs inside one transaction and is rolled back; nothing persists.

begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

-- ---------------------------------------------------------------------------
-- The register we hold
-- ---------------------------------------------------------------------------

-- The name the composer stores, from src/lib/registration-number.ts's closed
-- list, including surrounding whitespace and case — a value the CAM typed into
-- a draft before the list existed still has to classify.
select is(
  app.identifier_type_for_registry('Charity Commission for England and Wales'),
  'uk_charity'::public.identifier_type,
  'the England and Wales charity register files its number as a UK charity number'
);

select is(
  app.identifier_type_for_registry('  Charity Commission for England and Wales  '),
  'uk_charity'::public.identifier_type,
  'surrounding whitespace does not change what the name means'
);

select is(
  app.identifier_type_for_registry('Charity Commission for England & Wales'),
  'uk_charity'::public.identifier_type,
  'the ampersand spelling is the same register'
);

select is(
  app.identifier_type_for_registry('charity commission'),
  'uk_charity'::public.identifier_type,
  'the loose spelling older drafts carry is the same register'
);

select is(
  app.identifier_type_for_registry('CCEW'),
  'uk_charity'::public.identifier_type,
  'the abbreviation older drafts carry is the same register'
);

select is(
  app.identifier_type_for_registry('Companies House'),
  'uk_company'::public.identifier_type,
  'Companies House files its number as a UK company number'
);

select is(
  app.identifier_type_for_registry('companies house'),
  'uk_company'::public.identifier_type,
  'case does not change which register a number belongs to'
);

-- ---------------------------------------------------------------------------
-- The registers we do not hold — deliberately still 'manual'
-- ---------------------------------------------------------------------------

-- Filing these as uk_charity would make the grant lookup ask 360Giving for a
-- GB-CHC number that is not theirs, and read the empty answer as "never taken a
-- grant". An honest 'manual' is better than a confident wrong answer.
select is(
  app.identifier_type_for_registry('Scottish Charity Regulator'),
  'manual'::public.identifier_type,
  'a Scottish charity number is not filed as a UK charity number'
);

select is(
  app.identifier_type_for_registry('OSCR'),
  'manual'::public.identifier_type,
  'the Scottish regulator by abbreviation is also left alone'
);

select is(
  app.identifier_type_for_registry('Charity Commission for Northern Ireland'),
  'manual'::public.identifier_type,
  'a Northern Ireland charity number is not filed as a UK charity number'
);

select is(
  app.identifier_type_for_registry('Charity Commission of Kenya'),
  'manual'::public.identifier_type,
  'another country''s charity commission is not ours'
);

select is(
  app.identifier_type_for_registry('FCA Mutuals Register'),
  'manual'::public.identifier_type,
  'a register we hold no file for is left as a manual number'
);

-- ---------------------------------------------------------------------------
-- Nothing to go on
-- ---------------------------------------------------------------------------

select is(
  app.identifier_type_for_registry(null),
  'manual'::public.identifier_type,
  'no register named means no register claimed'
);

select is(
  app.identifier_type_for_registry('   '),
  'manual'::public.identifier_type,
  'a blank register name means no register claimed'
);

select * from finish();
rollback;
