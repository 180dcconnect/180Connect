-- Migration: seed_data_handling_rules
-- Story: F246 Public Data Handling Rules (#241) — initial deny-list.
<<<<<<<< HEAD:supabase/migrations/20260817130100_seed_data_handling_rules.sql
-- Depends on: 20260817130000_create_data_handling_rules
========
-- Depends on: 20260818100200_create_data_handling_rules
>>>>>>>> origin/dev:supabase/migrations/20260818100300_seed_data_handling_rules.sql
--
-- Seeds the initial set of deny rules from the data handling policy §2
-- ("What we do not collect"). These can be updated by an admin via the
-- admin UI at any time — this migration is the starting point, not the
-- permanent state.
--
-- The rules target fields that registry APIs (Companies House, Charity
-- Commission, CharityBase) are known to return but which the policy
-- prohibits storing:
--   - Personal home addresses (often embedded in officer/trustee records
--     where a registered office is an individual's home)
--   - Dates of birth
--   - Nationality
--   - Personal identification details
--
-- Schema change approval record (SOP §7):
--   Change        | INSERT rows into DATA_HANDLING_RULES; UPDATE
--                 | DATA_HANDLING_RULE_VERSIONS.
--   Reason        | F246 — initial deny-list per data handling policy §2.
--   Compatibility | Additive only. No schema change.
--   Data migration| None.
--   Security      | No change. service_role writes; admin reads via RLS.
--   Documentation | Covered by F246 PR.
--
<<<<<<<< HEAD:supabase/migrations/20260817130100_seed_data_handling_rules.sql
-- Reversibility: paired rollback in ../rollback/20260817130100_seed_data_handling_rules.down.sql
========
-- Reversibility: paired rollback in ../rollback/20260818100300_seed_data_handling_rules.down.sql
>>>>>>>> origin/dev:supabase/migrations/20260818100300_seed_data_handling_rules.sql

-- Bump version to 1 (the initial rule set)
update public.data_handling_rule_versions
  set current_version = 1, updated_at = now()
  where id = true;

-- created_by is left null on every seeded rule: these rules were not authored by
-- a person, and the previous version of this migration looked up "any admin" and
-- silently returned when it found none. That was the wrong failure mode for a
-- compliance seed — a fresh database would end up with current_version = 1 (the
-- version claiming rules exist) and an empty rules table, so the ingestion runner
-- would filter nothing while reporting that version on every row it wrote.
-- Null created_by removes the dependency entirely and the insert always runs.

-- Companies House: officer personal data
insert into public.data_handling_rules
  (rule_version, source, field_path, action, reason) values
  (1, 'companies_house', 'officers[*].usual_residential_address', 'deny',
   'Personal home address — policy §2 exclusion. Registered office addresses are frequently individuals'' home addresses.'),
  (1, 'companies_house', 'officers[*].date_of_birth', 'deny',
   'Date of birth — not needed for outreach purpose, special category adjacent.'),
  (1, 'companies_house', 'officers[*].nationality', 'deny',
   'Nationality — not needed for outreach purpose.'),
  (1, 'companies_house', 'officers[*].country_of_residence', 'deny',
   'Country of residence — personal data not needed for organisational outreach.'),
  (1, 'companies_house', 'previous_company_names', 'deny',
   'Previous company names — not relevant to outreach and may contain personal identifiers.');

-- CharityBase: trustee personal data
insert into public.data_handling_rules
  (rule_version, source, field_path, action, reason) values
  (1, 'charitybase', 'trustees[*].home_address', 'deny',
   'Personal home address — policy §2 exclusion.'),
  (1, 'charitybase', 'trustees[*].date_of_birth', 'deny',
   'Date of birth — not needed for outreach purpose.'),
  (1, 'charitybase', 'trustees[*].other_names', 'deny',
   'Other names (aliases) — personal data not needed for organisational outreach.');

-- Charity Commission: trustee personal data
insert into public.data_handling_rules
  (rule_version, source, field_path, action, reason) values
  (1, 'charity_commission', 'trustees[*].date_of_birth', 'deny',
   'Date of birth — not needed for outreach purpose.'),
  (1, 'charity_commission', 'trustees[*].home_address', 'deny',
   'Personal home address — policy §2 exclusion.'),
  (1, 'charity_commission', 'trustees[*].other_names', 'deny',
   'Other names (aliases) — personal data not needed for organisational outreach.');

-- Global rules (all sources): categories the policy never collects
insert into public.data_handling_rules
  (rule_version, source, field_path, action, reason) values
  (1, null, 'health_data', 'deny',
   'Special category data — policy §2: "We do not collect special category data (Health, Ethnicity, Religion, etc.)"'),
  (1, null, 'ethnicity', 'deny',
   'Special category data — policy §2 exclusion.'),
  (1, null, 'religion', 'deny',
   'Special category data — policy §2 exclusion.'),
  (1, null, 'political_affiliation', 'deny',
   'Special category data — policy §2 exclusion.'),
  (1, null, 'sexual_orientation', 'deny',
   'Special category data — policy §2 exclusion.');

-- Audit log entry for the seed. actor_user_id is null: audit_log documents null as
-- "a system / service-role action with no end user", which is exactly this.
insert into public.audit_log
  (actor_user_id, action, target_table, detail)
values
  (null, 'data_handling_rules_seeded', 'data_handling_rules',
   jsonb_build_object(
     'rule_version', 1,
     'rules_count', (select count(*) from public.data_handling_rules where rule_version = 1),
     'origin', 'migration_seed',
     'policy_reference', 'data handling policy §2'
   ));

-- Fail loudly if the seed did not land. A compliance rule set that silently
-- ends up empty is worse than a failed migration: ingestion would report a rule
-- version it is not actually enforcing.
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
    from public.data_handling_rules
    where is_active = true;

  if v_count <> 16 then
    raise exception
      'Data handling rule seed failed: expected 16 active rules, found %.', v_count;
  end if;
end;
$$;
