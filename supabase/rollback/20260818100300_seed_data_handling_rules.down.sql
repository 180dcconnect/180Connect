-- Rollback: 20260818100300_seed_data_handling_rules
-- Removes the seeded data handling rules.
--
-- Matched on `created_by is null` rather than `rule_version = 1`: only the seed
-- inserts rules with no author, and rule_version is bumped whenever an admin
-- toggles a rule, so a version match would leave any touched seed rule behind.
-- Admin-created rules are kept — rolling back the seed should not delete them.
--
-- The audit_log row written by the seed is deliberately left in place: the log is
-- append-only, and the fact that the seed ran is true whether or not it was undone.

delete from public.data_handling_rules where created_by is null;

update public.data_handling_rule_versions
  set current_version = 0, updated_at = now()
  where id = true;
