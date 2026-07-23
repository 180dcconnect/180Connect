-- Rollback for: 20260721101512_enable_extensions.sql
-- Sequence step 1/17 — F232 (#227)
-- Apply manually against the target DB to reverse the paired migration.
-- WARNING: only safe while no object depends on these extensions
-- (i.e. before/after the schema tables that use uuid generation are themselves rolled back).

drop extension if exists "pgcrypto";
drop extension if exists "uuid-ossp";
