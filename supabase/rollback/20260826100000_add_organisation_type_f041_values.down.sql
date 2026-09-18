-- Rollback: add_organisation_type_f041_values
-- PG enums cannot drop a value once committed (one-way door). This rollback is a
-- no-op by design — forward-fix with a new migration if the vocabulary needs
-- correcting. Kept so supabase db reset symmetry is explicit.
select 1;
