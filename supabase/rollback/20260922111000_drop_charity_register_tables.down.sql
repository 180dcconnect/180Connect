-- Rollback for: 20260922111000_drop_charity_register_tables.sql
--
-- Deliberately NOT provided as a table recreation.
--
-- These tables held a cache of the Charity Commission's public register. Their
-- schema is gone from the codebase along with the code that wrote them, so
-- recreating them here would produce two empty tables nothing populates and
-- nothing reads — an illusion of reversibility rather than the real thing.
--
-- If the register genuinely needs to live in Postgres again, the honest route is
-- to restore the create migration and the snapshot writer from git history
-- (removed in the same commit as this migration) rather than to run this file.
--
-- Nothing else needs reversing: no other table referenced these two, and every
-- organisation imported from them survives in ORGANISATIONS untouched.

select 'No automatic rollback — see the comment above.' as note;
